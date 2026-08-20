from __future__ import annotations

from app.consumers.generate_video_requested import run_generate_video_requested_consumer


def main() -> None:
    run_generate_video_requested_consumer()


if __name__ == "__main__":
    main()
