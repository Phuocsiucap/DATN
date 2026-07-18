import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from backend.bilibili_service.app.api.deps import CurrentUser, get_current_user
from backend.bilibili_service.app.schemas.api import CreateJobRequest, JobRecord, JobStatus, PipelineStage, SubtitleStyleRequest, VideoFilterRequest
from backend.bilibili_service.app.services.jobs import (
    get_existing_job,
    open_folder,
    require_artifact_path,
    resolve_job_output_folder,
    run_apply_job_filter,
    run_apply_job_subtitles,
    run_retranslate_job,
)
from backend.bilibili_service.app.schemas.api import MergePartsRequest, MergeJobsRequest, CreateJobRequest
from backend.bilibili_service.app.services.merge import run_merge_parts, run_merge_jobs
from backend.bilibili_service.app.services.runtime import db, executor, pipeline


router = APIRouter()


@router.post("", response_model=JobRecord)
def create_job(req: CreateJobRequest, current_user: CurrentUser = Depends(get_current_user)) -> JobRecord:
    job = db.create_job(req, user_id=current_user.id)
    executor.submit(pipeline.run, job.id)
    return job


@router.post("/merge-jobs", response_model=JobRecord)
def merge_jobs(req: MergeJobsRequest, current_user: CurrentUser = Depends(get_current_user)) -> JobRecord:
    create_req = CreateJobRequest(input_text=f"Merged {len(req.job_ids)} jobs")
    job = db.create_job(create_req, user_id=current_user.id)
    db.update_job(job.id, status=JobStatus.running, stage=PipelineStage.rendering, progress=0)
    executor.submit(run_merge_jobs, job.id, req.job_ids)
    return job


@router.get("", response_model=list[JobRecord])
def list_jobs(current_user: CurrentUser = Depends(get_current_user)) -> list[JobRecord]:
    return db.list_jobs(current_user.id)


@router.get("/{job_id}", response_model=JobRecord)
def get_job(job_id: int, current_user: CurrentUser = Depends(get_current_user)) -> JobRecord:
    return get_existing_job(job_id, current_user.id)


@router.post("/{job_id}/retry", response_model=JobRecord)
def retry_job(job_id: int, current_user: CurrentUser = Depends(get_current_user)) -> JobRecord:
    job = get_existing_job(job_id, current_user.id)
    if job.status == JobStatus.running:
        raise HTTPException(status_code=409, detail="Job đang chạy, không cần retry.")
    db.update_job(
        job_id,
        status=JobStatus.running,
        stage=PipelineStage.queued,
        progress=0,
        artifacts={
            "cancel_requested": False,
            "step_progress": {
                "step": "retry",
                "label": "Chạy lại job",
                "status": "running",
                "percent": 0,
                "detail": "Đang đưa job quay lại pipeline",
                "updated_at_ms": int(time.time() * 1000),
            }
        },
    )
    executor.submit(pipeline.run, job_id)
    return db.get_job(job_id)


@router.post("/{job_id}/cancel", response_model=JobRecord)
def cancel_job(job_id: int, current_user: CurrentUser = Depends(get_current_user)) -> JobRecord:
    job = get_existing_job(job_id, current_user.id)
    if job.status != JobStatus.running:
        return job
    now_ms = int(time.time() * 1000)
    return db.update_job(
        job_id,
        status=JobStatus.failed,
        stage=PipelineStage.failed,
        error_message="Đã dừng tiến trình theo yêu cầu.",
        artifacts={
            "cancel_requested": True,
            "step_progress": {
                "step": "cancel",
                "label": "Dừng tiến trình",
                "status": "failed",
                "percent": job.progress,
                "detail": "Đã yêu cầu dừng job. Tác vụ nền hiện tại sẽ thoát ở điểm kiểm tra tiếp theo.",
                "updated_at_ms": now_ms,
            },
        },
    )


@router.post("/{job_id}/retranslate", response_model=JobRecord)
def retranslate_job(job_id: int, current_user: CurrentUser = Depends(get_current_user)) -> JobRecord:
    job = get_existing_job(job_id, current_user.id)
    require_artifact_path(job, "zh_srt_path")
    db.update_job(job_id, status=JobStatus.running, stage=PipelineStage.translating, progress=75)
    executor.submit(run_retranslate_job, job_id)
    return db.get_job(job_id)


@router.post("/{job_id}/apply-subtitles", response_model=JobRecord)
def apply_job_subtitles(job_id: int, style: SubtitleStyleRequest | None = None, current_user: CurrentUser = Depends(get_current_user)) -> JobRecord:
    job = get_existing_job(job_id, current_user.id)
    require_artifact_path(job, "raw_video_path")
    require_artifact_path(job, "vi_srt_path")
    db.update_job(job_id, status=JobStatus.running, stage=PipelineStage.rendering, progress=90)
    executor.submit(run_apply_job_subtitles, job_id, style.model_dump() if style else None)
    return db.get_job(job_id)


@router.post("/{job_id}/apply-filter", response_model=JobRecord)
def apply_job_filter(job_id: int, style: VideoFilterRequest | None = None, current_user: CurrentUser = Depends(get_current_user)) -> JobRecord:
    job = get_existing_job(job_id, current_user.id)
    if not job.artifacts.get("segments") and not job.artifacts.get("output_video_path"):
        raise HTTPException(status_code=404, detail="No rendered video output found")
    db.update_job(job_id, status=JobStatus.running, stage=PipelineStage.rendering, progress=92)
    executor.submit(run_apply_job_filter, job_id, style.model_dump() if style else None)
    return db.get_job(job_id)


@router.post("/{job_id}/merge-parts", response_model=JobRecord)
def merge_job_parts(job_id: int, req: MergePartsRequest, current_user: CurrentUser = Depends(get_current_user)) -> JobRecord:
    job = get_existing_job(job_id, current_user.id)
    if not job.artifacts.get("segments"):
        raise HTTPException(status_code=404, detail="No segments found to merge")
    db.update_job(
        job_id,
        artifacts={
            "step_progress": {
                "step": "merge",
                "label": "Gộp parts",
                "status": "running",
                "percent": 0,
                "detail": "Đang gộp các part đã chọn, không chạy lại dịch/render.",
                "updated_at_ms": int(time.time() * 1000),
            }
        },
    )
    executor.submit(run_merge_parts, job_id, req.segment_indexes)
    return db.get_job(job_id)


@router.get("/{job_id}/media/{artifact_key}")
def get_job_media(job_id: int, artifact_key: str, current_user: CurrentUser = Depends(get_current_user)) -> FileResponse:
    allowed_keys = {"raw_video_path", "output_video_path"}
    if artifact_key not in allowed_keys:
        raise HTTPException(status_code=400, detail="Unsupported media artifact")
    job = get_existing_job(job_id, current_user.id)

    path_value = job.artifacts.get(artifact_key)
    if not isinstance(path_value, str):
        raise HTTPException(status_code=404, detail="Media artifact not found")
    path = Path(path_value).resolve()
    if not path.exists() or not path.is_file() or path.stat().st_size <= 0:
        raise HTTPException(status_code=404, detail="Media file not found on disk")
    return FileResponse(path)


@router.get("/{job_id}/segments/{segment_index}")
def get_job_segment(job_id: int, segment_index: int, current_user: CurrentUser = Depends(get_current_user)) -> FileResponse:
    job = get_existing_job(job_id, current_user.id)
    segments = job.artifacts.get("segments")
    if not isinstance(segments, list):
        raise HTTPException(status_code=404, detail="Segments not found")
    match = next((item for item in segments if isinstance(item, dict) and item.get("index") == segment_index), None)
    if not match or not isinstance(match.get("path"), str):
        raise HTTPException(status_code=404, detail="Segment not found")
    path = Path(match["path"]).resolve()
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Segment file not found on disk")
    return FileResponse(path)


@router.post("/{job_id}/open-folder")
def open_job_output_folder(job_id: int, current_user: CurrentUser = Depends(get_current_user)) -> dict[str, str | bool]:
    job = get_existing_job(job_id, current_user.id)
    target = resolve_job_output_folder(job)
    if not target:
        raise HTTPException(status_code=404, detail="Không tìm thấy thư mục thành phẩm cho job này.")
    open_folder(target)
    return {"ok": True, "path": str(target)}


@router.delete("/{job_id}", response_model=JobRecord)
def delete_job(job_id: int, current_user: CurrentUser = Depends(get_current_user)) -> JobRecord:
    _ = get_existing_job(job_id, current_user.id)
    job = db.delete_job(job_id)

    for key in ("raw_video_path", "zh_srt_path", "vi_srt_path", "output_video_path"):
        path_value = job.artifacts.get(key)
        if isinstance(path_value, str):
            path = Path(path_value)
            if path.exists() and path.is_file():
                path.unlink()
    segments = job.artifacts.get("segments")
    if isinstance(segments, list):
        for item in segments:
            if isinstance(item, dict) and isinstance(item.get("path"), str):
                path = Path(item["path"])
                if path.exists() and path.is_file():
                    path.unlink()
    job_output_dir = job.artifacts.get("job_output_dir")
    if isinstance(job_output_dir, str):
        path = Path(job_output_dir)
        if path.exists() and path.is_dir():
            shutil.rmtree(path)
    return job
