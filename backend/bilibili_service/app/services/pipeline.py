from __future__ import annotations

import time
from pathlib import Path

from backend.bilibili_service.app.core.config import Settings
from backend.bilibili_service.app.repositories.jobs import Database
from backend.bilibili_service.app.schemas.api import JobStatus, PipelineStage
from backend.bilibili_service.app.integrations.bilibili.downloader import VideoDownloader
from backend.bilibili_service.app.integrations.bilibili.keywords import KeywordProvider
from backend.bilibili_service.app.integrations.bilibili.render import VideoRenderer
from backend.bilibili_service.app.integrations.bilibili.stt import SpeechToText
from backend.bilibili_service.app.integrations.bilibili.subtitles import SubtitleTranslator
from backend.bilibili_service.app.integrations.bilibili.ocr_subtitles import HardSubtitleExtractor
from backend.bilibili_service.app.integrations.bilibili.progress import ThrottledProgress


class PipelineCancelled(RuntimeError):
    pass


class DemoPipeline:
    def __init__(self, db: Database, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.keywords = KeywordProvider()
        self.downloader = VideoDownloader(settings.cache_dir)
        self.stt = SpeechToText(settings.whisper_model, settings.whisper_compute_type)
        self.ocr = HardSubtitleExtractor()
        self.translator = SubtitleTranslator()
        self.renderer = VideoRenderer()
        self._last_download_progress_at = 0.0

    def run(self, job_id: int) -> None:
        job = self.db.get_job(job_id)
        active_step = ("job", "Xử lý job")
        try:
            self._ensure_not_cancelled(job_id)
            self.db.update_job(job_id, status=JobStatus.running, stage=PipelineStage.keyword, progress=10)
            active_step = ("keyword", "Phân tích keyword")
            self._emit_step_progress(job_id, step="keyword", label="Phân tích keyword", status="running", percent=0, force=True)
            self._ensure_not_cancelled(job_id)
            if job.source_url:
                keyword_plan = None
                direct_plan = {
                    "source_text_vi": job.input_text,
                    "keyword_zh": "",
                    "queries": [job.source_url],
                    "platform_priority": [str(job.artifacts.get("source_platform") or "bilibili")],
                    "provider": "direct-link",
                    "inferred_niche": str(job.niche),
                    "confidence": 1.0,
                    "reasoning": "Job tạo từ video cụ thể, bỏ qua bước search keyword.",
                }
                self.db.update_job(job_id, artifacts={"keyword_plan": direct_plan}, progress=20)
            else:
                keyword_plan = self.keywords.build_plan(job.input_text, job.niche)
                self.db.update_job(job_id, artifacts={"keyword_plan": keyword_plan.to_dict()}, progress=20)
            self._ensure_not_cancelled(job_id)
            self._emit_step_progress(job_id, step="keyword", label="Phân tích keyword", status="completed", percent=100, force=True)

            self.db.update_job(job_id, stage=PipelineStage.downloading, progress=30)
            active_step = ("download", "Tải video")
            self._emit_step_progress(job_id, step="download", label="Tải video", status="running", percent=0, force=True)
            self._ensure_not_cancelled(job_id)
            progress_hook = self._download_progress_hook(job_id)
            if job.source_url:
                downloaded = self.downloader.download_url(
                    job.source_url,
                    job_id,
                    max_duration_seconds=job.max_duration_seconds,
                    progress_callback=progress_hook,
                )
                if "raw_title" not in downloaded and job.artifacts.get("source_title"):
                    downloaded["raw_title"] = str(job.artifacts["source_title"])
            else:
                if keyword_plan is None:
                    raise RuntimeError("Missing keyword plan for search-based job.")
                downloaded = self._search_and_download_variants(job_id, keyword_plan, job.max_duration_seconds, progress_hook)
            self._ensure_not_cancelled(job_id)
            self.db.update_job(job_id, artifacts=downloaded, progress=45)
            self._emit_step_progress(job_id, step="download", label="Tải video", status="completed", percent=100, force=True)

            raw_path = Path(downloaded["raw_video_path"])
            job_output_dir = self.settings.output_dir / f"job-{job_id}"
            subtitle_dir = job_output_dir / "subtitles"
            subtitle_dir.mkdir(parents=True, exist_ok=True)
            zh_srt = subtitle_dir / "zh.srt"
            vi_srt = subtitle_dir / "vi.srt"

            self.db.update_job(job_id, stage=PipelineStage.transcribing, progress=55)
            active_step = ("ocr", "OCR phụ đề Trung")
            self._ensure_not_cancelled(job_id)
            subtitle_source = self.extract_chinese_subtitles(raw_path, zh_srt, job_id=job_id)
            self._ensure_not_cancelled(job_id)
            self.db.update_job(job_id, artifacts={"zh_srt_path": str(zh_srt), "subtitle_source": subtitle_source}, progress=70)

            self.db.update_job(job_id, stage=PipelineStage.translating, progress=75)
            active_step = ("translate", "Dịch phụ đề")
            translate_progress = ThrottledProgress(
                lambda payload: self.db.update_job(job_id, artifacts={"step_progress": payload})
            )
            self._emit_step_progress(job_id, step="translate", label="Dịch phụ đề", status="running", percent=0, force=True)
            self.translator.translate_zh_to_vi(
                zh_srt,
                vi_srt,
                progress_callback=lambda payload: translate_progress.emit(
                    step="translate",
                    label="Dịch phụ đề",
                    status="running",
                    current=payload.get("current"),
                    total=payload.get("total"),
                    detail=payload.get("detail"),
                    unit="dòng",
                ),
            )
            self._ensure_not_cancelled(job_id)
            self._emit_step_progress(job_id, step="translate", label="Dịch phụ đề", status="completed", percent=100, force=True)
            self.db.update_job(
                job_id,
                artifacts={
                    "vi_srt_path": str(vi_srt),
                    "translation_context_path": str(vi_srt.with_suffix(".context.json")),
                },
                progress=85,
            )

            self.db.update_job(job_id, stage=PipelineStage.rendering, progress=90)
            active_step = ("render", "Render hard-sub")
            self._emit_step_progress(job_id, step="render", label="Render hard-sub", status="running", percent=0, detail="Đang ghi phụ đề vào video", force=True)
            self._ensure_not_cancelled(job_id)
            title = downloaded.get("raw_title") or downloaded.get("crawler_title") or job.input_text
            render_artifacts = self.renderer.render_job_outputs(
                raw_path,
                vi_srt,
                job_output_dir,
                title=str(title),
            )
            self._emit_step_progress(job_id, step="render", label="Render hard-sub", status="completed", percent=100, force=True)
            self.db.update_job(
                job_id,
                status=JobStatus.completed,
                stage=PipelineStage.completed,
                progress=100,
                artifacts={
                    **render_artifacts,
                },
            )
        except PipelineCancelled:
            return
        except Exception as exc:
            message = humanize_pipeline_error(exc)
            self._emit_step_progress(
                job_id,
                step=active_step[0],
                label=active_step[1],
                status="failed",
                detail=message,
                force=True,
            )
            self.db.update_job(
                job_id,
                status=JobStatus.failed,
                stage=PipelineStage.failed,
                error_message=message,
            )

    def _ensure_not_cancelled(self, job_id: int) -> None:
        current = self.db.get_job(job_id)
        if current.artifacts.get("cancel_requested"):
            raise PipelineCancelled("Pipeline cancelled")

    def _download_progress_hook(self, job_id: int):
        def _hook(status: dict) -> None:
            state = status.get("status")
            if state not in {"downloading", "finished"}:
                return

            now = time.monotonic()
            if state == "downloading" and now - self._last_download_progress_at < 0.5:
                return
            self._last_download_progress_at = now

            downloaded = status.get("downloaded_bytes") or 0
            total = status.get("total_bytes") or status.get("total_bytes_estimate") or 0
            percent = min(100.0, (downloaded / total) * 100) if total else 0.0
            pipeline_progress = 30 + int((percent / 100) * 15)
            if state == "finished":
                percent = 100.0
                pipeline_progress = 45

            download_progress = {
                "status": state,
                "percent": round(percent, 1),
                "downloaded_bytes": int(downloaded) if downloaded else None,
                "total_bytes": int(total) if total else None,
                "speed_bytes_per_sec": int(status.get("speed") or 0) or None,
                "eta_seconds": int(status.get("eta") or 0) or None,
                "filename": status.get("filename"),
            }
            step_progress = {
                "step": "download",
                "label": "Tải video",
                "status": "completed" if state == "finished" else "running",
                "percent": round(percent, 1),
                "updated_at_ms": int(time.time() * 1000),
            }
            if downloaded:
                step_progress["current"] = int(downloaded)
                step_progress["unit"] = "byte"
            if total:
                step_progress["total"] = int(total)
            if state != "finished":
                detail_parts = []
                if downloaded and total:
                    detail_parts.append(f"{format_bytes(downloaded)} / {format_bytes(total)}")
                if status.get("speed"):
                    detail_parts.append(f"{format_bytes(status.get('speed'))}/s")
                if status.get("eta"):
                    detail_parts.append(f"ETA {int(status.get('eta') or 0)}s")
                if detail_parts:
                    step_progress["detail"] = " · ".join(detail_parts)

            self.db.update_job(
                job_id,
                progress=pipeline_progress,
                artifacts={
                    "download_progress": download_progress,
                    "step_progress": step_progress,
                },
            )

        return _hook

    def _search_and_download_variants(self, job_id: int, keyword_plan, max_duration_seconds: int, progress_hook) -> dict[str, str]:
        errors = []
        queries = [
            *keyword_plan.queries,
            f"{keyword_plan.keyword_zh} 短视频",
            f"{keyword_plan.keyword_zh} 体验",
        ]
        for query in queries:
            try:
                return self.downloader.search_and_download(
                    query,
                    job_id,
                    keyword_plan.platform_priority[0],
                    max_duration_seconds=max_duration_seconds,
                    progress_callback=progress_hook,
                )
            except Exception as exc:
                errors.append(f"{query}: {exc}")
        raise RuntimeError("All search queries failed. " + " | ".join(errors[-3:]))

    def extract_chinese_subtitles(self, raw_path: Path, zh_srt: Path, *, job_id: int) -> str:
        try:
            ocr_progress = ThrottledProgress(
                lambda payload: self.db.update_job(job_id, artifacts={"step_progress": payload})
            )
            self._emit_step_progress(job_id, step="ocr", label="OCR phụ đề Trung", status="running", percent=0, detail="Đang đọc chữ trên video", force=True)
            self.ocr.extract_zh(
                raw_path,
                zh_srt,
                progress_callback=lambda payload: ocr_progress.emit(
                    step="ocr",
                    label="OCR phụ đề Trung",
                    status="running",
                    current=payload.get("current"),
                    total=payload.get("total"),
                    unit="frame",
                ),
            )
            self._emit_step_progress(job_id, step="ocr", label="OCR phụ đề Trung", status="completed", percent=100, force=True)
            return "ocr_hardsub"
        except Exception:
            self._emit_step_progress(job_id, step="ocr", label="OCR phụ đề Trung", status="failed", detail="OCR không đủ dữ liệu, chuyển sang STT", force=True)
            stt_progress = ThrottledProgress(
                lambda payload: self.db.update_job(job_id, artifacts={"step_progress": payload})
            )
            self._emit_step_progress(job_id, step="stt", label="Nhận diện thoại", status="running", percent=0, force=True)
            self.stt.transcribe_zh(
                raw_path,
                zh_srt,
                progress_callback=lambda payload: stt_progress.emit(
                    step="stt",
                    label="Nhận diện thoại",
                    status="running",
                    percent=payload.get("percent"),
                    current=payload.get("current"),
                    total=payload.get("total"),
                    unit=payload.get("unit"),
                    detail=payload.get("detail"),
                ),
            )
            self._emit_step_progress(job_id, step="stt", label="Nhận diện thoại", status="completed", percent=100, force=True)
            return "stt_audio"

    def _emit_step_progress(
        self,
        job_id: int,
        *,
        step: str,
        label: str,
        status: str = "running",
        percent: float | None = None,
        current: int | None = None,
        total: int | None = None,
        detail: str | None = None,
        unit: str | None = None,
        force: bool = False,
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
        self.db.update_job(job_id, artifacts={"step_progress": payload})


def humanize_pipeline_error(exc: Exception) -> str:
    text = str(exc)
    lowered = text.lower()
    if "chưa cấu hình deepseek api key" in lowered or "missing deepseek_api_key" in lowered or "acd_deepseek_api_key" in lowered:
        return "Chưa cấu hình DeepSeek API key. Mở tab Config, nhập API key rồi lưu, sau đó bấm Chạy lại job."
    if "silero_vad" in lowered and ("no_suchfile" in lowered or "doesn't exist" in lowered or "file doesn't exist" in lowered):
        return "Engine thiếu asset STT/OCR nội bộ. Cập nhật bản build mới rồi bấm Chạy lại job, không cần xóa video đã tải."
    if "invalid api key" in lowered or "unauthorized" in lowered or "401" in lowered:
        return "DeepSeek API key không hợp lệ. Kiểm tra lại key trong tab Config rồi bấm Chạy lại job."
    if "insufficient balance" in lowered or "402" in lowered:
        return "DeepSeek API key hết tiền hoặc chưa có quota. Nạp quota/đổi key trong tab Config rồi bấm Chạy lại job."
    if "rate limit" in lowered or "429" in lowered:
        return "DeepSeek đang giới hạn tốc độ. Chờ một lát rồi bấm Chạy lại job."
    return text


def format_bytes(value: object) -> str:
    try:
        size = float(value)
    except (TypeError, ValueError):
        return "-"
    units = ["B", "KB", "MB", "GB"]
    unit = 0
    while size >= 1024 and unit < len(units) - 1:
        size /= 1024
        unit += 1
    precision = 0 if unit == 0 else 1
    return f"{size:.{precision}f} {units[unit]}"



