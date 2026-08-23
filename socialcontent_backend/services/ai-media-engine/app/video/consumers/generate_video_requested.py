from __future__ import annotations

from common.core.config import get_settings
from common.events.kafka import consumer
from common.events.topics import (
    GENERATE_VIDEO_EDIT_REQUESTED,
    GENERATE_VIDEO_RENDER_REQUESTED,
    GENERATE_VIDEO_REVIEW_REQUESTED,
    GENERATE_VIDEO_SCRIPT_REQUESTED,
    GENERATE_VIDEO_VOICE_REQUESTED,
)
from app.video.services.generate_video import (
    process_generate_video_edit_run,
    process_generate_video_render_run,
    process_generate_video_review_run,
    process_generate_video_script_run,
    process_generate_video_voice_run,
)


def run_generate_video_requested_consumer() -> None:
    settings = get_settings()
    if settings.disable_kafka:
        print("Kafka disabled; generate-video worker idle")
        return

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
        event = record.value if isinstance(record.value, dict) else {}
        job_id = event.get("job_id") or (event.get("payload") or {}).get("run_id")
        if not job_id:
            kafka_consumer.commit()
            continue

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
