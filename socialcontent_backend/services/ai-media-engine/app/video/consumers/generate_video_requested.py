from __future__ import annotations

import time
from common.core.config import get_settings
from common.events.kafka import consumer
from common.events.topics import (
    GENERATE_VIDEO_EDIT_REQUESTED,
    GENERATE_VIDEO_RENDER_REQUESTED,
    GENERATE_VIDEO_REVIEW_REQUESTED,
    GENERATE_VIDEO_SCRIPT_REQUESTED,
    GENERATE_VIDEO_VOICE_REQUESTED,
)
from app.video.services.generate_video_jobs import (
    process_generate_video_edit_run,
    process_generate_video_render_run,
    process_generate_video_review_run,
    process_generate_video_script_run,
    process_generate_video_voice_run,
)


def process_pending_tasks_from_db() -> None:
    from common.db.models import KafkaTask
    from common.db.session import SessionLocal

    db = SessionLocal()
    try:
        pending_tasks = (
            db.query(KafkaTask)
            .filter(
                KafkaTask.task_type.in_(
                    [
                        "GENERATE_VIDEO_SCRIPT",
                        "GENERATE_VIDEO_EDIT",
                        "GENERATE_VIDEO_REVIEW",
                        "GENERATE_VIDEO_VOICE",
                        "GENERATE_VIDEO_RENDER",
                    ]
                ),
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
                elif task.task_type == "GENERATE_VIDEO_RENDER":
                    process_generate_video_render_run(task.id)
            except Exception as exc:
                print(f"[Worker DB Sweep Error] Task {task.id} failed: {exc}")
    except Exception as exc:
        print(f"[Worker DB Sweep Error] Failed query: {exc}")
    finally:
        db.close()


def run_generate_video_requested_consumer() -> None:
    settings = get_settings()

    # Always process pending DB tasks on startup
    process_pending_tasks_from_db()

    if settings.disable_kafka:
        print("Kafka disabled; generate-video worker idle")
        return

    try:
        kafka_consumer = consumer(
            [
                GENERATE_VIDEO_SCRIPT_REQUESTED,
                GENERATE_VIDEO_EDIT_REQUESTED,
                GENERATE_VIDEO_REVIEW_REQUESTED,
                GENERATE_VIDEO_VOICE_REQUESTED,
                GENERATE_VIDEO_RENDER_REQUESTED,
            ],
            group_id="generate-video-workers",
        )
        for record in kafka_consumer:
            process_pending_tasks_from_db()
            event = record.value if isinstance(record.value, dict) else {}
            job_id = event.get("job_id") or (event.get("payload") or {}).get("run_id") or (event.get("payload") or {}).get("task_id")
            if job_id:
                event_type = event.get("event_type") or record.topic
                if event_type == GENERATE_VIDEO_SCRIPT_REQUESTED:
                    process_generate_video_script_run(job_id)
                elif event_type == GENERATE_VIDEO_EDIT_REQUESTED:
                    process_generate_video_edit_run(job_id)
                elif event_type == GENERATE_VIDEO_REVIEW_REQUESTED:
                    process_generate_video_review_run(job_id)
                elif event_type == GENERATE_VIDEO_VOICE_REQUESTED:
                    process_generate_video_voice_run(job_id)
                elif event_type == GENERATE_VIDEO_RENDER_REQUESTED:
                    process_generate_video_render_run(job_id)
            kafka_consumer.commit()
    except Exception as exc:
        print(f"[Kafka Consumer Warning] Fallback to DB polling due to: {exc}")
        while True:
            process_pending_tasks_from_db()
            time.sleep(5)
