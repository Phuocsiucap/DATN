from __future__ import annotations

import re
import subprocess
import tempfile
import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from PIL import Image

from backend.bilibili_service.app.integrations.bilibili.progress import ProgressCallback
from backend.bilibili_service.app.integrations.bilibili.render import find_ffmpeg
from backend.bilibili_service.app.integrations.bilibili.stt import TimedSegment, seconds_to_srt

_WORKER_OCR = None


@dataclass(frozen=True)
class OcrLine:
    text: str
    confidence: float
    width: float
    height: float
    x: float
    y: float


class HardSubtitleExtractor:
    def __init__(self, fps: float = 2.5, workers: int | None = None) -> None:
        self.fps = fps
        self.workers = workers or min(4, max(1, (os.cpu_count() or 2) - 1))
        self._ocr = None

    def available(self) -> bool:
        try:
            self._load_ocr()
            return True
        except Exception:
            return False

    def extract_zh(
        self,
        video_path: Path,
        output_srt_path: Path,
        *,
        start_seconds: float = 0.0,
        duration_seconds: float | None = None,
        progress_callback: ProgressCallback | None = None,
    ) -> str:
        ocr = self._load_ocr()
        with tempfile.TemporaryDirectory(prefix="acd_ocr_") as temp_dir:
            frame_dir = Path(temp_dir)
            extract_subtitle_frames(video_path, frame_dir, self.fps, start_seconds=start_seconds, duration_seconds=duration_seconds)
            segments = self._frames_to_segments(ocr, frame_dir, offset=start_seconds, progress_callback=progress_callback)
        if len(segments) < 12:
            raise RuntimeError("OCR subtitle extraction did not find enough Chinese subtitle lines.")
        write_segments_to_srt(segments, output_srt_path)
        return str(output_srt_path)

    def _load_ocr(self):
        if self._ocr is None:
            try:
                from rapidocr_onnxruntime import RapidOCR
            except ImportError as exc:
                raise RuntimeError("rapidocr_onnxruntime is required for OCR subtitle extraction.") from exc
            self._ocr = RapidOCR()
        return self._ocr

    def _frames_to_segments(
        self,
        ocr: Any,
        frame_dir: Path,
        *,
        offset: float = 0.0,
        progress_callback: ProgressCallback | None = None,
    ) -> list[TimedSegment]:
        active_text = ""
        active_start = 0.0
        active_last = 0.0
        segments: list[TimedSegment] = []
        frame_paths = sorted(frame_dir.glob("frame-*.jpg"))
        frame_step = 1.0 / self.fps
        texts = recognize_frames(frame_paths, ocr=ocr, workers=self.workers, progress_callback=progress_callback)
        for index, text in enumerate(texts):
            timestamp = offset + index * frame_step
            if not text:
                if active_text and timestamp - active_last > frame_step * 1.5:
                    segments.append(TimedSegment(active_start, active_last + frame_step, active_text))
                    active_text = ""
                continue
            if active_text and similar_text(text, active_text):
                active_last = timestamp
                continue
            if active_text:
                segments.append(TimedSegment(active_start, active_last + frame_step, active_text))
            active_text = text
            active_start = timestamp
            active_last = timestamp
        if active_text:
            segments.append(TimedSegment(active_start, active_last + frame_step, active_text))
        return merge_close_duplicates(segments)


def recognize_frames(
    frame_paths: list[Path],
    *,
    ocr: Any,
    workers: int,
    progress_callback: ProgressCallback | None = None,
) -> list[str]:
    total = len(frame_paths)
    if workers <= 1 or len(frame_paths) < 24:
        out = []
        for index, frame_path in enumerate(frame_paths, start=1):
            out.append(recognize_frame_text(ocr, frame_path))
            if progress_callback:
                progress_callback({"current": index, "total": total})
        return out
    with ProcessPoolExecutor(max_workers=workers, initializer=init_ocr_worker) as executor:
        out = []
        for index, text in enumerate(executor.map(recognize_frame_text_worker, [str(path) for path in frame_paths], chunksize=8), start=1):
            out.append(text)
            if progress_callback:
                progress_callback({"current": index, "total": total})
        return out


def init_ocr_worker() -> None:
    global _WORKER_OCR
    from rapidocr_onnxruntime import RapidOCR

    _WORKER_OCR = RapidOCR()


def recognize_frame_text_worker(frame_path: str) -> str:
    if _WORKER_OCR is None:
        init_ocr_worker()
    return recognize_frame_text(_WORKER_OCR, Path(frame_path))


def extract_subtitle_frames(
    video_path: Path,
    frame_dir: Path,
    fps: float,
    *,
    start_seconds: float = 0.0,
    duration_seconds: float | None = None,
) -> None:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("FFmpeg is required for OCR subtitle extraction.")
    output = frame_dir / "frame-%06d.jpg"
    # Crop the lower half through the real bottom edge. Some Bilibili videos put
    # white subtitles at 90%+ height; cutting before the bottom silently drops
    # those lines before translation can see them.
    vf = f"fps={fps},scale=-1:720,crop=iw:ih*0.55:0:ih*0.45"
    cmd = [ffmpeg, "-y"]
    if start_seconds > 0:
        cmd.extend(["-ss", f"{start_seconds:.3f}"])
    cmd.extend(["-i", str(video_path)])
    if duration_seconds is not None:
        cmd.extend(["-t", f"{duration_seconds:.3f}"])
    cmd.extend(["-vf", vf, "-q:v", "3", str(output)])
    process = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if process.returncode != 0:
        raise RuntimeError(process.stderr[-2000:])


def recognize_frame_text(ocr: Any, frame_path: Path) -> str:
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("numpy is required for OCR subtitle extraction.") from exc
    image = np.array(Image.open(frame_path).convert("RGB"))
    image_height, image_width = image.shape[:2]
    result, _elapsed = ocr(image)
    lines: list[OcrLine] = []
    for item in result or []:
        try:
            points, text, confidence = item
        except ValueError:
            continue
        text = normalize_ocr_text(str(text))
        if not is_dialogue_chinese(text):
            continue
        width, height = bbox_size(points)
        x, y = bbox_origin(points)
        if width < 36 or height < 8 or height > width * 0.95:
            continue
        if is_side_watermark(points, image_width=image_width, image_height=image_height):
            continue
        lines.append(OcrLine(text=text, confidence=float(confidence), width=width, height=height, x=x, y=y))
    if not lines:
        return ""
    return combine_dialogue_lines(lines)


def bbox_size(points: Any) -> tuple[float, float]:
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return max(xs) - min(xs), max(ys) - min(ys)


def bbox_origin(points: Any) -> tuple[float, float]:
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return min(xs), min(ys)


def is_side_watermark(points: Any, *, image_width: int, image_height: int) -> bool:
    x, y = bbox_origin(points)
    width, height = bbox_size(points)
    if height > width * 1.15:
        return True
    center_x = x + width / 2
    center_y = y + height / 2
    if center_x > image_width * 0.80 and center_y < image_height * 0.72:
        return True
    return False


def normalize_ocr_text(text: str) -> str:
    cleaned = re.sub(r"\s+", "", text)
    cleaned = cleaned.replace("｜", "").replace("|", "")
    cleaned = re.sub(r"[^\u3400-\u9fffA-Za-z0-9，。！？、,.!?：:；;《》“”\"'（）()]", "", cleaned)
    return cleaned.strip("，。！？、,.!?：:；;")


def is_dialogue_chinese(text: str) -> bool:
    han = len(re.findall(r"[\u3400-\u9fff]", text))
    if han < 2:
        return False
    if han / max(1, len(text)) < 0.45:
        return False
    watermark_terms = ["观看完整版", "评论区置顶", "小锦鲤剧场", "bilibili", "字幕"]
    return not any(term.lower() in text.lower() for term in watermark_terms)


def combine_dialogue_lines(lines: list[OcrLine]) -> str:
    candidates = dedupe_ocr_lines(lines)
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
        row_text = "".join(line.text for line in row)
        row_text = normalize_ocr_text(row_text)
        if is_dialogue_chinese(row_text):
            text_rows.append(row_text)
    return "\n".join(text_rows[:3])


def dedupe_ocr_lines(lines: list[OcrLine]) -> list[OcrLine]:
    kept: list[OcrLine] = []
    for line in sorted(lines, key=lambda item: (-item.confidence, -item.width)):
        if any(similar_text(line.text, item.text) for item in kept):
            continue
        kept.append(line)
    return kept


def similar_text(left: str, right: str) -> bool:
    lkey = normalize_compare_key(left)
    rkey = normalize_compare_key(right)
    if not lkey or not rkey:
        return False
    if lkey in rkey or rkey in lkey:
        return True
    return SequenceMatcher(None, lkey, rkey).ratio() >= 0.82


def normalize_compare_key(text: str) -> str:
    return re.sub(r"[^\u3400-\u9fffA-Za-z0-9]", "", text).lower()


def merge_close_duplicates(segments: list[TimedSegment]) -> list[TimedSegment]:
    out: list[TimedSegment] = []
    for segment in segments:
        if out and similar_text(out[-1].text, segment.text) and segment.start - out[-1].end < 1.5:
            out[-1] = TimedSegment(out[-1].start, max(out[-1].end, segment.end), out[-1].text)
            continue
        out.append(segment)
    return [item for item in out if item.end - item.start >= 0.35]


def write_segments_to_srt(segments: list[TimedSegment], output_srt_path: Path) -> None:
    with output_srt_path.open("w", encoding="utf-8") as srt_file:
        for idx, segment in enumerate(segments, start=1):
            srt_file.write(f"{idx}\n")
            srt_file.write(f"{seconds_to_srt(segment.start)} --> {seconds_to_srt(segment.end)}\n")
            srt_file.write(f"{segment.text}\n\n")



