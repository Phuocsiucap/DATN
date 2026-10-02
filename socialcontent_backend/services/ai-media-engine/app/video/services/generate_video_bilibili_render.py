from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.video.services.generate_video_constants import VIDEO_OUT_DIR


def process_bilibili_hardsub_render(task_id: uuid.UUID | str) -> None:
    from common.db.models import MediaWorkflow, KafkaTask
    from common.db.session import SessionLocal

    db = SessionLocal()
    task = None
    project = None
    try:
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if task and task.task_type == "BILIBILI_RENDER_TASK":
            project = db.get(MediaWorkflow, task.reference_id) if task.reference_id else None
        else:
            project = db.get(MediaWorkflow, uuid.UUID(str(task_id)))
            task = (
                db.query(KafkaTask)
                .filter(KafkaTask.reference_id == project.id, KafkaTask.task_type == "BILIBILI_RENDER_TASK", KafkaTask.status == "PENDING")
                .order_by(KafkaTask.created_at.desc())
                .first()
            ) if project else None
        if not project:
            return
        if not task:
            raise RuntimeError("Bilibili render task not found")
        if task.status not in {"PENDING", "FAILED"}:
            return

        task.status = "RUNNING"
        task.started_at = datetime.now(timezone.utc)
        task.completed_at = None
        task.error_message = None
        task.current_stage = "DOWNLOADING_SOURCE"
        task.progress_percent = 10
        project.status = "RENDERING"
        project.current_stage = "DOWNLOADING_SOURCE"
        project.progress_percent = 10
        db.add_all([task, project])
        db.commit()
        
        # Extract necessary data
        draft = project.draft_json or {}
        story_data = draft.get("story_data") or []
        metadata = project.metadata_json or {}
        
        video_url = None
        if story_data and story_data[0].get("image"):
            video_url = story_data[0].get("image")
            
        if not video_url:
            raise RuntimeError("Missing source video URL in draft story_data")
            
        job_dir = VIDEO_OUT_DIR / "bilibili" / str(project.id)
        job_dir.mkdir(parents=True, exist_ok=True)
        
        # 1. Download video using yt-dlp
        project.current_stage = "DOWNLOADING_SOURCE"
        project.progress_percent = 20
        task.current_stage = "DOWNLOADING_SOURCE"
        task.progress_percent = 20
        db.add_all([task, project])
        db.commit()
        
        video_path = _download_video(video_url, job_dir)
        
        # 2. Generate SRT from story_data
        project.current_stage = "PREPARING_SUBTITLES"
        project.progress_percent = 50
        task.current_stage = "PREPARING_SUBTITLES"
        task.progress_percent = 50
        db.add_all([task, project])
        db.commit()
        
        srt_path = job_dir / "subtitles.srt"
        _generate_srt_file(story_data, srt_path)
        
        # 3. Check for generated voice dubbing
        voice_clips = []
        if draft.get("story_data"):
            from app.video.services.generate_video_constants import MEDIA_DIR
            for scene in draft["story_data"]:
                if "audio" in scene and "src" in scene["audio"]:
                    audio_rel = scene["audio"]["src"]
                    start = float(scene["audio"].get("start") or 0.0)
                    path = MEDIA_DIR / audio_rel.replace("assets/audio/", "assets/audio/")
                    if not path.exists():
                        path = MEDIA_DIR / audio_rel
                    if path.exists():
                        voice_clips.append((path, start))

        # 4. Render Hardsub with FFmpeg
        project.current_stage = "RENDERING_VIDEO"
        project.progress_percent = 60
        task.current_stage = "RENDERING_VIDEO"
        task.progress_percent = 60
        db.add_all([task, project])
        db.commit()
        
        output_path = job_dir / f"final_{project.id}.mp4"
        _render_hardsub_ffmpeg(video_path, srt_path, output_path, voice_clips)
        
        # 5. Finish
        output_uri = f"bilibili/{project.id}/{output_path.name}"
        artifacts = project.artifacts_jsonb if isinstance(project.artifacts_jsonb, list) else []
        artifacts.append({
            "artifact_type": "FINAL_VIDEO",
            "uri": output_uri,
            "status": "READY",
            "metadata": {"task_id": str(task.id), "renderer": "ffmpeg-bilibili-hardsub"},
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        project.artifacts_jsonb = artifacts
        project.status = "RENDERED"
        project.current_stage = "RENDERED"
        project.progress_percent = 100
        task.status = "COMPLETED"
        task.current_stage = "RENDERED"
        task.progress_percent = 100
        task.result_jsonb = {"output_path": output_uri, "workflow_id": str(project.id)}
        task.completed_at = datetime.now(timezone.utc)
        db.add_all([task, project])
        db.commit()
        
    except Exception as error:
        db.rollback()
        if not task:
            task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        project = db.get(MediaWorkflow, task.reference_id) if task and task.reference_id else project
        if task:
            task.status = "FAILED"
            task.current_stage = task.current_stage or "FAILED"
            task.error_message = str(error)[-2000:]
            task.completed_at = datetime.now(timezone.utc)
            db.add(task)
        if project:
            project.status = "FAILED"
            db.add(project)
        db.commit()
        raise
    finally:
        db.close()

def _download_video(url: str, output_dir: Path) -> Path:
    outtmpl = str(output_dir / "source.%(ext)s")
    cmd = [
        "yt-dlp",
        "-f", "bv*[height<=1080]+ba/b[height<=1080]/best[height<=1080]/best",
        "--merge-output-format", "mp4",
        "-o", outtmpl,
        url
    ]
    
    cookiefile = os.getenv("ACD_YTDLP_COOKIES")
    if cookiefile and Path(cookiefile).exists():
        cmd.extend(["--cookies", cookiefile])
        
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {process.stderr[-1000:]}")
        
    # Find downloaded file
    candidates = list(output_dir.glob("source.*"))
    if not candidates:
        raise FileNotFoundError("yt-dlp did not produce an output file")
        
    return candidates[0]

def _generate_srt_file(story_data: list[dict[str, Any]], output_path: Path) -> None:
    def format_time(seconds: float) -> str:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        msecs = int((seconds * 1000) % 1000)
        return f"{hours:02}:{minutes:02}:{secs:02},{msecs:03}"

    with output_path.open("w", encoding="utf-8") as f:
        for scene in story_data:
            idx = scene.get("scene_index", 1)
            start = float(scene.get("subtitle_start") or 0.0)
            duration = float(scene.get("subtitle_duration") or 2.0)
            end = start + duration
            text = scene.get("subtitle") or ""
            
            if text:
                f.write(f"{idx}\n")
                f.write(f"{format_time(start)} --> {format_time(end)}\n")
                f.write(f"{text}\n\n")

def _render_hardsub_ffmpeg(video_path: Path, srt_path: Path, output_path: Path, voice_clips: list[tuple[Path, float]] = None) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        try:
            import imageio_ffmpeg
            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            pass
    if not ffmpeg:
        raise RuntimeError("FFmpeg not found in PATH and imageio-ffmpeg is not installed")
    
    # Escape path for FFmpeg filter
    escaped_srt = str(srt_path.resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    style = "FontName=Arial,FontSize=16,Outline=3,MarginV=58,Alignment=2"
    
    if voice_clips:
        cmd = [ffmpeg, "-y", "-i", str(video_path)]
        for clip_path, _ in voice_clips:
            cmd.extend(["-i", str(clip_path)])
            
        filter_str = f"[0:v]subtitles='{escaped_srt}':force_style='{style}'[vout];"
        
        delayed_audios = []
        for i, (_, start_sec) in enumerate(voice_clips):
            delay_ms = int(start_sec * 1000)
            filter_str += f"[{i+1}:a]adelay={delay_ms}|{delay_ms}[a{i+1}];"
            delayed_audios.append(f"[a{i+1}]")
            
        filter_str += "".join(delayed_audios) + f"amix=inputs={len(voice_clips)}[dubraw];"
        # amix reduces volume by 1/N. We must compensate it.
        filter_str += f"[dubraw]volume={len(voice_clips)}[dub];"
        
        filter_str += f"[0:a]volume=0.15[orig];[dub]volume=1.5[dubvol];[orig][dubvol]amix=inputs=2:duration=first[aout]"
        
        cmd.extend([
            "-filter_complex", filter_str,
            "-map", "[vout]",
            "-map", "[aout]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            str(output_path)
        ])
    else:
        subtitles_filter = f"subtitles='{escaped_srt}':force_style='{style}'"
        cmd = [
            ffmpeg,
            "-y",
            "-i", str(video_path),
            "-vf", subtitles_filter,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            str(output_path)
        ]
    
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {process.stderr[-2000:]}")
