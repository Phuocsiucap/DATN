from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from common.core.config import get_settings
from common.db.idempotency import claim_event
from common.db.media_workflows import content_category_payload
from common.db.models import ContentItem, MediaWorkflow, KafkaTask, SocialProfile, PlanningCandidate, PlanningRun
from common.db.session import SessionLocal
from common.events.envelope import build_event
from common.events.kafka import consumer, publish
from common.events.topics import CRAWL_JOB_COMPLETED, GENERATE_VIDEO_SCRIPT_REQUESTED

logger = logging.getLogger(__name__)


def run_crawl_job_completed_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        logger.info("Kafka disabled; crawl_job_completed consumer idle")
        return

    kafka_consumer = consumer([CRAWL_JOB_COMPLETED], group_id="planning-orchestrator-auto-project-queue")
    for record in kafka_consumer:
        try:
            message = record.value
            event_id = message.get("event_id")
            with SessionLocal() as db:
                if event_id and not claim_event(db, event_id, "planning-orchestrator-auto-project-queue"):
                    kafka_consumer.commit()
                    continue
                _handle_crawl_job_completed(db, message)
            kafka_consumer.commit()
        except Exception as e:
            logger.exception(f"[planning-orchestrator] Error processing crawl_job_completed record offset {record.offset}: {e}")


def _handle_crawl_job_completed(db: Any, message: dict[str, Any]) -> None:
    job_id = message.get("job_id") or message.get("payload", {}).get("job_id")
    status = message.get("payload", {}).get("status") or "SUCCEEDED"
    print(f"[planning-orchestrator] Received crawl.job.completed for job_id={job_id}, status={status}")

    if status not in {"SUCCEEDED", "PARTIAL_SUCCESS"}:
        print(f"[planning-orchestrator] Skipping auto project queue for non-successful crawl job {job_id} (status={status})")
        return

    profiles = (
        db.query(SocialProfile)
        .filter(SocialProfile.status == "active")
        .all()
    )

    if not profiles:
        print(f"[planning-orchestrator] No active social profiles found for auto project queue on crawl job {job_id}")
        return

    for profile in profiles:
        if not profile.strategy:
            continue
        
        strategy = profile.strategy
        if not getattr(strategy, "receive_system_content", True):
            continue
        if not getattr(strategy, "auto_project_queue_enabled", False):
            continue

        try:
            candidate_limit = max(1, min(int(getattr(strategy, "max_system_recommendations", 20) or 20), 100))
            project = _create_project_from_crawl(db, profile, job_id, candidate_limit)
            script_task = _enqueue_script_from_project(db, project, trigger="crawl_job_completed")
            if script_task:
                print(
                    f"[planning-orchestrator] Created content project {project.id} and script task {script_task.id} "
                    f"for profile {profile.id} from crawl job {job_id}"
                )
            else:
                print(
                    f"[planning-orchestrator] Created content project {project.id} for profile {profile.id} from crawl job {job_id}; "
                    "no eligible content was available for video scripting"
                )
        except Exception as exc:
            print(f"[planning-orchestrator] Failed auto project for profile {profile.id} on crawl job {job_id}: {exc}")


def _create_project_from_crawl(db: Any, profile: SocialProfile, job_id: str, candidate_limit: int = 20) -> MediaWorkflow:
    crawl_job_id = uuid.UUID(str(job_id))
    items = _content_items_for_crawl_job(db, crawl_job_id, candidate_limit)
    existing = next(
        (
            project
            for project in db.query(MediaWorkflow)
            .filter(MediaWorkflow.profile_id == profile.id)
            .order_by(MediaWorkflow.created_at.desc())
            .limit(50)
            .all()
            if isinstance(project.metadata_json, dict)
            and str(project.metadata_json.get("crawl_job_id") or "") == str(job_id)
            and str(project.metadata_json.get("selection_mode") or "") == "AUTO"
        ),
        None,
    )
    if existing:
        if items and not existing.primary_content_id:
            existing.primary_content_id = items[0].id
            existing.inputs_jsonb = _workflow_inputs(items)
            existing.metadata_json = {**(existing.metadata_json or {}), **content_category_payload(items[0])}
            existing.status = "READY"
            db.add(existing)
            db.commit()
            db.refresh(existing)
        _ensure_auto_planning_records(db, existing, items, job_id)
        return existing

    inputs = _workflow_inputs(items)
    primary_content_id = items[0].id if items else None
    primary_category_payload = content_category_payload(items[0]) if items else {}

    project = MediaWorkflow(
        user_id=profile.user_id,
        profile_id=profile.id,
        title="Auto dataset from Module 1",
        status="READY" if items else "NEEDS_REVIEW",
        primary_content_id=primary_content_id,
        inputs_jsonb=inputs,
        metadata_json={"selection_mode": "AUTO", "crawl_job_id": str(job_id), "filters": {"source_crawl_job_id": str(job_id)}, **primary_category_payload},
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    _ensure_auto_planning_records(db, project, items, job_id)
    return project


def _content_items_for_crawl_job(db: Any, crawl_job_id: uuid.UUID, candidate_limit: int) -> list[ContentItem]:
    return (
        db.query(ContentItem)
        .filter(
            ContentItem.crawl_job_id == crawl_job_id,
            ContentItem.status.in_(["READY", "USABLE_WITH_WARNING"]),
        )
        .order_by(ContentItem.quality_score.desc(), ContentItem.updated_at.desc())
        .limit(candidate_limit)
        .all()
    )


def _workflow_inputs(items: list[ContentItem]) -> list[dict[str, Any]]:
    return [
        {
            "type": "content",
            "id": str(item.id),
            "score": float(item.quality_score or 0),
            **content_category_payload(item),
        }
        for item in items
    ]


def _ensure_auto_planning_records(db: Any, project: MediaWorkflow, items: list[ContentItem], job_id: str) -> PlanningRun:
    crawl_job_id = uuid.UUID(str(job_id))
    existing_run = (
        db.query(PlanningRun)
        .filter(
            PlanningRun.workflow_id == project.id,
            PlanningRun.planning_mode == "AUTO",
            PlanningRun.crawl_job_id == crawl_job_id,
        )
        .order_by(PlanningRun.created_at.desc())
        .first()
    )
    now = datetime.now(timezone.utc)
    input_payload = {
        "crawl_job_id": str(job_id),
        "candidate_limit": len(items),
        "content_ids": [str(item.id) for item in items],
        "filters": {
            "content_item_crawl_job_id": str(job_id),
            "statuses": ["READY", "USABLE_WITH_WARNING"],
            "order_by": ["quality_score DESC", "updated_at DESC"],
        },
    }
    output_payload = {
        "workflow_id": str(project.id),
        "selected_content_id": str(project.primary_content_id) if project.primary_content_id else None,
        "input_count": len(items),
    }
    reason_payload = {
        "trigger": "crawl_job_completed",
        "selection_reasons": [
            "Selected from ContentItem rows directly linked to this crawl_job_id",
            "Ordered by quality_score descending, then updated_at descending",
        ],
    }
    if existing_run:
        existing_run.status = "SUCCEEDED" if items else "WAITING_REVIEW"
        existing_run.input_jsonb = input_payload
        existing_run.output_jsonb = output_payload
        existing_run.reason_jsonb = reason_payload
        existing_run.metadata_json = {**(existing_run.metadata_json or {}), "trigger": "crawl_job_completed"}
        existing_run.completed_at = existing_run.completed_at or now
        db.add(existing_run)
        run = existing_run
    else:
        run = PlanningRun(
            user_id=project.user_id,
            profile_id=project.profile_id,
            workflow_id=project.id,
            crawl_job_id=crawl_job_id,
            planning_mode="AUTO",
            status="SUCCEEDED" if items else "WAITING_REVIEW",
            input_jsonb=input_payload,
            output_jsonb=output_payload,
            reason_jsonb=reason_payload,
            metadata_json={"trigger": "crawl_job_completed"},
            started_at=now,
            completed_at=now,
        )
        db.add(run)
        db.flush()

    for index, item in enumerate(items, start=1):
        _ensure_planning_candidate(db, run, project, item, index, job_id)

    db.commit()
    db.refresh(run)
    return run


def _ensure_planning_candidate(db: Any, run: PlanningRun, project: MediaWorkflow, item: ContentItem, rank: int, job_id: str) -> PlanningCandidate:
    candidate = (
        db.query(PlanningCandidate)
        .filter(
            PlanningCandidate.planning_run_id == run.id,
            PlanningCandidate.content_id == item.id,
        )
        .first()
    )
    if not candidate:
        candidate = PlanningCandidate(
            planning_run_id=run.id,
            workflow_id=project.id,
            content_id=item.id,
        )
    candidate.rank_order = rank
    candidate.score = item.quality_score or 0
    candidate.selected = project.primary_content_id == item.id
    candidate.eligible = True
    candidate.reason_jsonb = {
        "crawl_job_id": str(job_id),
        "selection_reasons": [
            "Included because content item is linked to this crawl_job_id",
            "Eligible status: READY/USABLE_WITH_WARNING",
        ],
        "rejection_reasons": [],
    }
    candidate.metadata_json = {
        "quality_score": float(item.quality_score or 0),
        "status": item.status,
        **content_category_payload(item),
    }
    db.add(candidate)
    return candidate


def _enqueue_script_from_project(db: Any, project: MediaWorkflow, *, trigger: str) -> KafkaTask | None:
    if not project.primary_content_id:
        return None
    existing = (
        db.query(KafkaTask)
        .filter(
            KafkaTask.reference_id == project.id,
            KafkaTask.task_type == "GENERATE_VIDEO_SCRIPT",
            KafkaTask.status.in_(["PENDING", "RUNNING", "PROCESSING"]),
        )
        .order_by(KafkaTask.created_at.desc())
        .first()
    )
    if existing:
        return existing

    task = KafkaTask(
        reference_id=project.id,
        reference_type="media_workflow",
        task_type="GENERATE_VIDEO_SCRIPT",
        status="PENDING",
        current_stage="QUEUED_SCRIPT",
        progress_percent=0,
        payload_jsonb={
            "content_id": str(project.primary_content_id),
            "trigger": trigger,
        },
    )
    project.status = "SCRIPTING"
    project.current_stage = "QUEUED_SCRIPT"
    project.progress_percent = 0
    db.add_all([task, project])
    db.commit()
    db.refresh(task)
    publish(
        GENERATE_VIDEO_SCRIPT_REQUESTED,
        build_event(
            event_type=GENERATE_VIDEO_SCRIPT_REQUESTED,
            source="planning-orchestrator",
            job_id=task.id,
            payload={"workflow_id": str(project.id), "run_type": task.task_type, "task_id": str(task.id), "trigger": trigger},
            correlation_id=project.id,
        ),
    )
    return task
