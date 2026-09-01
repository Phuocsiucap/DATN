from __future__ import annotations

import time
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from common.core.config import get_settings
from common.db.crawl_status import add_crawl_log
from common.db.models import CrawlJob, CrawlJobSchedule, CrawlJobSource
from common.db.session import SessionLocal
from common.planning.crawl_schedule import next_run_for_schedule, timezone_info
from app.orchestrator.producers.tasks import CrawlTaskProducer


class PeriodicSourceScheduler:
    def __init__(self, producer: CrawlTaskProducer | None = None) -> None:
        self.producer = producer or CrawlTaskProducer()

    def run_forever(self) -> None:
        settings = get_settings()
        if not settings.enable_scheduler:
            print("Scheduler disabled; crawl-orchestrator scheduler idle")
            return

        while True:
            with SessionLocal() as db:
                try:
                    self.tick(db)
                except Exception as exc:
                    db.rollback()
                    print(f"[crawl-scheduler] Tick failed: {exc}")
            time.sleep(max(settings.scheduler_poll_seconds, 5))

    def tick(self, db: Session, *, now: datetime | None = None) -> int:
        current_time = now or datetime.now(timezone.utc)
        if current_time.tzinfo is None:
            current_time = current_time.replace(tzinfo=timezone.utc)

        schedules = (
            db.query(CrawlJobSchedule)
            .options(selectinload(CrawlJobSchedule.job).selectinload(CrawlJob.sources))
            .join(CrawlJob, CrawlJob.id == CrawlJobSchedule.job_id)
            .filter(
                CrawlJobSchedule.enabled.is_(True),
                CrawlJob.crawl_mode == "SOURCE_CONFIG",
                CrawlJob.status == "SCHEDULED",
                or_(CrawlJobSchedule.next_run_at.is_(None), CrawlJobSchedule.next_run_at <= current_time),
            )
            .order_by(CrawlJobSchedule.next_run_at.asc().nullsfirst())
            .with_for_update(skip_locked=True)
            .limit(100)
            .all()
        )

        pending_events: list[tuple[CrawlJob, CrawlJobSchedule, datetime]] = []
        for schedule in schedules:
            due_at = schedule.next_run_at
            if due_at is None:
                due_at = next_run_for_schedule(schedule, after=current_time)
                schedule.next_run_at = due_at
            if due_at > current_time:
                continue

            run = self.create_run_from_schedule(db, schedule, due_at=due_at)
            schedule.last_run_at = current_time
            schedule.next_run_at = next_run_for_schedule(schedule, after=current_time, inclusive=False)
            pending_events.append((run, schedule, due_at))

        db.commit()

        for run, schedule, due_at in pending_events:
            try:
                self.producer.job_created(
                    job_id=run.id,
                    payload={
                        "job_id": str(run.id),
                        "scheduled_from_job_id": str(schedule.job_id),
                        "scheduled_for": due_at.isoformat(),
                    },
                )
            except Exception as exc:
                # The run remains PENDING so the orchestrator's recovery poll can pick it up.
                print(f"[crawl-scheduler] Could not publish run {run.id}: {exc}")
        return len(pending_events)

    def create_run_from_schedule(
        self,
        db: Session,
        schedule: CrawlJobSchedule,
        *,
        due_at: datetime,
    ) -> CrawlJob:
        template = schedule.job
        local_due = due_at.astimezone(timezone_info(schedule.timezone))
        job = CrawlJob(
            name=f"{template.name} · {local_due.strftime('%d/%m/%Y %H:%M')}",
            crawl_mode="SCHEDULED_RUN",
            content_scope=template.content_scope,
            created_by_type=template.created_by_type,
            priority=template.priority,
            requested_by=template.requested_by,
            status="PENDING",
            current_stage="DISCOVERING",
        )
        for source in template.sources:
            configuration = dict(source.configuration or {})
            configuration.pop("scheduler", None)
            configuration.update(
                {
                    "scheduled_from_job_id": str(template.id),
                    "scheduled_from_schedule_id": str(schedule.id),
                    "scheduled_for": due_at.isoformat(),
                }
            )
            job.sources.append(
                CrawlJobSource(
                    source_type=source.source_type,
                    source_url=source.source_url,
                    keywords=list(source.keywords or []),
                    configuration=configuration,
                    status="ACTIVE",
                )
            )
        db.add(job)
        db.flush()
        add_crawl_log(
            db,
            job_id=job.id,
            source_type="SCHEDULE",
            stage="SCHEDULING",
            message="Scheduled crawl job run created",
            metadata={
                "schedule_id": str(schedule.id),
                "template_job_id": str(template.id),
                "scheduled_for": due_at.isoformat(),
            },
        )
        return job


def run_periodic_source_scheduler() -> None:
    PeriodicSourceScheduler().run_forever()
