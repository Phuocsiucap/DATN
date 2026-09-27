from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from common.core.config import get_settings
from common.core.llm import deepseek_chat_completion
import httpx


BILIBILI_OCR_TASK_TYPE = "BILIBILI_OCR_EPISODE"


@dataclass(frozen=True)
class OcrLine:
    text: str
    confidence: float
    width: float
    height: float
    x: float
    y: float


def process_bilibili_ocr_episode_task(task_id: uuid.UUID | str) -> None:
    from common.db.models import ContentItem, KafkaTask, MediaWorkflow
    from common.db.session import SessionLocal

    db = SessionLocal()
    try:
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if not task or task.task_type != BILIBILI_OCR_TASK_TYPE or task.status not in {"PENDING", "FAILED"}:
            return

        workflow = None
        if str(task.reference_type or "").lower() == "media_workflow":
            workflow = db.get(MediaWorkflow, task.reference_id) if task.reference_id else None
            content = db.get(ContentItem, workflow.primary_content_id) if workflow and workflow.primary_content_id else None
        else:
            content = db.get(ContentItem, task.reference_id) if task.reference_id else None
        if not content:
            raise RuntimeError("ContentItem not found for Bilibili OCR task")

        payload = task.payload_jsonb if isinstance(task.payload_jsonb, dict) else {}
        task.status = "RUNNING"
        task.started_at = datetime.now(timezone.utc)
        task.completed_at = None
        task.error_message = None
        _update_task(db, task, "LOADING_EPISODE_METADATA", 12)

        episode = _episode_from_content(content, payload)
        _update_task(db, task, "EXTRACTING_SOURCE_TEXT", 28)
        raw_text, source_kind, extracted_segments = _extract_episode_text(content, episode, payload)
        if not raw_text:
            raise RuntimeError("Không tìm thấy text/transcript/metadata đủ để OCR Bilibili")

        _update_task(db, task, "SEGMENTING_TRANSCRIPT", 45)
        raw_segments = extracted_segments or _segments_from_text(raw_text, duration_seconds=_safe_int(episode.get("duration_seconds")))

        _update_task(db, task, "TRANSLATING_TRANSCRIPT", 70)
        translated_segments, translation_meta = _translate_segments(raw_segments, content, payload)
        translated_text = "\n".join(segment["translated_text"] for segment in translated_segments if segment.get("translated_text")).strip()

        result = {
            "content_id": str(content.id),
            "episode_index": _safe_int(payload.get("episode_index") or episode.get("episode_index")) or 1,
            "title": payload.get("title") or episode.get("title") or content.canonical_title,
            "url": payload.get("url") or episode.get("url") or content.canonical_url,
            "bvid": payload.get("bvid") or episode.get("bvid"),
            "aid": payload.get("aid") or episode.get("aid"),
            "cid": payload.get("cid") or episode.get("cid"),
            "raw_text": raw_text,
            "translated_text": translated_text or raw_text,
            "segments": translated_segments,
            "translated_segments": translated_segments,
            "source_kind": source_kind,
            "translation": translation_meta,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }

        _update_task(db, task, "SAVING_TRANSLATED_TEXT", 92)
        _store_ocr_result_on_content(content, result)
        task.result_jsonb = result
        task.status = "COMPLETED"
        task.current_stage = "OCR_TRANSLATION_READY"
        task.progress_percent = 100
        task.completed_at = datetime.now(timezone.utc)
        if workflow:
            workflow.status = "READY"
            workflow.current_stage = "OCR_TRANSLATION_READY"
            workflow.progress_percent = 35
            metadata = dict(workflow.metadata_json or {})
            metadata["ocr_translation_ready"] = True
            metadata["latest_ocr_task_id"] = str(task.id)
            workflow.metadata_json = metadata
            db.add(workflow)
        db.add_all([content, task])
        db.commit()
    except Exception as error:
        db.rollback()
        task = db.get(KafkaTask, uuid.UUID(str(task_id)))
        if task:
            task.status = "FAILED"
            task.current_stage = task.current_stage or "OCR_FAILED"
            task.error_message = str(error)[-2000:]
            task.completed_at = datetime.now(timezone.utc)
            db.add(task)
            db.commit()
    finally:
        db.close()


def _update_task(db: Any, task: Any, stage: str, percent: float) -> None:
    task.current_stage = stage
    task.progress_percent = percent
    task.heartbeat_at = datetime.now(timezone.utc)
    db.add(task)
    db.commit()


def _episode_from_content(content: Any, payload: dict[str, Any]) -> dict[str, Any]:
    metadata = _primary_source_metadata(content)
    requested_index = _safe_int(payload.get("episode_index"))
    episodes = metadata.get("episodes") if isinstance(metadata.get("episodes"), list) else []
    for index, episode in enumerate(episodes, start=1):
        if not isinstance(episode, dict):
            continue
        episode_index = _safe_int(episode.get("episode_index")) or index
        if requested_index and episode_index == requested_index:
            return episode
    return {
        "episode_index": requested_index or content.episode_order or 1,
        "title": payload.get("title") or content.canonical_title,
        "url": payload.get("url") or content.canonical_url,
        "bvid": payload.get("bvid") or metadata.get("bvid"),
        "aid": payload.get("aid") or metadata.get("aid"),
        "cid": payload.get("cid") or metadata.get("cid"),
        "duration_seconds": content.duration_seconds or metadata.get("duration_seconds"),
        "description": metadata.get("description"),
    }


def _extract_episode_text(content: Any, episode: dict[str, Any], payload: dict[str, Any]) -> tuple[str, str, list[dict[str, Any]] | None]:
    subtitle_segments = _fetch_bilibili_subtitle_segments(episode, payload)
    if subtitle_segments:
        subtitle_text = "\n".join(segment["raw_text"] for segment in subtitle_segments if segment.get("raw_text")).strip()
        return subtitle_text, "bilibili_subtitle_api", subtitle_segments

    hard_subtitle_segments = _fetch_hard_subtitle_ocr_segments(episode, payload)
    if hard_subtitle_segments:
        hard_subtitle_text = "\n".join(segment["raw_text"] for segment in hard_subtitle_segments if segment.get("raw_text")).strip()
        return hard_subtitle_text, "hard_subtitle_frame_ocr", hard_subtitle_segments

    candidates: list[tuple[str, Any]] = [
        ("episode_transcript", episode.get("transcript") or episode.get("subtitle") or episode.get("subtitles")),
        ("episode_description", episode.get("description")),
        ("payload_text", payload.get("raw_text") or payload.get("transcript")),
        ("content_summary", content.summary),
        ("episode_title", episode.get("title") or payload.get("title")),
    ]
    metadata = _primary_source_metadata(content)
    candidates.extend([
        ("metadata_transcript", metadata.get("transcript") or metadata.get("subtitle") or metadata.get("subtitles")),
        ("metadata_description", metadata.get("description")),
    ])
    for source_kind, value in candidates:
        text = _coerce_text(value)
        if text:
            return text, source_kind, None
    return "", "missing", None


def _fetch_bilibili_subtitle_text(episode: dict[str, Any], payload: dict[str, Any]) -> str:
    segments = _fetch_bilibili_subtitle_segments(episode, payload)
    return "\n".join(segment["raw_text"] for segment in segments if segment.get("raw_text")).strip()


def _fetch_bilibili_subtitle_segments(episode: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    bvid = str(payload.get("bvid") or episode.get("bvid") or "").strip()
    cid = _safe_int(payload.get("cid") or episode.get("cid"))
    if not bvid:
        return []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,vi;q=0.7",
        "Referer": f"https://www.bilibili.com/video/{bvid}",
    }
    cookie = os.getenv("ACD_BILIBILI_COOKIE")
    if cookie:
        headers["Cookie"] = cookie
    try:
        with httpx.Client(timeout=20, follow_redirects=True, headers=headers) as client:
            cid = cid or _resolve_bilibili_cid(client, bvid, episode, payload)
            if not cid:
                return ""
            response = client.get("https://api.bilibili.com/x/player/v2", params={"bvid": bvid, "cid": cid})
            response.raise_for_status()
            subtitles = ((response.json().get("data") or {}).get("subtitle") or {}).get("subtitles") or []
            if not isinstance(subtitles, list):
                return []
            for subtitle in subtitles:
                if not isinstance(subtitle, dict):
                    continue
                subtitle_url = str(subtitle.get("subtitle_url") or "").strip()
                if not subtitle_url:
                    continue
                if subtitle_url.startswith("//"):
                    subtitle_url = f"https:{subtitle_url}"
                body_response = client.get(subtitle_url)
                body_response.raise_for_status()
                body = body_response.json().get("body") or []
                segments = _segments_from_bilibili_subtitle_body(body)
                if segments:
                    return segments
    except Exception:
        return []
    return []


def _resolve_bilibili_cid(client: httpx.Client, bvid: str, episode: dict[str, Any], payload: dict[str, Any]) -> int | None:
    requested_page = _safe_int(payload.get("page") or episode.get("page"))
    requested_title = re.sub(r"\s+", "", str(payload.get("title") or episode.get("title") or ""))
    try:
        response = client.get("https://api.bilibili.com/x/player/pagelist", params={"bvid": bvid})
        response.raise_for_status()
        pages = response.json().get("data") or []
        if isinstance(pages, list):
            first_cid = None
            for index, page in enumerate(pages, start=1):
                if not isinstance(page, dict):
                    continue
                cid = _safe_int(page.get("cid"))
                if cid and first_cid is None:
                    first_cid = cid
                page_num = _safe_int(page.get("page")) or index
                page_title = re.sub(r"\s+", "", str(page.get("part") or ""))
                if cid and requested_page and page_num == requested_page:
                    return cid
                if cid and requested_title and page_title and (page_title in requested_title or requested_title in page_title):
                    return cid
            if first_cid:
                return first_cid
    except Exception:
        pass

    try:
        response = client.get("https://api.bilibili.com/x/web-interface/view", params={"bvid": bvid})
        response.raise_for_status()
        data = response.json().get("data") or {}
        cid = _safe_int(data.get("cid"))
        if cid:
            return cid
        pages = data.get("pages") if isinstance(data, dict) else []
        if isinstance(pages, list):
            for page in pages:
                if isinstance(page, dict) and _safe_int(page.get("cid")):
                    return _safe_int(page.get("cid"))
    except Exception:
        return None
    return None


def _fetch_hard_subtitle_ocr_text(episode: dict[str, Any], payload: dict[str, Any]) -> str:
    segments = _fetch_hard_subtitle_ocr_segments(episode, payload)
    return "\n".join(segment["raw_text"] for segment in segments if segment.get("raw_text")).strip()


def _fetch_hard_subtitle_ocr_segments(episode: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    if str(os.getenv("BILIBILI_HARDSUB_OCR_ENABLED", "1")).strip().lower() in {"0", "false", "no"}:
        return []
    url = str(payload.get("url") or episode.get("url") or "").strip()
    bvid = str(payload.get("bvid") or episode.get("bvid") or "").strip()
    if not url and bvid:
        url = f"https://www.bilibili.com/video/{bvid}"
    if not url:
        return []

    fps = _safe_float(os.getenv("BILIBILI_HARDSUB_OCR_FPS")) or 1.5
    max_duration = _safe_int(os.getenv("BILIBILI_HARDSUB_OCR_MAX_SECONDS")) or 360
    try:
        with tempfile.TemporaryDirectory(prefix="bili_hardsub_ocr_") as temp_dir:
            work_dir = Path(temp_dir)
            video_path = _download_bilibili_video(url, work_dir)
            frame_dir = work_dir / "frames"
            frame_dir.mkdir(parents=True, exist_ok=True)
            _extract_subtitle_frames(video_path, frame_dir, fps=fps, duration_seconds=max_duration)
            segments = _ocr_subtitle_frames(frame_dir, fps=fps)
            if len(segments) < 2:
                return []
            return _segments_from_timed_text(segments)
    except Exception:
        return []


def _download_bilibili_video(url: str, work_dir: Path) -> Path:
    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:
        raise RuntimeError("yt-dlp is required for Bilibili hard-subtitle OCR") from exc

    outtmpl = str(work_dir / "source.%(ext)s")
    options: dict[str, Any] = {
        "outtmpl": outtmpl,
        "format": "bv*[height<=720]/bv*/30064/30032/30016",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "no_progress": True,
        "socket_timeout": 20,
        "retries": 2,
        "fragment_retries": 2,
        "extractor_retries": 2,
    }
    cookiefile = os.getenv("ACD_YTDLP_COOKIES") or os.getenv("BILIBILI_YTDLP_COOKIES")
    if cookiefile and Path(cookiefile).exists():
        options["cookiefile"] = cookiefile
    ffmpeg = _find_ffmpeg()
    if ffmpeg:
        ffmpeg_path = Path(ffmpeg)
        options["ffmpeg_location"] = str(ffmpeg_path.parent if ffmpeg_path.is_file() else ffmpeg_path)

    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        candidates = [
            *(Path(item.get("filepath")) for item in info.get("requested_downloads") or [] if item.get("filepath")),
            Path(ydl.prepare_filename(info)),
            Path(ydl.prepare_filename(info)).with_suffix(".mp4"),
            *sorted(work_dir.glob("source.*"), key=lambda path: path.stat().st_mtime, reverse=True),
        ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    raise FileNotFoundError("Could not find downloaded Bilibili video for OCR")


def _extract_subtitle_frames(video_path: Path, frame_dir: Path, *, fps: float, duration_seconds: int) -> None:
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("FFmpeg is required for Bilibili hard-subtitle OCR")
    output = frame_dir / "frame-%06d.jpg"
    vf = f"fps={fps},scale=-1:720,crop=iw:ih*0.55:0:ih*0.45"
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(video_path),
        "-t",
        str(duration_seconds),
        "-vf",
        vf,
        "-q:v",
        "3",
        str(output),
    ]
    process = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if process.returncode != 0:
        raise RuntimeError(process.stderr[-2000:])


def _ocr_subtitle_frames(frame_dir: Path, *, fps: float) -> list[dict[str, Any]]:
    ocr = _load_rapid_ocr()
    frame_paths = sorted(frame_dir.glob("frame-*.jpg"))
    frame_step = 1.0 / max(fps, 0.1)
    segments: list[dict[str, Any]] = []
    active_text = ""
    active_start = 0.0
    active_last = 0.0
    for index, frame_path in enumerate(frame_paths):
        timestamp = index * frame_step
        text = _recognize_frame_text(ocr, frame_path)
        if not text:
            if active_text and timestamp - active_last > frame_step * 1.5:
                segments.append({"start": round(active_start, 2), "end": round(active_last + frame_step, 2), "text": active_text})
                active_text = ""
            continue
        if active_text and _similar_text(text, active_text):
            active_last = timestamp
            continue
        if active_text:
            segments.append({"start": round(active_start, 2), "end": round(active_last + frame_step, 2), "text": active_text})
        active_text = text
        active_start = timestamp
        active_last = timestamp
    if active_text:
        segments.append({"start": round(active_start, 2), "end": round(active_last + frame_step, 2), "text": active_text})
    return _merge_close_ocr_duplicates(segments)


def _recognize_frame_text(ocr: Any, frame_path: Path) -> str:
    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("numpy and pillow are required for Bilibili hard-subtitle OCR") from exc

    image = np.array(Image.open(frame_path).convert("RGB"))
    image_height, image_width = image.shape[:2]
    lines: list[OcrLine] = []
    for points, raw_text, raw_confidence in _run_rapid_ocr(ocr, image):
        text = _normalize_ocr_text(str(raw_text))
        confidence = float(raw_confidence or 0)
        text = _normalize_ocr_text(str(text))
        if not _is_dialogue_chinese(text):
            continue
        width, height = _bbox_size(points)
        x, y = _bbox_origin(points)
        if width < 36 or height < 8 or height > width * 0.95:
            continue
        if _is_side_watermark(points, image_width=image_width, image_height=image_height):
            continue
        lines.append(OcrLine(text=text, confidence=confidence, width=width, height=height, x=x, y=y))
    return _combine_dialogue_lines(lines)


def _load_rapid_ocr() -> Any:
    try:
        from rapidocr_onnxruntime import RapidOCR

        return RapidOCR()
    except ImportError:
        try:
            from rapidocr import RapidOCR

            return RapidOCR()
        except ImportError as exc:
            raise RuntimeError("rapidocr or rapidocr_onnxruntime is required for Bilibili hard-subtitle OCR") from exc


def _run_rapid_ocr(ocr: Any, image: Any) -> list[tuple[Any, str, float]]:
    output = ocr(image)
    if isinstance(output, tuple):
        result = output[0]
        rows = []
        for item in ([] if result is None else result):
            try:
                points, text, confidence = item
            except ValueError:
                continue
            rows.append((points, str(text), float(confidence or 0)))
        return rows

    boxes = getattr(output, "boxes", None)
    texts = getattr(output, "txts", None)
    scores = getattr(output, "scores", None)
    if boxes is not None and texts is not None:
        box_rows = list(boxes)
        text_rows = list(texts)
        score_rows = list(scores) if scores is not None else [0.0] * len(text_rows)
        return [
            (points, str(text), float(score or 0))
            for points, text, score in zip(box_rows, text_rows, score_rows)
        ]
    return []


def _bbox_size(points: Any) -> tuple[float, float]:
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return max(xs) - min(xs), max(ys) - min(ys)


def _bbox_origin(points: Any) -> tuple[float, float]:
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return min(xs), min(ys)


def _is_side_watermark(points: Any, *, image_width: int, image_height: int) -> bool:
    x, y = _bbox_origin(points)
    width, height = _bbox_size(points)
    if height > width * 1.15:
        return True
    center_x = x + width / 2
    center_y = y + height / 2
    return center_x > image_width * 0.80 and center_y < image_height * 0.72


def _normalize_ocr_text(text: str) -> str:
    cleaned = re.sub(r"\s+", "", text)
    cleaned = cleaned.replace("｜", "").replace("|", "")
    cleaned = re.sub(r"[^\u3400-\u9fffA-Za-z0-9，。！？、,.!?：:；;《》“”\"'（）()]", "", cleaned)
    return cleaned.strip("，。！？、,.!?：:；;")


def _is_dialogue_chinese(text: str) -> bool:
    han = len(re.findall(r"[\u3400-\u9fff]", text))
    if han < 2:
        return False
    if han / max(1, len(text)) < 0.45:
        return False
    watermark_terms = ["观看完整版", "评论区置顶", "小锦鲤剧场", "bilibili", "字幕"]
    return not any(term.lower() in text.lower() for term in watermark_terms)


def _combine_dialogue_lines(lines: list[OcrLine]) -> str:
    candidates = _dedupe_ocr_lines(lines)
    candidates = [line for line in candidates if line.confidence >= 0.35]
    if not candidates:
        return ""
    candidates.sort(key=lambda line: (line.y, line.x))
    rows: list[list[OcrLine]] = []
    for line in candidates:
        if not rows:
            rows.append([line])
            continue
        row_y = sum(item.y for item in rows[-1]) / len(rows[-1])
        if abs(line.y - row_y) <= max(18.0, line.height * 0.9):
            rows[-1].append(line)
        else:
            rows.append([line])

    text_rows: list[str] = []
    for row in rows:
        row.sort(key=lambda line: line.x)
        row_text = _normalize_ocr_text("".join(line.text for line in row))
        if _is_dialogue_chinese(row_text):
            text_rows.append(row_text)
    return "\n".join(text_rows[:3])


def _dedupe_ocr_lines(lines: list[OcrLine]) -> list[OcrLine]:
    kept: list[OcrLine] = []
    for line in sorted(lines, key=lambda item: (-item.confidence, -item.width)):
        if any(_similar_text(line.text, item.text) for item in kept):
            continue
        kept.append(line)
    return kept


def _similar_text(left: str, right: str) -> bool:
    lkey = _normalize_compare_key(left)
    rkey = _normalize_compare_key(right)
    if not lkey or not rkey:
        return False
    if lkey in rkey or rkey in lkey:
        return True
    return SequenceMatcher(None, lkey, rkey).ratio() >= 0.82


def _normalize_compare_key(text: str) -> str:
    return re.sub(r"[^\u3400-\u9fffA-Za-z0-9]", "", text).lower()


def _merge_close_ocr_duplicates(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for segment in segments:
        if out and _similar_text(str(out[-1].get("text") or ""), str(segment.get("text") or "")) and float(segment.get("start") or 0) - float(out[-1].get("end") or 0) < 1.5:
            out[-1] = {**out[-1], "end": max(float(out[-1].get("end") or 0), float(segment.get("end") or 0))}
            continue
        out.append(segment)
    return [item for item in out if float(item.get("end") or 0) - float(item.get("start") or 0) >= 0.35]


def _find_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _translate_segments(segments: list[dict[str, Any]], content: Any, payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not segments:
        return segments, {"provider": "none", "status": "EMPTY"}

    settings = get_settings()
    if not getattr(settings, "deepseek_api_key", None):
        return [
            {**segment, "translated_text": segment["raw_text"], "translation_status": "SOURCE_REUSED"}
            for segment in segments
        ], {"provider": "none", "status": "SOURCE_REUSED", "reason": "Missing DEEPSEEK_API_KEY"}

    prompt = {
        "task": "Translate Bilibili video OCR/transcript segments into natural Vietnamese for short-video production.",
        "rules": [
            "Return only valid JSON object.",
            "Keep the same segment indexes.",
            "Do not add facts that are not in the source text.",
            "Make Vietnamese concise, spoken, and suitable for subtitles.",
        ],
        "source_title": content.canonical_title,
        "episode_title": payload.get("title"),
        "segments": [{"index": segment["index"], "text": segment["raw_text"]} for segment in segments],
    }
    try:
        result = deepseek_chat_completion(
            base_url=settings.deepseek_base_url,
            api_key=settings.deepseek_api_key,
            model="deepseek-v4-flash",
            messages=[
                {"role": "system", "content": "You translate video transcript segments to Vietnamese JSON."},
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
            thinking=False,
            timeout=120,
        )
        parsed = result.parsed_json()
        rows = parsed.get("segments") if isinstance(parsed, dict) else []
        translated_by_index = {
            _safe_int(row.get("index")): str(row.get("translated_text") or row.get("translation") or row.get("text") or "").strip()
            for row in rows
            if isinstance(row, dict)
        }
        translated = [
            {**segment, "translated_text": translated_by_index.get(segment["index"]) or segment["raw_text"], "translation_status": "TRANSLATED"}
            for segment in segments
        ]
        return translated, {
            "provider": result.provider,
            "model": result.model,
            "status": "TRANSLATED",
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
        }
    except Exception as exc:
        return [
            {**segment, "translated_text": segment["raw_text"], "translation_status": "SOURCE_REUSED"}
            for segment in segments
        ], {"provider": "deepseek", "status": "SOURCE_REUSED", "error": str(exc)[-500:]}


def _segments_from_text(text: str, *, duration_seconds: int | None = None) -> list[dict[str, Any]]:
    chunks = _split_text(text, max_chars=180)
    total_duration = max(duration_seconds or len(chunks) * 4, len(chunks) * 2, 1)
    step = total_duration / max(len(chunks), 1)
    return [
        {
            "index": index,
            "start": round((index - 1) * step, 2),
            "end": round(max(index * step, (index - 1) * step + 0.5), 2),
            "raw_text": chunk,
            "translated_text": chunk,
            "confidence": None,
        }
        for index, chunk in enumerate(chunks, start=1)
    ]


def _segments_from_timed_text(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        text = _coerce_text(row.get("text") or row.get("raw_text") or row.get("content")).strip()
        if not text:
            continue
        start = _safe_float(row.get("start") or row.get("from")) or 0.0
        end = _safe_float(row.get("end") or row.get("to")) or start + 1.0
        if end <= start:
            end = start + 1.0
        segments.append({
            "index": len(segments) + 1,
            "start": round(start, 2),
            "end": round(end, 2),
            "raw_text": text,
            "translated_text": text,
            "confidence": row.get("confidence"),
        })
    return segments


def _segments_from_bilibili_subtitle_body(body: Any) -> list[dict[str, Any]]:
    if not isinstance(body, list):
        return []
    rows: list[dict[str, Any]] = []
    for item in body:
        if not isinstance(item, dict):
            continue
        text = _coerce_text(item.get("content") or item.get("text")).strip()
        if not text:
            continue
        rows.append({
            "start": item.get("from"),
            "end": item.get("to"),
            "text": text,
        })
    return _segments_from_timed_text(rows)


def _split_text(text: str, *, max_chars: int) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []
    parts = [part.strip() for part in re.split(r"(?<=[。.!?！？；;])\s*", normalized) if part.strip()] or [normalized]
    chunks: list[str] = []
    current = ""
    for part in parts:
        if len(current) + len(part) + 1 <= max_chars:
            current = f"{current} {part}".strip()
            continue
        if current:
            chunks.append(current)
        while len(part) > max_chars:
            chunks.append(part[:max_chars].strip())
            part = part[max_chars:].strip()
        current = part
    if current:
        chunks.append(current)
    return chunks[:80]


def _store_ocr_result_on_content(content: Any, result: dict[str, Any]) -> None:
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary = dict(sources[0]) if sources and isinstance(sources[0], dict) else {}
    metadata = dict(primary.get("metadata_json") if isinstance(primary.get("metadata_json"), dict) else {})
    results = metadata.get("ocr_results") if isinstance(metadata.get("ocr_results"), dict) else {}
    episode_key = str(result.get("episode_index") or 1)
    results[episode_key] = {
        "status": "COMPLETED",
        "task_completed_at": result.get("completed_at"),
        "title": result.get("title"),
        "url": result.get("url"),
        "raw_text": result.get("raw_text"),
        "translated_text": result.get("translated_text"),
        "segments": result.get("segments") or [],
        "translation": result.get("translation") or {},
    }
    metadata["ocr_results"] = results
    metadata["ocr_status"] = "COMPLETED"
    primary["metadata_json"] = metadata
    content.sources_jsonb = [primary, *sources[1:]] if sources else [primary]


def _primary_source_metadata(content: Any) -> dict[str, Any]:
    sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
    primary = sources[0] if sources and isinstance(sources[0], dict) else {}
    metadata = primary.get("metadata_json") if isinstance(primary.get("metadata_json"), dict) else {}
    return metadata if isinstance(metadata, dict) else {}


def _coerce_text(value: Any) -> str:
    if value in (None, "", []):
        return ""
    if isinstance(value, str):
        return re.sub(r"\s+", " ", value).strip()
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or item.get("raw_text") or ""))
            else:
                parts.append(str(item))
        return re.sub(r"\s+", " ", " ".join(parts)).strip()
    if isinstance(value, dict):
        return _coerce_text(value.get("text") or value.get("content") or value.get("raw_text") or value.get("body"))
    return re.sub(r"\s+", " ", str(value)).strip()


def _safe_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None
