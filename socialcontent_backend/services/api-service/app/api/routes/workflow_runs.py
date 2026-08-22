import asyncio
import os
import sys
import threading
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import MediaWorkflow, WorkflowRun, SocialProfile, User
from common.db.session import SessionLocal, get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import PROJECT_RUN_CREATED
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


def _trigger_local_pipeline_fallback(run_id: uuid.UUID) -> None:
    def _bg_run(run_id_str: str):
        try:
            # Dynamically add ai-media-engine path to sys.path if not present
            current_dir = os.path.dirname(os.path.abspath(__file__))
            engine_path = os.path.abspath(os.path.join(current_dir, "../../../ai-media-engine"))
            if engine_path not in sys.path:
                sys.path.insert(0, engine_path)

            from app.planning.services.pipeline import PlanningPipeline
            pipeline = PlanningPipeline()
            with SessionLocal() as bg_db:
                pipeline.handle_workflow_run_created(bg_db, {"job_id": run_id_str})
        except Exception as e:
            print(f"[api-service] Fail-safe thread execution warning: {e}")

    threading.Thread(target=_bg_run, args=(str(run_id),), daemon=True).start()


@router.post("", response_model=schemas.WorkflowRunResponse)
def create_workflow_run(
    payload: schemas.WorkflowRunCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = db.get(SocialProfile, payload.profile_id)
    if not profile or (not user.is_system_admin and profile.user_id != user.id):
        raise HTTPException(status_code=404, detail="Social profile not found")

    workflow = db.get(MediaWorkflow, payload.workflow_id)
    if not workflow or (not user.is_system_admin and workflow.user_id != user.id):
        raise HTTPException(status_code=404, detail="Media workflow not found")

    run = WorkflowRun(
        workflow_id=workflow.id,
        run_type="PLANNING",
        status="PENDING",
        current_stage="QUEUED",
        progress_percent=0,
        metadata_json={
            "planning_mode": payload.planning_mode or workflow.planning_mode or "SERIES",
            "target_duration_seconds": payload.target_duration_seconds,
            "preferred_part_count": payload.preferred_part_count,
            "language": payload.language or "vi",
            "instructions": payload.instructions,
            "skip_ai_evaluation": payload.skip_ai_evaluation,
            "attempt_count": 1,
        },
    )
    db.add(run)
    workflow.status = "PLANNING_RUNNING"
    workflow.current_stage = "QUEUED"
    workflow.progress_percent = 0
    db.commit()
    db.refresh(run)

    event_payload = {
        "job_id": str(run.id),
        "workflow_id": str(workflow.id),
        "user_id": str(user.id),
        "profile_id": str(profile.id),
    }

    try:
        publish(
            PROJECT_RUN_CREATED,
            build_event(
                event_type=PROJECT_RUN_CREATED,
                source="api-service",
                job_id=run.id,
                payload=event_payload,
            ),
        )
    except Exception as exc:
        print(f"[api-service] Kafka publish warning: {exc}")

    # Launch local fail-safe thread to ensure job never hangs in PENDING if worker is delayed/offline
    _trigger_local_pipeline_fallback(run.id)

    return _serialize_workflow_run(run)


@router.get("", response_model=list[schemas.WorkflowRunResponse])
def list_workflow_runs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    runs_query = db.query(WorkflowRun).join(MediaWorkflow, MediaWorkflow.id == WorkflowRun.workflow_id).filter(WorkflowRun.run_type == "PLANNING")
    if not user.is_system_admin:
        runs_query = runs_query.filter(MediaWorkflow.user_id == user.id)
    runs = runs_query.order_by(WorkflowRun.created_at.desc()).limit(100).all()
    return [_serialize_workflow_run(run) for run in runs]


@router.get("/{run_id}", response_model=schemas.WorkflowRunResponse)
def get_workflow_run(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_workflow_run(db, run_id, user)
    if run:
        return _serialize_workflow_run(run)
    raise HTTPException(status_code=404, detail="Planning run not found")


@router.post("/{run_id}/cancel", response_model=schemas.WorkflowRunResponse)
def cancel_workflow_run(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_workflow_run(db, run_id, user)
    if not run:
        raise HTTPException(status_code=404, detail="Planning run not found")
    run.status = "CANCELLED"
    if run.project:
        run.project.status = "FAILED"
    db.commit()
    db.refresh(run)
    return _serialize_workflow_run(run)


@router.post("/{run_id}/retry", response_model=schemas.WorkflowRunResponse)
def retry_workflow_run(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_workflow_run(db, run_id, user)
    if not run:
        raise HTTPException(status_code=404, detail="Planning run not found")

    metadata = dict(run.metadata_json or {})
    current_attempts = metadata.get("attempt_count", 1)
    metadata["attempt_count"] = current_attempts + 1
    run.metadata_json = metadata

    run.status = "PENDING"
    run.current_stage = "QUEUED"
    run.progress_percent = 0
    run.error_message = None
    if run.project:
        run.project.status = "PLANNING_RUNNING"
    db.commit()
    db.refresh(run)

    event_payload = {
        "job_id": str(run.id),
        "workflow_id": str(run.workflow_id),
        "user_id": str(user.id),
        "profile_id": str(run.profile_id),
    }

    try:
        publish(
            PROJECT_RUN_CREATED,
            build_event(
                event_type=PROJECT_RUN_CREATED,
                source="api-service",
                job_id=run.id,
                payload=event_payload,
            ),
        )
    except Exception as exc:
        print(f"[api-service] Kafka retry publish warning: {exc}")

    # Launch local fail-safe thread to ensure job never hangs in PENDING
    _trigger_local_pipeline_fallback(run.id)

    return _serialize_workflow_run(run)


@router.get("/{run_id}/candidates", response_model=list[schemas.WorkflowCandidateResponse])
def workflow_run_candidates(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_workflow_run(db, run_id, user)
    if run:
        return [_serialize_workflow_candidate(run_id, candidate) for candidate in run.project.candidates]
    raise HTTPException(status_code=404, detail="Planning run not found")


@router.patch("/{run_id}/candidates/{candidate_id}", response_model=schemas.WorkflowCandidateResponse)
def update_workflow_candidate(
    run_id: uuid.UUID,
    candidate_id: uuid.UUID,
    payload: schemas.WorkflowCandidateUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=410, detail="Legacy project candidate mutation was removed. Update workflow_candidates instead.")


@router.post("/{run_id}/candidates/reselect", response_model=list[schemas.WorkflowCandidateResponse])
def reselect_workflow_candidates(
    run_id: uuid.UUID,
    payload: schemas.WorkflowCandidateReselectRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=410, detail="Legacy project candidate reselection was removed. Update workflow_candidates instead.")


@router.get("/{run_id}/events")
async def workflow_run_events(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_workflow_run(db, run_id, user)
    if run:
        async def project_stream():
            for _ in range(90):
                with SessionLocal() as session:
                    current = session.get(WorkflowRun, run_id)
                    if not current:
                        break
                    yield (
                        "event: progress\n"
                        f"data: {{\"run_id\":\"{current.id}\",\"status\":\"{current.status}\",\"stage\":\"{current.current_stage}\","
                        f"\"progress\":{float(current.progress_percent or 0)},\"attempt_count\":{current.attempt_count}}}\n\n"
                    )
                    if current.status in {"SUCCEEDED", "WAITING_REVIEW", "FAILED", "CANCELLED"}:
                        break
                await asyncio.sleep(2)

        return StreamingResponse(project_stream(), media_type="text/event-stream")
    raise HTTPException(status_code=404, detail="Planning run not found")


@router.get("/{run_id}/logs")
def workflow_run_logs(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_workflow_run(db, run_id, user)
    if run:
        return [_serialize_workflow_run_log(run)]
    raise HTTPException(status_code=404, detail="Planning run not found")


def _get_owned_workflow_run(db: Session, run_id: uuid.UUID, user: User) -> WorkflowRun | None:
    run = db.get(WorkflowRun, run_id)
    if not run or run.run_type != "PLANNING":
        return None
    if not user.is_system_admin and run.project.user_id != user.id:
        raise HTTPException(status_code=404, detail="Project run not found")
    return run


def _serialize_workflow_run(run: WorkflowRun) -> dict:
    metadata = run.metadata_json if isinstance(run.metadata_json, dict) else {}
    project = run.project
    return {
        "id": run.id,
        "user_id": project.user_id,
        "profile_id": project.profile_id,
        "workflow_id": project.id,
        "planning_mode": metadata.get("planning_mode") or project.planning_mode or "SERIES",
        "status": run.status,
        "current_stage": run.current_stage or project.current_stage or "",
        "progress_percent": float(run.progress_percent or 0),
        "target_duration_seconds": metadata.get("target_duration_seconds"),
        "preferred_part_count": metadata.get("preferred_part_count"),
        "language": metadata.get("language") or "vi",
        "instructions": metadata.get("instructions"),
        "attempt_count": run.attempt_count,
        "error_code": None,
        "error_message": run.error_message,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }


def _serialize_workflow_candidate(job_id: uuid.UUID, candidate) -> dict:
    metadata = candidate.metadata_json if isinstance(candidate.metadata_json, dict) else {}
    return {
        "id": candidate.id,
        "workflow_run_id": job_id,
        "content_id": candidate.content_id,
        "story_id": candidate.story_id,
        "episode_id": candidate.episode_id,
        "candidate_score": float(candidate.score or 0),
        "eligible": bool(candidate.eligible),
        "rank_order": candidate.rank_order,
        "score_breakdown": metadata.get("score_breakdown") or {},
        "selection_reasons": metadata.get("selection_reasons") or [],
        "rejection_reasons": metadata.get("rejection_reasons") or [],
        "content_title": candidate.content_title,
        "content_url": candidate.content_url,
        "created_at": candidate.created_at,
    }


def _serialize_workflow_run_log(run: WorkflowRun) -> dict:
    return {
        "id": run.id,
        "workflow_run_id": run.id,
        "step_name": run.current_stage or "PROJECT_RUN",
        "model_provider": None,
        "model_name": None,
        "prompt_version": "workflow-run",
        "input_tokens": None,
        "output_tokens": None,
        "latency_ms": None,
        "status": run.status,
        "error_message": run.error_message,
        "created_at": run.created_at,
    }
