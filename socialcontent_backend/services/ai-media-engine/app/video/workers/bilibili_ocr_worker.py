from __future__ import annotations

import os

from app.video.consumers.generate_video_requested import run_generate_video_requested_consumer
from app.video.services.bilibili_ocr_jobs import BILIBILI_OCR_TASK_TYPE
from app.video.workers.generate_video_worker import start_health_server


def main() -> None:
    task_types = {BILIBILI_OCR_TASK_TYPE}
    os.environ.setdefault("HEALTH_PORT", "8061")
    start_health_server(task_types, service_name="ai-media-ocr-worker")
    run_generate_video_requested_consumer(
        task_types=task_types,
        group_id=os.getenv("BILIBILI_OCR_WORKER_GROUP_ID", "bilibili-ocr-workers"),
    )


if __name__ == "__main__":
    main()
