from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from common.core.config import get_settings
from common.db.crawl_status import add_crawl_log
from common.db.models import CrawlJob, CrawlJobSource
from common.db.session import SessionLocal
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
                self.tick(db)
            time.sleep(max(settings.scheduler_poll_seconds, 5))

    def tick(self, db: Session) -> int:
        sources = (
            db.query(CrawlJobSource)
            .join(CrawlJob, CrawlJob.id == CrawlJobSource.job_id)
            .filter(CrawlJob.crawl_mode == "SOURCE_CONFIG", CrawlJobSource.status == "ACTIVE")
            .all()
        )
        triggered = 0
        for source in sources:
            if not self.is_due(source):
                continue
            job = self.create_run_from_source(db, source)
            self.mark_triggered(source)
            db.commit()
            self.producer.job_created(job_id=job.id, payload={"job_id": str(job.id), "scheduled_from_source_id": str(source.id)})
            triggered += 1
        return triggered

    def is_due(self, source: CrawlJobSource) -> bool:
        config = source.configuration or {}
        if not config.get("schedule_enabled"):
            return False
        interval_minutes = max(int(config.get("interval_minutes", 60)), 1)
        scheduler_state = config.get("scheduler") or {}
        last_triggered_at = scheduler_state.get("last_triggered_at")
        if not last_triggered_at:
            return True
        try:
            last_run = datetime.fromisoformat(str(last_triggered_at).replace("Z", "+00:00"))
        except ValueError:
            return True
        return datetime.now(timezone.utc) - last_run >= timedelta(minutes=interval_minutes)

    def create_run_from_source(self, db: Session, source: CrawlJobSource) -> CrawlJob:
        template = source.job
        job = CrawlJob(
            name=f"{template.name} scheduled {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}",
            crawl_mode="SCHEDULED_RUN",
            priority=template.priority,
            requested_by=template.requested_by,
            status="PENDING",
            current_stage="DISCOVERING",
        )
        job.sources.append(
            CrawlJobSource(
                source_type=source.source_type,
                source_url=source.source_url,
                keywords=source.keywords,
                configuration={**(source.configuration or {}), "scheduled_from_source_id": str(source.id)},
                status="ACTIVE",
            )
        )
        db.add(job)
        db.flush()
        add_crawl_log(
            db,
            job_id=job.id,
            source_type=source.source_type,
            stage="SCHEDULING",
            message="Scheduled crawl job created from source config",
            metadata={"source_id": str(source.id), "template_job_id": str(template.id)},
        )
        return job

    def mark_triggered(self, source: CrawlJobSource) -> None:
        config = dict(source.configuration or {})
        scheduler_state = dict(config.get("scheduler") or {})
        scheduler_state["last_triggered_at"] = datetime.now(timezone.utc).isoformat()
        config["scheduler"] = scheduler_state
        source.configuration = config
        flag_modified(source, "configuration")


def run_periodic_source_scheduler() -> None:
    PeriodicSourceScheduler().run_forever()
