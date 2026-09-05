from __future__ import annotations

from datetime import datetime, timezone
import logging

from sqlalchemy.orm import Session
from fastapi import HTTPException

from common.core.vnexpress_rss import resolve_vnexpress_rss_feeds
from common.core.crawl_source_config import effective_source_configuration
from common.db.models import AuditLog, CrawlJob, CrawlJobSchedule, CrawlJobSource, CrawlSourceConfig, KafkaTask, User
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import CRAWL_JOB_CREATED
from common.planning.crawl_schedule import next_run_for_schedule
from app.schemas import api as schemas


logger = logging.getLogger(__name__)


class CrawlJobService:
    def create(self, db: Session, payload: schemas.CrawlJobCreateRequest, user: User) -> CrawlJob:
        role_names = {role.name for role in user.roles}
        if not user.is_system_admin and not role_names.intersection({"SYSTEM_ADMIN", "CREATOR", "USER"}):
            raise HTTPException(403, "Chỉ Creator hoặc System Admin được tạo crawl job")
        if len({source.source_config_id for source in payload.sources}) != len(payload.sources):
            raise HTTPException(400, "Không chọn trùng nguồn trong cùng job")
        # If user is not system admin, force PRIVATE scope and USER created_by_type
        scope = payload.content_scope if user.is_system_admin else "PRIVATE"
        created_by = payload.created_by_type if user.is_system_admin else "USER"
        is_scheduled = payload.schedule is not None
        job = CrawlJob(
            name=payload.name,
            crawl_mode="SOURCE_CONFIG" if is_scheduled else payload.crawl_mode,
            content_scope=scope,
            created_by_type=created_by,
            priority=payload.priority,
            requested_by=user.id,
            status="SCHEDULED" if is_scheduled and payload.schedule.enabled else ("PAUSED" if is_scheduled else "PENDING"),
            current_stage="SCHEDULING" if is_scheduled else "DISCOVERING",
        )
        for source in payload.sources:
            config = db.get(CrawlSourceConfig, source.source_config_id)
            if not config or config.status != "ACTIVE":
                raise HTTPException(400, "Nguồn crawl không tồn tại hoặc đã tạm dừng")
            source_type = config.source_type
            if source_type not in ("VNEXPRESS", "BILIBILI"):
                raise HTTPException(400, "Loại nguồn chưa hỗ trợ crawl")
            if source.source_type and source.source_type.upper() != source_type:
                raise HTTPException(400, "Loại nguồn không khớp cấu hình")
            configuration = effective_source_configuration(source_type, config.configuration)
            allowed = configuration.pop("job_options", [])
            for key in source.model_fields_set & {"source_url", "keywords"}:
                if key not in allowed:
                    raise HTTPException(400, f"Nguồn không cho phép tùy chỉnh {key}")
            if set(source.configuration) - (set(allowed) & {"rss_feed_keys"}):
                raise HTTPException(400, "Tùy chọn crawl không được nguồn hỗ trợ")
            if "rss_feed_keys" in source.configuration:
                keys = source.configuration["rss_feed_keys"]
                supported = configuration.get("rss_feed_keys", [])
                if not isinstance(keys, list) or not keys or any(key not in supported for key in keys):
                    raise HTTPException(400, "Chuyên mục không được nguồn hỗ trợ")
                configuration.pop("rss_feed_urls", None)
                configuration.pop("rss_feeds", None)
            configuration.update(source.configuration)
            configuration.pop("limit", None)
            configuration["max_items"] = source.max_items
            source_url = source.source_url if "source_url" in source.model_fields_set else config.source_url
            keywords = source.keywords if "keywords" in source.model_fields_set else config.keywords
            if source_type == "VNEXPRESS":
                selected_feeds = resolve_vnexpress_rss_feeds(configuration)
                if selected_feeds:
                    configuration["rss_feed_keys"] = [feed["key"] for feed in selected_feeds]
                    configuration["rss_feed_urls"] = [feed["url"] for feed in selected_feeds]
                    configuration["rss_feeds"] = selected_feeds
                    if not source_url and len(selected_feeds) == 1:
                        source_url = selected_feeds[0]["url"]
            job.sources.append(
                CrawlJobSource(
                    source_type=source_type,
                    source_url=source_url,
                    keywords=list(keywords or []),
                    configuration=configuration,
                    source_config_id=source.source_config_id,
                )
            )
        if payload.schedule:
            job.schedule = CrawlJobSchedule(
                enabled=payload.schedule.enabled,
                runs_per_day=payload.schedule.runs_per_day,
                window_start=payload.schedule.window_start,
                window_end=payload.schedule.window_end,
                weekdays=payload.schedule.weekdays,
                timezone=payload.schedule.timezone,
            )
            if job.schedule.enabled:
                job.schedule.next_run_at = next_run_for_schedule(job.schedule, after=datetime.now(timezone.utc))
        db.add(job)
        db.add(
            AuditLog(
                actor_id=user.id,
                action="crawl_job.created",
                target_type="crawl_job",
                metadata_json={"name": job.name, "scheduled": is_scheduled},
            )
        )
        db.commit()
        db.refresh(job)
        if is_scheduled:
            return job
        try:
            self.publish_created(job, {"job_id": str(job.id), "source_count": len(job.sources), "requested_by": str(user.id)})
        except Exception as exc:
            logger.exception("Failed to publish crawl job created event for %s", job.id)
            db.add(
                AuditLog(
                    actor_id=user.id,
                    action="crawl_job.publish_failed",
                    target_type="crawl_job",
                    target_id=str(job.id),
                    metadata_json={"error": str(exc)},
                )
            )
            db.commit()
        return job

    def update_schedule(
        self,
        db: Session,
        job: CrawlJob,
        payload: schemas.CrawlJobScheduleRequest,
        user: User,
    ) -> CrawlJob:
        schedule = job.schedule
        if schedule is None:
            schedule = CrawlJobSchedule(job=job)
            db.add(schedule)

        schedule.enabled = payload.enabled
        schedule.runs_per_day = payload.runs_per_day
        schedule.window_start = payload.window_start
        schedule.window_end = payload.window_end
        schedule.weekdays = payload.weekdays
        schedule.timezone = payload.timezone
        schedule.next_run_at = (
            next_run_for_schedule(schedule, after=datetime.now(timezone.utc)) if payload.enabled else None
        )
        job.crawl_mode = "SOURCE_CONFIG"
        job.status = "SCHEDULED" if payload.enabled else "PAUSED"
        job.current_stage = "SCHEDULING"
        db.add(
            AuditLog(
                actor_id=user.id,
                action="crawl_job.schedule_updated",
                target_type="crawl_job",
                target_id=str(job.id),
                metadata_json={
                    "enabled": payload.enabled,
                    "runs_per_day": payload.runs_per_day,
                    "weekdays": payload.weekdays,
                    "timezone": payload.timezone,
                },
            )
        )
        db.commit()
        db.refresh(job)
        return job

    def cancel(self, db: Session, job: CrawlJob, user: User) -> CrawlJob:
        if job.schedule:
            job.schedule.enabled = False
            job.schedule.next_run_at = None
        job.status = "CANCELLED"
        job.current_stage = "COMPLETED"
        job.completed_at = datetime.utcnow()
        for task in job.tasks:
            if task.status in {"PENDING", "QUEUED", "RUNNING", "RETRYING"}:
                task.status = "CANCELLED"
                task.completed_at = datetime.utcnow()
        db.add(AuditLog(actor_id=user.id, action="crawl_job.cancelled", target_type="crawl_job", target_id=str(job.id)))
        db.commit()
        db.refresh(job)
        return job

    def retry(self, db: Session, job: CrawlJob, user: User) -> CrawlJob:
        job.status = "QUEUED"
        job.current_stage = "DISCOVERING"
        job.total_discovered = 0
        job.total_crawled = 0
        job.total_normalized = 0
        job.total_failed = 0
        job.total_duplicates = 0
        job.progress_percent = 0
        job.started_at = None
        job.completed_at = None
        db.query(KafkaTask).filter(KafkaTask.reference_id == str(job.id), KafkaTask.task_type.startswith("CRAWL")).delete(synchronize_session=False)
        db.add(AuditLog(actor_id=user.id, action="crawl_job.retry", target_type="crawl_job", target_id=str(job.id)))
        db.commit()
        db.refresh(job)
        self.publish_created(job, {"job_id": str(job.id), "retry": True})
        return job

    def publish_created(self, job: CrawlJob, payload: dict) -> None:
        publish(CRAWL_JOB_CREATED, build_event(event_type=CRAWL_JOB_CREATED, source="api-service", job_id=job.id, payload=payload))
