from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.video.consumers.generate_video_requested import run_generate_video_requested_consumer


class HealthHandler(BaseHTTPRequestHandler):
    task_types: set[str] = set()

    def do_GET(self) -> None:  # noqa: N802 - stdlib HTTP handler contract
        if self.path.rstrip("/") != "/health":
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps({
            "status": "ok",
            "service": "ai-media-worker",
            "detail": "Worker consumer đang chạy",
            "task_types": sorted(self.task_types),
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args) -> None:
        return


def start_health_server(task_types: set[str]) -> ThreadingHTTPServer:
    HealthHandler.task_types = task_types
    port = int(os.getenv("HEALTH_PORT", "8060"))
    server = ThreadingHTTPServer(("0.0.0.0", port), HealthHandler)
    threading.Thread(target=server.serve_forever, name="ai-media-health", daemon=True).start()
    return server


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

    start_health_server(task_types)
    run_generate_video_requested_consumer(
        task_types=task_types,
        group_id="generate-video-workers",
    )


if __name__ == "__main__":
    main()
