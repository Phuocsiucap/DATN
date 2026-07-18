from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

from fastapi import HTTPException, status

from backend.bilibili_service.app.services.pipeline import humanize_pipeline_error
from backend.bilibili_service.app.services.runtime import db, settings, subtitle_translator, video_renderer
from backend.bilibili_service.app.schemas.api import JobRecord, JobStatus, PipelineStage
from backend.bilibili_service.app.integrations.bilibili.progress import ThrottledProgress


def get_existing_job(job_id: int, user_id: int | None = None) -> JobRecord:
    try:
        job = db.get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if user_id is not None and job.user_id is not None and job.user_id != user_id:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def resolve_job_output_folder(job: JobRecord) -> Path | None:
    candidates: list[str] = []
    for key in ("output_video_path", "master_video_path", "job_output_dir"):
        value = job.artifacts.get(key)
        if isinstance(value, str) and value:
            candidates.append(value)
    segments = job.artifacts.get("segments")
    if isinstance(segments, list):
        for item in segments:
            if isinstance(item, dict) and isinstance(item.get("path"), str):
                candidates.append(item["path"])
                break

    for value in candidates:
        path = Path(value).resolve()
        if path.is_file():
            return path.parent
        if path.is_dir():
            return path
    return None


def resolve_publish_video_path(job: JobRecord) -> Path:
    candidates: list[str] = []
    for key in ("output_video_path", "master_video_path"):
        value = job.artifacts.get(key)
        if isinstance(value, str) and value:
            candidates.append(value)
    segments = job.artifacts.get("segments")
    if isinstance(segments, list):
        for item in segments:
            if isinstance(item, dict) and isinstance(item.get("path"), str):
                candidates.append(item["path"])
                break
    for value in candidates:
        path = Path(value).resolve()
        if path.exists() and path.is_file():
            return path
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chưa có video thành phẩm để đăng")


def build_default_tiktok_caption(job: JobRecord) -> str:
    metadata = job.artifacts.get("tiktok_metadata")
    if isinstance(metadata, dict):
        title = str(metadata.get("title") or "").strip()
        description = str(metadata.get("description") or "").strip()
        hashtags = metadata.get("hashtags")
        hashtag_text = " ".join(str(item).strip() for item in hashtags if str(item).strip()) if isinstance(hashtags, list) else ""
        return "\n\n".join(part for part in [title, description, hashtag_text] if part)
    title = str(job.artifacts.get("crawler_title") or job.artifacts.get("raw_title") or job.input_text).strip()
    return f"{title}\n\n#phimngan #shortdrama #vietsub"


def open_folder(path: Path) -> None:
    if sys.platform.startswith("win"):
        subprocess.Popen(["explorer", str(path)])
        return
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
        return
    opener = shutil.which("xdg-open")
    if not opener:
        raise HTTPException(status_code=500, detail="Máy chưa có xdg-open để mở folder.")
    subprocess.Popen([opener, str(path)])


def require_artifact_path(job: JobRecord, artifact_key: str) -> Path:
    path_value = job.artifacts.get(artifact_key)
    if not isinstance(path_value, str):
        raise HTTPException(status_code=404, detail=f"{artifact_key} artifact not found")
    path = Path(path_value)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"{artifact_key} file not found on disk")
    return path


def run_retranslate_job(job_id: int) -> None:
    try:
        job = db.get_job(job_id)
        zh_srt = require_artifact_path(job, "zh_srt_path")
        subtitle_dir = settings.output_dir / f"job-{job_id}" / "subtitles"
        subtitle_dir.mkdir(parents=True, exist_ok=True)
        vi_srt = subtitle_dir / "vi.srt"
        emit_step_progress(job_id, step="translate", label="Dịch lại phụ đề", status="running", percent=0)
        translate_progress = ThrottledProgress(lambda payload: db.update_job(job_id, artifacts={"step_progress": payload}))
        subtitle_translator.translate_zh_to_vi(
            zh_srt,
            vi_srt,
            progress_callback=lambda payload: translate_progress.emit(
                step="translate",
                label="Dịch lại phụ đề",
                status="running",
                current=payload.get("current"),
                total=payload.get("total"),
                detail=payload.get("detail"),
                unit="dòng",
            ),
        )
        emit_step_progress(job_id, step="translate", label="Dịch lại phụ đề", status="completed", percent=100)
        db.update_job(
            job_id,
            status=JobStatus.completed,
            stage=PipelineStage.completed,
            progress=85,
            artifacts={
                "vi_srt_path": str(vi_srt),
                "translation_context_path": str(vi_srt.with_suffix(".context.json")),
                "subtitle_retranslated": True,
            },
        )
    except Exception as exc:
        message = humanize_pipeline_error(exc)
        emit_step_progress(job_id, step="translate", label="Dịch lại phụ đề", status="failed", detail=message)
        db.update_job(job_id, status=JobStatus.failed, stage=PipelineStage.failed, error_message=message)


def run_apply_job_subtitles(job_id: int, subtitle_style: dict | None = None) -> None:
    try:
        job = db.get_job(job_id)
        raw_path = require_artifact_path(job, "raw_video_path")
        vi_srt = require_artifact_path(job, "vi_srt_path")
        title = job.artifacts.get("raw_title") or job.artifacts.get("crawler_title") or job.input_text
        emit_step_progress(job_id, step="render", label="Áp phụ đề", status="running", percent=0, detail="Đang render video mới")
        render_artifacts = video_renderer.render_job_outputs(
            raw_path,
            vi_srt,
            settings.output_dir / f"job-{job_id}",
            title=str(title),
            subtitle_style=subtitle_style or job.artifacts.get("subtitle_style"),
        )
        db.update_job(
            job_id,
            status=JobStatus.completed,
            stage=PipelineStage.completed,
            progress=100,
            artifacts={
                **render_artifacts,
                "subtitles_applied": True,
            },
        )
        emit_step_progress(job_id, step="render", label="Áp phụ đề", status="completed", percent=100)
    except Exception as exc:
        message = humanize_pipeline_error(exc)
        emit_step_progress(job_id, step="render", label="Áp phụ đề", status="failed", detail=message)
        db.update_job(job_id, status=JobStatus.failed, stage=PipelineStage.failed, error_message=message)


def run_apply_job_filter(job_id: int, filter_style: dict | None = None) -> None:
    try:
        job = db.get_job(job_id)
        style = normalize_filter_style(filter_style)
        job_output_dir = Path(str(job.artifacts.get("job_output_dir") or settings.output_dir / f"job-{job_id}"))
        filtered_dir = job_output_dir / "filtered"
        if filtered_dir.exists():
            shutil.rmtree(filtered_dir)
        filtered_dir.mkdir(parents=True, exist_ok=True)

        source_segments = get_rendered_segments(job)
        if not source_segments:
            raise RuntimeError("No rendered segments found for filter stage.")

        emit_step_progress(
            job_id,
            step="filter",
            label="Áp filter xuất bản",
            status="running",
            current=0,
            total=len(source_segments),
            detail=f"Preset {style['preset']} · speed {style['speed']}x",
            unit="part",
        )
        filtered_segments = []
        for index, segment in enumerate(source_segments, start=1):
            input_path = Path(str(segment["path"]))
            if not input_path.exists():
                raise RuntimeError(f"Segment file not found: {input_path}")
            output_path = filtered_dir / f"part-{index - 1:03d}.filtered.mp4"
            video_renderer.apply_publish_filter(
                input_path,
                output_path,
                preset=str(style["preset"]),
                speed=float(style["speed"]),
            )
            filtered_segments.append({
                **segment,
                "index": index,
                "title": str(segment.get("title") or f"Part {index}"),
                "path": str(output_path),
                "duration_seconds": int(video_renderer.probe_duration(output_path) or 0) or segment.get("duration_seconds"),
            })
            emit_step_progress(
                job_id,
                step="filter",
                label="Áp filter xuất bản",
                status="running",
                current=index,
                total=len(source_segments),
                detail=f"Đã xử lý {index}/{len(source_segments)} part",
                unit="part",
            )

        emit_step_progress(job_id, step="filter", label="Áp filter xuất bản", status="completed", percent=100)
        db.update_job(
            job_id,
            status=JobStatus.completed,
            stage=PipelineStage.completed,
            progress=100,
            artifacts={
                "segments": filtered_segments,
                "output_video_path": str(filtered_segments[0]["path"]),
                "master_video_path": str(filtered_segments[0]["path"]) if len(filtered_segments) == 1 else None,
                "publish_filter": style,
                "filtered_output_dir": str(filtered_dir),
            },
        )
    except Exception as exc:
        message = humanize_pipeline_error(exc)
        emit_step_progress(job_id, step="filter", label="Áp filter xuất bản", status="failed", detail=message)
        db.update_job(job_id, status=JobStatus.failed, stage=PipelineStage.failed, error_message=message)


def get_rendered_segments(job: JobRecord) -> list[dict]:
    segments = job.artifacts.get("segments")
    if isinstance(segments, list):
        valid = [item for item in segments if isinstance(item, dict) and isinstance(item.get("path"), str)]
        if valid:
            return valid
    output_path = job.artifacts.get("output_video_path")
    if isinstance(output_path, str):
        return [{
            "index": 1,
            "title": "Part 1",
            "path": output_path,
            "duration_seconds": None,
        }]
    return []


def normalize_filter_style(style: dict | None) -> dict:
    style = dict(style or {})
    preset = str(style.get("preset") or "studio_bright")
    if preset not in {"studio_bright", "cinematic_dark", "warm_pop", "cool_clean", "natural"}:
        preset = "studio_bright"
    try:
        speed = float(style.get("speed") or 1.05)
    except (TypeError, ValueError):
        speed = 1.05
    speed = max(0.9, min(1.15, speed))
    return {"preset": preset, "speed": round(speed, 3)}


def emit_step_progress(
    job_id: int,
    *,
    step: str,
    label: str,
    status: str,
    percent: float | None = None,
    current: int | None = None,
    total: int | None = None,
    detail: str | None = None,
    unit: str | None = None,
) -> None:
    payload = {
        "step": step,
        "label": label,
        "status": status,
        "updated_at_ms": int(time.time() * 1000),
    }
    if percent is None and current is not None and total:
        percent = min(100.0, max(0.0, (current / total) * 100))
    if percent is not None:
        payload["percent"] = round(percent, 1)
    if current is not None:
        payload["current"] = current
    if total is not None:
        payload["total"] = total
    if detail:
        payload["detail"] = detail
    if unit:
        payload["unit"] = unit
    db.update_job(job_id, artifacts={"step_progress": payload})






