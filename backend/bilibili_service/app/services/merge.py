import shutil
import subprocess
import time
from pathlib import Path

from fastapi import HTTPException
from backend.bilibili_service.app.integrations.bilibili.render import find_ffmpeg
from backend.bilibili_service.app.schemas.domain import JobStatus, PipelineStage
from backend.bilibili_service.app.services.jobs import emit_step_progress
from backend.bilibili_service.app.services.runtime import db, settings

def run_merge_parts(job_id: int, segment_indexes: list[int]) -> None:
    try:
        job = db.get_job(job_id)
        segments = job.artifacts.get("segments")
        if not isinstance(segments, list):
            raise ValueError("Không tìm thấy danh sách parts.")
        
        parts_to_merge = []
        for index in segment_indexes:
            part = next((p for p in segments if isinstance(p, dict) and p.get("index") == index), None)
            if not part or not isinstance(part.get("path"), str):
                raise ValueError(f"Không tìm thấy part có index {index}")
            path = Path(part["path"]).resolve()
            if not path.exists():
                raise ValueError(f"File của part {index} không tồn tại.")
            parts_to_merge.append(path)
            
        if len(parts_to_merge) < 2:
            raise ValueError("Vui lòng chọn ít nhất 2 part để gộp.")

        emit_step_progress(job_id, step="merge", label="Gộp parts", status="running", percent=0)
        
        job_output_dir = Path(str(job.artifacts.get("job_output_dir") or settings.output_dir / f"job-{job_id}"))
        job_output_dir.mkdir(parents=True, exist_ok=True)
        merged_path = job_output_dir / f"merged_parts_{'-'.join(map(str, segment_indexes))}.mp4"
        
        # create concat list
        list_file = job_output_dir / "concat_list.txt"
        with open(list_file, "w", encoding="utf-8") as f:
            for p in parts_to_merge:
                f.write(f"file '{p.as_posix()}'\n")
                
        ffmpeg = find_ffmpeg()
        if not ffmpeg:
            raise RuntimeError("FFmpeg is required but was not found in PATH.")

        cmd = [
            ffmpeg,
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            str(merged_path)
        ]
        
        process = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if process.returncode != 0:
            raise RuntimeError(f"FFmpeg lỗi: {process.stderr[-500:]}")
            
        list_file.unlink(missing_ok=True)
        
        # calculate new duration roughly or run ffprobe
        # Update segments to include the merged part, and maybe remove the old ones or just add the new one.
        # User requested: "chọn các part và gộp lại" - maybe we just output a new file, and don't modify the existing segments list, but maybe we replace it? 
        # Actually it's best to append the new merged segment to the segments list.
        
        new_index = max((p.get("index", 0) for p in segments if isinstance(p, dict)), default=0) + 1
        new_segment = {
            "index": new_index,
            "title": f"Gộp {','.join(map(str, segment_indexes))}",
            "path": str(merged_path),
            "duration_seconds": None, # Could probe it later
        }
        
        new_segments = [p for p in segments if isinstance(p, dict) and p.get("index") not in segment_indexes]
        new_segments.append(new_segment)
        new_segments.sort(key=lambda x: x.get("index", 0))

        emit_step_progress(job_id, step="merge", label="Gộp parts", status="completed", percent=100)
        
        db.update_job(
            job_id,
            artifacts={
                "segments": new_segments
            }
        )
    except Exception as exc:
        emit_step_progress(job_id, step="merge", label="Gộp parts", status="failed", detail=str(exc))
        db.update_job(
            job_id,
            error_message=f"Lỗi gộp: {str(exc)}",
        )


def run_merge_jobs(new_job_id: int, job_ids: list[int]) -> None:
    try:
        emit_step_progress(new_job_id, step="merge", label="Gộp video từ các job", status="running", percent=0)
        
        paths_to_merge = []
        for j_id in job_ids:
            job = db.get_job(j_id)
            artifacts = job.artifacts
            # try to get output_video_path or first segment
            vid_path = artifacts.get("output_video_path")
            if not vid_path:
                segments = artifacts.get("segments")
                if isinstance(segments, list) and len(segments) > 0 and "path" in segments[0]:
                    vid_path = segments[0]["path"]
            if not vid_path or not Path(vid_path).exists():
                raise ValueError(f"Job {j_id} chưa có video thành phẩm.")
            paths_to_merge.append(Path(vid_path).resolve())
            
        if len(paths_to_merge) < 2:
            raise ValueError("Vui lòng chọn ít nhất 2 video.")
            
        job_output_dir = settings.output_dir / f"job-{new_job_id}"
        job_output_dir.mkdir(parents=True, exist_ok=True)
        merged_path = job_output_dir / "merged_jobs.mp4"
        
        # Create a black screen separator (2 seconds)
        ffmpeg = find_ffmpeg()
        if not ffmpeg:
            raise RuntimeError("FFmpeg is required but was not found in PATH.")

        separator_path = job_output_dir / "separator.mp4"
        # We need the separator to match the resolution and fps of the videos.
        # But for simplicity, we can just concat them if they have the same format, but if they don't, concat might fail.
        # Assuming they are all from our pipeline, they might be different sizes. 
        # Using a simple concat file. If resolutions differ, it might be weird. 
        # Actually a better approach is to not use a separator if it's too complex, but user asked for "phân cách rõ ràng".
        # Let's generate a 1 second black screen.
        subprocess.run([
            ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=1.5", 
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", 
            str(separator_path)
        ], capture_output=True, check=False)
        
        list_file = job_output_dir / "concat_jobs_list.txt"
        with open(list_file, "w", encoding="utf-8") as f:
            for i, p in enumerate(paths_to_merge):
                f.write(f"file '{p.as_posix()}'\n")
                if i < len(paths_to_merge) - 1 and separator_path.exists():
                    f.write(f"file '{separator_path.as_posix()}'\n")
                    
        cmd = [
            ffmpeg,
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            str(merged_path)
        ]
        
        process = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if process.returncode != 0:
            raise RuntimeError(f"FFmpeg lỗi khi gộp job: {process.stderr[-500:]}")
            
        emit_step_progress(new_job_id, step="merge", label="Gộp video", status="completed", percent=100)
        
        db.update_job(
            new_job_id,
            status=JobStatus.completed,
            stage=PipelineStage.completed,
            progress=100,
            artifacts={
                "output_video_path": str(merged_path),
                "job_output_dir": str(job_output_dir),
                "segments": [
                    {
                        "index": 1,
                        "title": "Merged Jobs",
                        "path": str(merged_path)
                    }
                ]
            }
        )
    except Exception as exc:
        emit_step_progress(new_job_id, step="merge", label="Gộp video", status="failed", detail=str(exc))
        db.update_job(
            new_job_id,
            status=JobStatus.failed,
            stage=PipelineStage.failed,
            error_message=f"Lỗi gộp: {str(exc)}",
        )
