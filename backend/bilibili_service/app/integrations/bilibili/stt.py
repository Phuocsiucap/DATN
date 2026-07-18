from __future__ import annotations

import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from backend.bilibili_service.app.integrations.bilibili.progress import ProgressCallback
from backend.bilibili_service.app.integrations.bilibili.render import find_ffmpeg

MIN_RECOVERY_GAP_SECONDS = 5.0


@dataclass(frozen=True)
class TimedSegment:
    start: float
    end: float
    text: str


class SpeechToText:
    def __init__(self, model_name: str = "small", compute_type: str = "int8") -> None:
        self.model_name = model_name
        self.compute_type = compute_type
        self._model = None

    def transcribe_zh(
        self,
        video_path: Path,
        output_srt_path: Path,
        *,
        progress_callback: ProgressCallback | None = None,
    ) -> str:
        model = self._load_model()
        segments = list(transcribe_in_chunks(model, video_path, progress_callback=progress_callback))
        write_srt(segments, output_srt_path)
        return str(output_srt_path)

    def _load_model(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.model_name,
                device="cpu",
                compute_type=self.compute_type,
                cpu_threads=4,
            )
        return self._model


def write_srt(segments, output_srt_path: Path) -> None:
    segments = dedupe_nearby_repetitions(list(segments))
    segments = remove_short_repetition_runs(segments)
    segments = remove_music_and_noise_segments(segments)
    with output_srt_path.open("w", encoding="utf-8") as srt_file:
        idx = 1
        for segment in segments:
            chunks = split_caption_text(segment.text.strip())
            if not chunks:
                continue
            duration = max(0.1, segment.end - segment.start)
            total_weight = sum(max(1, len(chunk)) for chunk in chunks)
            cursor = segment.start
            for chunk_index, chunk in enumerate(chunks):
                if chunk_index == len(chunks) - 1:
                    end = segment.end
                else:
                    share = max(1, len(chunk)) / total_weight
                    end = min(segment.end, cursor + duration * share)
                srt_file.write(f"{idx}\n")
                srt_file.write(f"{seconds_to_srt(cursor)} --> {seconds_to_srt(end)}\n")
                srt_file.write(f"{chunk}\n\n")
                idx += 1
                cursor = end


def transcribe_in_chunks(
    model,
    video_path: Path,
    chunk_seconds: int = 25,
    *,
    progress_callback: ProgressCallback | None = None,
):
    duration = probe_duration(video_path)
    if duration is None:
        if progress_callback:
            progress_callback({"detail": "Không đọc được duration, đang nhận diện toàn bộ audio"})
        yield from transcribe_chunk(model, video_path, 0)
        if progress_callback:
            progress_callback({"percent": 100, "detail": "Đã nhận diện xong audio"})
        return

    with tempfile.TemporaryDirectory(prefix="acd_stt_") as temp_dir:
        temp_path = Path(temp_dir)
        start = 0.0
        segments: list[TimedSegment] = []
        overlap = 1.0
        if progress_callback:
            progress_callback({"current": 0, "total": int(duration), "unit": "second", "detail": "Đang tách và nhận diện audio"})
        while start < duration:
            chunk_path = temp_path / f"chunk-{int(start):06d}.wav"
            extract_audio_chunk(video_path, chunk_path, start, min(chunk_seconds + overlap, duration - start))
            for segment in transcribe_chunk(model, chunk_path, start):
                segments.append(segment)
            start += chunk_seconds
            if progress_callback:
                progress_callback({
                    "current": min(int(start), int(duration)),
                    "total": int(duration),
                    "unit": "second",
                    "detail": f"Đã nhận diện tới {seconds_to_srt(min(start, duration))}",
                })
        segments = merge_recovered_segments(
            segments,
            recover_missing_dialogue(model, video_path, temp_path, duration, segments, progress_callback=progress_callback),
        )
        if progress_callback:
            progress_callback({"percent": 100, "detail": "Đã nhận diện xong audio"})
        yield from segments


def transcribe_chunk(model, media_path: Path, offset: float, *, sensitive: bool = False):
    options = {
        "beam_size": 5,
        "language": "zh",
        "vad_filter": not sensitive,
        "condition_on_previous_text": False,
        "temperature": 0,
        "no_speech_threshold": 0.18 if sensitive else 0.35,
        "log_prob_threshold": -1.2 if sensitive else -1.0,
        "compression_ratio_threshold": 2.4,
    }
    if not sensitive:
        options["vad_parameters"] = dict(min_silence_duration_ms=500)
    segments, _info = model.transcribe(str(media_path), **options)
    for segment in segments:
        text = cleanup_stt_text(segment.text.strip())
        if not text:
            continue
        if sensitive and is_low_confidence_hallucination(segment, text):
            continue
        yield TimedSegment(start=segment.start + offset, end=segment.end + offset, text=text)


def recover_missing_dialogue(
    model,
    video_path: Path,
    temp_path: Path,
    duration: float,
    segments: list[TimedSegment],
    *,
    progress_callback: ProgressCallback | None = None,
) -> list[TimedSegment]:
    recovered: list[TimedSegment] = []
    ordered = sorted(segments, key=lambda item: item.start)
    cursor = 0.0
    gap_index = 0
    for segment in ordered:
        if segment.start - cursor >= MIN_RECOVERY_GAP_SECONDS:
            if progress_callback:
                progress_callback({
                    "current": int(min(cursor, duration)),
                    "total": int(duration),
                    "unit": "second",
                    "detail": "Đang quét lại đoạn audio bị trống",
                })
            recovered.extend(transcribe_gap(model, video_path, temp_path, gap_index, cursor, segment.start))
            gap_index += 1
        cursor = max(cursor, segment.end)
    if duration - cursor >= MIN_RECOVERY_GAP_SECONDS:
        recovered.extend(transcribe_gap(model, video_path, temp_path, gap_index, cursor, duration))
    return recovered


def transcribe_gap(
    model,
    video_path: Path,
    temp_path: Path,
    gap_index: int,
    start: float,
    end: float,
) -> list[TimedSegment]:
    padded_start = max(0.0, start - 0.35)
    padded_end = min(probe_duration(video_path) or end, end + 0.35)
    gap_path = temp_path / f"recover-{gap_index:04d}.wav"
    extract_audio_chunk(video_path, gap_path, padded_start, max(0.2, padded_end - padded_start))
    recovered = []
    for segment in transcribe_chunk(model, gap_path, padded_start, sensitive=True):
        if segment.start < start + 0.05 or segment.end > end - 0.05:
            continue
        recovered.append(segment)
    return recovered


def merge_recovered_segments(primary: list[TimedSegment], recovered: list[TimedSegment]) -> list[TimedSegment]:
    merged = sorted([*primary, *recovered], key=lambda item: (item.start, item.end))
    return dedupe_overlapping_segments(merged)


def dedupe_overlapping_segments(segments: list[TimedSegment]) -> list[TimedSegment]:
    out: list[TimedSegment] = []
    for segment in segments:
        text_key = re.sub(r"[。！？!?，,、\s]", "", segment.text)
        duplicate = False
        for existing in out[-6:]:
            existing_key = re.sub(r"[。！？!?，,、\s]", "", existing.text)
            overlaps = segment.start < existing.end + 0.8 and existing.start < segment.end + 0.8
            if overlaps and existing_key == text_key:
                duplicate = True
                break
        if not duplicate:
            out.append(segment)
    return out


def is_low_confidence_hallucination(segment, text: str) -> bool:
    if len(text) <= 1:
        return True
    avg_logprob = float(getattr(segment, "avg_logprob", 0.0) or 0.0)
    no_speech_prob = float(getattr(segment, "no_speech_prob", 0.0) or 0.0)
    if no_speech_prob > 0.75 and avg_logprob < -0.8:
        return True
    if len(text) > 30 and avg_logprob < -1.1:
        return True
    return False


def extract_audio_chunk(video_path: Path, output_path: Path, start: float, duration: float) -> None:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("FFmpeg is required for chunked STT.")
    cmd = [
        ffmpeg,
        "-y",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(video_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    process = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if process.returncode != 0:
        raise RuntimeError(process.stderr[-2000:])


def probe_duration(video_path: Path) -> float | None:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        return None
    process = subprocess.run([ffmpeg, "-i", str(video_path)], capture_output=True, text=True, check=False)
    match = re.search(r"Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)", process.stderr)
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def cleanup_stt_text(text: str) -> str:
    cleaned = re.sub(r"\s+", "", text)
    if not cleaned:
        return ""
    if is_non_chinese_background_text(cleaned):
        return ""
    if is_repeated_noise(cleaned):
        return ""
    return cleaned


def is_non_chinese_background_text(text: str) -> bool:
    latin = len(re.findall(r"[A-Za-z]", text))
    han = len(re.findall(r"[\u3400-\u9fff]", text))
    if latin >= 6 and han == 0:
        return True
    compact = text.lower().replace("'", "")
    music_fragments = [
        "ikeepon", "iwalkit", "bringiton", "fightingfor", "dontlookback", "causeineverlose",
    ]
    return any(fragment in compact for fragment in music_fragments)


def is_repeated_noise(text: str) -> bool:
    stripped = re.sub(r"[。！？!?，,、\s]", "", text)
    if len(stripped) >= 4 and len(set(stripped)) == 1:
        return True
    if stripped in {"嗯嗯嗯", "啊啊啊", "不不不不"}:
        return True
    if is_repeated_phrase(stripped):
        return True
    return False


def is_repeated_phrase(text: str) -> bool:
    if len(text) < 8:
        return False
    for size in range(2, min(7, len(text) // 2 + 1)):
        tokens = [text[index:index + size] for index in range(0, len(text), size)]
        if len(tokens) >= 4 and len(set(tokens[:-1])) == 1:
            return True
    return False


def dedupe_nearby_repetitions(segments: list[TimedSegment], window_seconds: float = 18.0) -> list[TimedSegment]:
    out: list[TimedSegment] = []
    recent: list[TimedSegment] = []
    for segment in segments:
        text_key = re.sub(r"[。！？!?，,、\s]", "", segment.text)
        recent = [item for item in recent if segment.start - item.start <= window_seconds]
        if len(text_key) > 4 and any(re.sub(r"[。！？!?，,、\s]", "", item.text) == text_key for item in recent):
            continue
        out.append(segment)
        recent.append(segment)
    return out


def remove_short_repetition_runs(segments: list[TimedSegment]) -> list[TimedSegment]:
    out: list[TimedSegment] = []
    index = 0
    while index < len(segments):
        segment = segments[index]
        key = re.sub(r"[。！？!?，,、\s]", "", segment.text)
        run = [segment]
        cursor = index + 1
        while cursor < len(segments):
            next_segment = segments[cursor]
            next_key = re.sub(r"[。！？!?，,、\s]", "", next_segment.text)
            gap = next_segment.start - run[-1].end
            if next_key != key or gap > 2.5:
                break
            run.append(next_segment)
            cursor += 1

        if not (2 <= len(key) <= 4 and len(run) >= 3):
            out.extend(run)
        index = cursor
    return out


def remove_music_and_noise_segments(segments: list[TimedSegment]) -> list[TimedSegment]:
    out: list[TimedSegment] = []
    for segment in segments:
        text = segment.text.strip()
        if is_non_chinese_background_text(text):
            continue
        if is_likely_music_hallucination(text):
            continue
        out.append(segment)
    return out


def is_likely_music_hallucination(text: str) -> bool:
    stripped = re.sub(r"[。！？!?，,、\s]", "", text)
    noise_terms = {
        "細節", "细节", "塵", "尘", "懸崖", "悬崖", "撥出", "拨出",
    }
    hits = sum(1 for term in noise_terms if term in stripped)
    return hits >= 2 and not any(term in stripped for term in ("你", "我", "他", "她", "夏", "谢", "阿"))


def split_caption_text(text: str, max_chars: int = 22) -> list[str]:
    cleaned = re.sub(r"\s+", "", text)
    if not cleaned:
        return []
    pieces = [piece for piece in re.split(r"(?<=[。！？!?，,、])", cleaned) if piece]
    if not pieces:
        pieces = [cleaned]
    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + len(piece) > max_chars:
            chunks.extend(split_long_caption(current, max_chars))
            current = piece
        else:
            current += piece
    if current:
        chunks.extend(split_long_caption(current, max_chars))
    return [chunk.strip() for chunk in chunks if chunk.strip()]


def split_long_caption(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    return [text[index:index + max_chars] for index in range(0, len(text), max_chars)]


def seconds_to_srt(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"



