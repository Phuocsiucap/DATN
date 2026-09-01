from __future__ import annotations

import os
from app.video.consumers.generate_video_requested import run_generate_video_requested_consumer


def main() -> None:
    env_types = os.getenv("GENERATE_VIDEO_WORKER_TASK_TYPES")
    if env_types:
        task_types = {t.strip() for t in env_types.split(",") if t.strip()}
    else:
        task_types = {
            "GENERATE_VIDEO_SCRIPT",
            "GENERATE_VIDEO_EDIT",
            "GENERATE_VIDEO_REVIEW",
            "GENERATE_VIDEO_VOICE",
        }

    run_generate_video_requested_consumer(
        task_types=task_types,
        group_id="generate-video-workers",
    )


if __name__ == "__main__":
    main()
