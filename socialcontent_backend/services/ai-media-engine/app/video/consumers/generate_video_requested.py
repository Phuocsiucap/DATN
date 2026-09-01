from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from common.core.config import get_settings
from common.events.kafka import consumer
from common.events.topics import (
    GENERATE_VIDEO_EDIT_REQUESTED,
    GENERATE_VIDEO_REVIEW_REQUESTED,
    GENERATE_VIDEO_SCRIPT_REQUESTED,
    GENERATE_VIDEO_VOICE_REQUESTED,
)
from app.video.services.generate_video_jobs import (
    process_generate_video_edit_run,
    process_generate_video_review_run,
    process_generate_video_script_run,
    process_generate_video_voice_run,
)

TASK_TOPIC_MAP = {
    "GENERATE_VIDEO_SCRIPT": GENERATE_VIDEO_SCRIPT_REQUESTED,
    "GENERATE_VIDEO_EDIT": GENERATE_VIDEO_EDIT_REQUESTED,
    "GENERATE_VIDEO_REVIEW": GENERATE_VIDEO_REVIEW_REQUESTED,
    "GENERATE_VIDEO_VOICE": GENERATE_VIDEO_VOICE_REQUESTED,
}

TOPIC_PROCESSORS = {
    GENERATE_VIDEO_SCRIPT_REQUESTED: process_generate_video_script_run,
    GENERATE_VIDEO_EDIT_REQUESTED: process_generate_video_edit_run,
    GENERATE_VIDEO_REVIEW_REQUESTED: process_generate_video_review_run,
    GENERATE_VIDEO_VOICE_REQUESTED: process_generate_video_voice_run,
}


def _enabled_task_types(task_types: set[str] | None = None) -> list[str]:
    if task_types is None:
        return list(TASK_TOPIC_MAP)
    return [task_type for task_type in TASK_TOPIC_MAP if task_type in task_types]


def process_pending_tasks_from_db(task_types: set[str] | None = None) -> None:
    from common.db.models import KafkaTask
    from common.db.session import SessionLocal

    enabled_task_types = _enabled_task_types(task_types)
    if not enabled_task_types:
        return

    db = SessionLocal()
    try:
        stale_before = datetime.now(timezone.utc) - timedelta(minutes=10)
        stale_tasks = (
            db.query(KafkaTask)
            .filter(
                KafkaTask.task_type.in_(enabled_task_types),
                KafkaTask.status.in_(["RUNNING", "PROCESSING"]),
                KafkaTask.started_at.isnot(None),
                KafkaTask.started_at < stale_before,
            )
            .all()
        )
        for task in stale_tasks:
            print(f"[Worker DB Sweep] Recovering stale task {task.id} (type: {task.task_type})...")
            task.status = "PENDING"
            task.current_stage = "QUEUED_RETRY"
            task.progress_percent = 0
            task.completed_at = None
            task.error_message = "Recovered stale RUNNING task for local DB polling retry."
            db.add(task)
        if stale_tasks:
            db.commit()

        pending_tasks = (
            db.query(KafkaTask)
            .filter(
                KafkaTask.task_type.in_(enabled_task_types),
                KafkaTask.status == "PENDING",
            )
            .order_by(KafkaTask.created_at.asc())
            .all()
        )
        for task in pending_tasks:
            print(f"[Worker DB Sweep] Processing pending task {task.id} (type: {task.task_type})...")
            try:
                if task.task_type == "GENERATE_VIDEO_SCRIPT":
                    process_generate_video_script_run(task.id)
                elif task.task_type == "GENERATE_VIDEO_EDIT":
                    process_generate_video_edit_run(task.id)
                elif task.task_type == "GENERATE_VIDEO_REVIEW":
                    process_generate_video_review_run(task.id)
                elif task.task_type == "GENERATE_VIDEO_VOICE":
                    process_generate_video_voice_run(task.id)
            except Exception as exc:
                print(f"[Worker DB Sweep Error] Task {task.id} failed: {exc}")
    except Exception as exc:
        print(f"[Worker DB Sweep Error] Failed query: {exc}")
    finally:
        db.close()


def run_generate_video_requested_consumer(
    *,
    task_types: set[str] | None = None,
    group_id: str = "generate-video-workers",
) -> None:
    settings = get_settings()
    enabled_task_types = set(_enabled_task_types(task_types))
    topics = [TASK_TOPIC_MAP[task_type] for task_type in enabled_task_types]

    # Always process pending DB tasks on startup
    process_pending_tasks_from_db(enabled_task_types)

    if settings.disable_kafka:
        print(f"Kafka disabled; generate-video worker using DB polling for: {', '.join(sorted(enabled_task_types))}")
        while True:
            process_pending_tasks_from_db(enabled_task_types)
            time.sleep(5)

    try:
        kafka_consumer = consumer(topics, group_id=group_id)
        print(f"Generate-video worker subscribed to {', '.join(topics)} with group_id={group_id}")
        for record in kafka_consumer:
            process_pending_tasks_from_db(enabled_task_types)
            event = record.value if isinstance(record.value, dict) else {}
            job_id = event.get("job_id") or (event.get("payload") or {}).get("run_id") or (event.get("payload") or {}).get("task_id")
            if job_id:
                event_type = event.get("event_type") or record.topic
                processor = TOPIC_PROCESSORS.get(event_type)
                if processor and event_type in topics:
                    processor(job_id)
            kafka_consumer.commit()
    except Exception as exc:
        print(f"[Kafka Consumer Warning] Fallback to DB polling due to: {exc}")
        while True:
            process_pending_tasks_from_db(enabled_task_types)
            time.sleep(5)
