from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any

from common.core.config import get_settings
from app.video.services.generate_video_constants import RENDER_WORKSPACE_ROOT, VIDEO_OUT_DIR
from app.video.services.generate_video_timeline import normalize_story_for_project, replace_default_images_with_source_images, sync_story_timeline


logger = logging.getLogger(__name__)


def generate_visual_video(story: dict[str, Any]) -> dict[str, Any]:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    owner_id = str(meta.get("workflow_id") or uuid.uuid4()).strip()
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
    run_remotion_render(output_path, props={"story": visual_story})

    story.setdefault("video_artifacts", {})
    story["video_artifacts"]["visual_only"] = f"out/{output_name}"
    return {
        "story": story,
        "video_url": f"/api/v1/generate-video/output/{output_name}",
        "video_path": str(output_path),
    }



def export_final_video(story: dict[str, Any], render_job_id: str | None = None) -> dict[str, Any]:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    owner_id = str(meta.get("workflow_id") or uuid.uuid4()).strip()
    render_key = (render_job_id or uuid.uuid4().hex).replace("-", "")[:12]
    output_name = f"final-{owner_id}-{render_key}.mp4"
    output_path = VIDEO_OUT_DIR / output_name
    VIDEO_OUT_DIR.mkdir(parents=True, exist_ok=True)

    story = normalize_story_for_project(story)
    run_remotion_render(output_path, props={"story": story})

    story.setdefault("video_artifacts", {})
    story["video_artifacts"]["final"] = f"out/{output_name}"
    return {
        "story": story,
        "video_url": f"/api/v1/generate-video/output/{output_name}",
        "artifact_path": f"out/{output_name}",
        "video_path": str(output_path),
    }



def run_remotion_render(output_path: Path, props: dict[str, Any] | None = None) -> None:
    node = resolve_node_binary()
    npm = resolve_npm_binary()
    if not node:
        candidates = ", ".join(resolve_node_candidates())
        raise RuntimeError(
            "Node.js is required to render visual video. Set GENERATE_VIDEO_NODE_PATH or install Node.js."
            + (f" Checked: {candidates}" if candidates else "")
        )
    if not npm:
        candidates = ", ".join(resolve_npm_candidates())
        raise RuntimeError(
            "npm is required to install Remotion dependencies. Set GENERATE_VIDEO_NPM_PATH or install Node.js/npm."
            + (f" Checked: {candidates}" if candidates else "")
        )
    ensure_remotion_workspace()
    ensure_remotion_dependencies(npm)
    command = [
        node,
        "scripts/render-story.mjs",
        str(output_path),
    ]
    env = build_render_env(node, npm)
    logger.info("Rendering visual video with node=%s cwd=%s output=%s", node, RENDER_WORKSPACE_ROOT, output_path)
    completed = subprocess.run(
        command,
        cwd=RENDER_WORKSPACE_ROOT,
        input=json.dumps({"props": props or {}}, ensure_ascii=False, separators=(",", ":")),
        capture_output=True,
        text=True,
        timeout=int(os.getenv("GENERATE_VIDEO_REMOTION_TIMEOUT_SECONDS") or "600"),
        env=env,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "Remotion render failed").strip()
        raise RuntimeError(detail[-2000:])


def resolve_npm_binary() -> str | None:
    for candidate in resolve_npm_candidates():
        resolved = resolve_existing_binary(candidate)
        if resolved:
            return resolved
    return None


def resolve_node_binary() -> str | None:
    for candidate in resolve_node_candidates():
        resolved = resolve_existing_binary(candidate)
        if resolved:
            return resolved
    return None


def resolve_node_candidates() -> list[str]:
    settings_node_path = ""
    try:
        settings_node_path = get_settings().generate_video_node_path
    except Exception:
        settings_node_path = ""
    env_candidates = [
        settings_node_path,
        os.getenv("GENERATE_VIDEO_NODE_PATH"),
        os.getenv("NODE_BINARY"),
        os.getenv("NODE_PATH"),
    ]
    local_appdata = os.getenv("LOCALAPPDATA") or ""
    program_files = os.getenv("ProgramFiles") or r"C:\Program Files"
    program_files_x86 = os.getenv("ProgramFiles(x86)") or r"C:\Program Files (x86)"
    path_candidates = [
        shutil.which("node.exe"),
        shutil.which("node"),
        str(Path(program_files) / "nodejs" / "node.exe"),
        str(Path(program_files_x86) / "nodejs" / "node.exe"),
        str(Path(local_appdata) / "Programs" / "nodejs" / "node.exe"),
        r"E:\Environment code\nodejs\node.exe",
        r"E:\Environment code\nodejs\node",
    ]
    path_env = os.getenv("PATH") or os.getenv("Path") or ""
    path_exts = [".exe", ".cmd", ".bat", ""] if os.name == "nt" else [""]
    for folder in path_env.split(os.pathsep):
        if not folder:
            continue
        for ext in path_exts:
            path_candidates.append(str(Path(folder) / f"node{ext}"))
    return list(dict.fromkeys(clean_binary_candidate(candidate) for candidate in [*env_candidates, *path_candidates] if candidate))


def resolve_npm_candidates() -> list[str]:
    settings_npm_path = ""
    try:
        settings_npm_path = get_settings().generate_video_npm_path
    except Exception:
        settings_npm_path = ""
    env_candidates = [
        settings_npm_path,
        os.getenv("GENERATE_VIDEO_NPM_PATH"),
        os.getenv("NPM_BINARY"),
        os.getenv("NPM_PATH"),
    ]
    local_appdata = os.getenv("LOCALAPPDATA") or ""
    program_files = os.getenv("ProgramFiles") or r"C:\Program Files"
    program_files_x86 = os.getenv("ProgramFiles(x86)") or r"C:\Program Files (x86)"
    path_candidates = [
        shutil.which("npm.cmd"),
        shutil.which("npm"),
        str(Path(program_files) / "nodejs" / "npm.cmd"),
        str(Path(program_files_x86) / "nodejs" / "npm.cmd"),
        str(Path(local_appdata) / "Programs" / "nodejs" / "npm.cmd"),
        r"E:\Environment code\nodejs\npm.cmd",
        r"E:\Environment code\nodejs\npm",
    ]
    path_env = os.getenv("PATH") or os.getenv("Path") or ""
    path_exts = [".cmd", ".exe", ".bat", ""] if os.name == "nt" else [""]
    for folder in path_env.split(os.pathsep):
        if not folder:
            continue
        for ext in path_exts:
            path_candidates.append(str(Path(folder) / f"npm{ext}"))
    return list(dict.fromkeys(clean_binary_candidate(candidate) for candidate in [*env_candidates, *path_candidates] if candidate))


def clean_binary_candidate(candidate: str) -> str:
    return str(candidate or "").strip().strip("\"'")


def resolve_existing_binary(candidate: str) -> str | None:
    candidate = clean_binary_candidate(candidate)
    if not candidate:
        return None
    candidate_path = Path(candidate)
    if candidate_path.exists():
        return str(candidate_path)
    resolved = shutil.which(candidate)
    if resolved:
        return resolved
    return None


def ensure_remotion_workspace() -> None:
    missing = [
        path
        for path in [
            RENDER_WORKSPACE_ROOT / "package.json",
            RENDER_WORKSPACE_ROOT / "src" / "index.ts",
            RENDER_WORKSPACE_ROOT / "scripts" / "render-story.mjs",
        ]
        if not path.exists()
    ]
    if missing:
        names = ", ".join(str(path) for path in missing)
        raise RuntimeError(f"Remotion render workspace is missing required files: {names}")


def ensure_remotion_dependencies(npm: str) -> None:
    renderer_package = RENDER_WORKSPACE_ROOT / "node_modules" / "@remotion" / "renderer"
    bundler_package = RENDER_WORKSPACE_ROOT / "node_modules" / "@remotion" / "bundler"
    if renderer_package.exists() and bundler_package.exists():
        return
    logger.info("Installing Remotion dependencies in %s", RENDER_WORKSPACE_ROOT)
    completed = subprocess.run(
        [npm, "install", "--no-audit", "--no-fund"],
        cwd=RENDER_WORKSPACE_ROOT,
        capture_output=True,
        text=True,
        timeout=int(os.getenv("GENERATE_VIDEO_NPM_INSTALL_TIMEOUT_SECONDS") or "300"),
        env=build_render_env(npm),
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "npm install failed").strip()
        raise RuntimeError(detail[-2000:])


def build_render_env(*binaries: str) -> dict[str, str]:
    env = {**os.environ, "NO_COLOR": "1", "CI": "1"}
    current_path = env.get("PATH") or env.get("Path") or ""
    extra_dirs = []
    for binary in binaries:
        binary_dir = str(Path(binary).parent) if binary else ""
        if binary_dir and binary_dir.lower() not in current_path.lower() and binary_dir not in extra_dirs:
            extra_dirs.append(binary_dir)
    if extra_dirs:
        env["PATH"] = os.pathsep.join([*extra_dirs, current_path]) if current_path else os.pathsep.join(extra_dirs)
    return env
