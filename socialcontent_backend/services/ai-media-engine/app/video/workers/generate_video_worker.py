from __future__ import annotations

from app.video.consumers.generate_video_requested import run_generate_video_requested_consumer


def main() -> None:
    run_generate_video_requested_consumer(
        task_types={
            "GENERATE_VIDEO_SCRIPT",
            "GENERATE_VIDEO_EDIT",
            "GENERATE_VIDEO_REVIEW",
            "GENERATE_VIDEO_VOICE",
            "GENERATE_VIDEO_RENDER",
        },
        group_id="generate-video-workers",
    )


if __name__ == "__main__":
    main()
