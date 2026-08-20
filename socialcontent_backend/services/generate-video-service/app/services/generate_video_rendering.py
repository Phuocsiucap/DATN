from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any

from app.services.generate_video_constants import RENDER_JOB_DIR, RENDER_WORKSPACE_ROOT, VIDEO_OUT_DIR
from app.services.generate_video_timeline import normalize_story_for_project, replace_default_images_with_source_images, sync_story_timeline


def generate_visual_video(story: dict[str, Any]) -> dict[str, Any]:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    owner_id = str(meta.get("project_id") or uuid.uuid4()).strip()
    output_name = f"visual-{owner_id}-{uuid.uuid4().hex[:8]}.mp4"
    output_path = VIDEO_OUT_DIR / output_name
    VIDEO_OUT_DIR.mkdir(parents=True, exist_ok=True)

    visual_story = dict(story)
    replace_default_images_with_source_images(visual_story)
    sync_story_timeline(visual_story)
    visual_story["audio"] = {
        **dict(story.get("audio") or {}),
        "voice": None,
        "music": None,
        "voiceVolume": 0,
        "musicVolume": 0,
    }
    visual_story["timeline"] = {
        **dict(visual_story.get("timeline") or {}),
        "audio": [],
    }
    job_dir = RENDER_JOB_DIR / uuid.uuid4().hex
    job_dir.mkdir(parents=True, exist_ok=True)
    props_path = job_dir / "props.json"
    props_path.write_text(json.dumps({"story": visual_story}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        run_remotion_render(output_path, props_path=props_path)
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)

    story.setdefault("video_artifacts", {})
    story["video_artifacts"]["visual_only"] = f"out/{output_name}"
    return {
        "story": story,
        "video_url": f"/api/v1/generate-video/output/{output_name}",
        "video_path": str(output_path),
    }



def export_final_video(story: dict[str, Any], render_job_id: str | None = None) -> dict[str, Any]:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    owner_id = str(meta.get("project_id") or uuid.uuid4()).strip()
    render_key = (render_job_id or uuid.uuid4().hex).replace("-", "")[:12]
    output_name = f"final-{owner_id}-{render_key}.mp4"
    output_path = VIDEO_OUT_DIR / output_name
    VIDEO_OUT_DIR.mkdir(parents=True, exist_ok=True)

    story = normalize_story_for_project(story)
    job_dir = RENDER_JOB_DIR / (render_job_id or uuid.uuid4().hex)
    job_dir.mkdir(parents=True, exist_ok=True)
    props_path = job_dir / "props.json"
    props_path.write_text(json.dumps({"story": story}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        run_remotion_render(output_path, props_path=props_path)
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)

    story.setdefault("video_artifacts", {})
    story["video_artifacts"]["final"] = f"out/{output_name}"
    return {
        "story": story,
        "video_url": f"/api/v1/generate-video/output/{output_name}",
        "artifact_path": f"out/{output_name}",
        "video_path": str(output_path),
    }



def run_remotion_render(output_path: Path, props_path: Path | None = None) -> None:
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise RuntimeError("npm is required to render visual video")
    command = [
        npm,
        "exec",
        "remotion",
        "--",
        "render",
        "src/index.ts",
        "StorytellingDemo",
        str(output_path),
    ]
    if props_path is not None:
        command.append(f"--props={props_path}")
    concurrency = os.getenv("GENERATE_VIDEO_REMOTION_CONCURRENCY") or os.getenv("GENERATE_VIDEO_REMOTION_CONCURRENCY")
    if concurrency:
        command.append(f"--concurrency={concurrency}")
    x264_preset = os.getenv("GENERATE_VIDEO_REMOTION_X264_PRESET") or os.getenv("GENERATE_VIDEO_REMOTION_X264_PRESET", "veryfast")
    if x264_preset:
        command.append(f"--x264-preset={x264_preset}")
    crf = os.getenv("GENERATE_VIDEO_REMOTION_CRF") or os.getenv("GENERATE_VIDEO_REMOTION_CRF", "23")
    if crf:
        command.append(f"--crf={crf}")
    completed = subprocess.run(
        command,
        cwd=RENDER_WORKSPACE_ROOT,
        capture_output=True,
        text=True,
        timeout=300,
        env={**os.environ, "NO_COLOR": "1"},
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "Remotion render failed").strip()
        raise RuntimeError(detail[-2000:])
