from __future__ import annotations

import json
import mimetypes
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from common.core.config import get_settings
from app.services.generate_video_constants import PUBLIC_DIR
from app.services.generate_video_timeline import (
    _prevent_subtitle_overlap,
    get_words,
    normalize_story_for_project,
    round_to_frame,
    strip_voice_tags,
    sync_story_timeline,
    timeline_text_clips,
    word_similarity,
)


def fit_frames_with_whisper(story: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    api_key = settings.openai_api_key
    if not api_key:
        raise RuntimeError("Missing OPENAI_API_KEY")

    sync_story_timeline(story)
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    timeline_audio = timeline.get("audio") if isinstance(timeline.get("audio"), list) else []
    voice_clip = next((clip for clip in timeline_audio if isinstance(clip, dict) and str(clip.get("type") or "").lower() == "voice" and clip.get("src")), None)
    audio_rel = (voice_clip or {}).get("src") or story.get("audio", {}).get("voice")
    if not audio_rel:
        raise RuntimeError("Voice audio has not been generated for this story")
    audio_path = PUBLIC_DIR / audio_rel
    if not audio_path.exists():
        raise RuntimeError(f"Voice audio not found: {audio_rel}")

    text_clips = timeline_text_clips(story)
    if not text_clips:
        raise RuntimeError("Story has no timeline text clips to fit")

    scene_texts = [strip_voice_tags(str(clip.get("text") or "")) for clip in text_clips]
    transcription = transcribe_whisper(api_key, audio_path)
    segments = transcription.get("segments") if isinstance(transcription.get("segments"), list) else []
    words = transcription.get("words") if isinstance(transcription.get("words"), list) else []
    scene_ranges = map_scenes_to_segments(scene_texts, segments)
    fallback_ranges = map_scenes_to_word_ranges(scene_texts, words, segments)
    transcript_text = str(transcription.get("text") or "")
    transcript_score = word_similarity("\n".join(scene_texts), transcript_text)
    matched_scene_count = sum(1 for item in scene_ranges if item.get("start") is not None)
    if len(scene_texts) > 1 and (matched_scene_count <= 1 or transcript_score < 0.35):
        debug = {
            "expected_text": "\n".join(scene_texts),
            "transcription": transcription,
            "sceneRanges": scene_ranges,
            "fallbackRanges": fallback_ranges,
            "matchQuality": {
                "matched_scene_count": matched_scene_count,
                "scene_count": len(scene_texts),
                "transcript_score": transcript_score,
            },
            "error": "Voice audio does not match timeline text. Regenerate voice from the current timeline before fitting frames.",
        }
        raise RuntimeError(debug["error"])
    fps = int(story["video"]["fps"])
    voice_offset = _voice_timeline_offset(story, audio_rel)
    audio_end = float(transcription.get("duration") or (segments[-1]["end"] if segments else 0))
    timeline_audio_end = voice_offset + audio_end
    aligned_ranges: list[dict[str, Any]] = []
    for index in range(len(text_clips)):
        scene_range = scene_ranges[index] if index < len(scene_ranges) else {}
        fallback_range = fallback_ranges[index] if index < len(fallback_ranges) else {}
        if scene_range.get("start") is not None and scene_range.get("end") is not None:
            aligned_ranges.append({**scene_range, "source": "segment"})
        elif fallback_range.get("start") is not None and fallback_range.get("end") is not None:
            aligned_ranges.append({**fallback_range, "source": "word"})
        else:
            aligned_ranges.append({"start": None, "end": None, "source": "missing"})

    for index, clip in enumerate(text_clips):
        current = aligned_ranges[index]
        next_range = next(
            (
                item
                for item in aligned_ranges[index + 1 :]
                if item.get("start") is not None and item.get("end") is not None
            ),
            None,
        )
        if current.get("start") is None or current.get("end") is None:
            continue
        voice_start = float(current["start"])
        current_end = float(current.get("end") or voice_start)
        if next_range and next_range.get("start") is not None and float(next_range["start"]) > voice_start:
            voice_end = float(next_range["start"])
        else:
            voice_end = current_end or audio_end
        if audio_end:
            voice_end = min(audio_end, voice_end)
        voice_end = max(voice_start + 1 / max(1, fps), voice_end)
        timeline_start = voice_offset + voice_start
        timeline_end = voice_offset + voice_end
        clip["start"] = round_to_frame(timeline_start, fps)
        clip["end"] = round_to_frame(timeline_end, fps)
        clip["duration"] = max(1 / fps, round_to_frame(clip["end"] - clip["start"], fps))
        clip["timing"] = {
            "start": round_to_frame(timeline_start, fps),
            "end": round_to_frame(timeline_end, fps),
            "voice_start": round_to_frame(voice_start, fps),
            "voice_end": round_to_frame(voice_end, fps),
        }

    story["timeline"]["text"] = prevent_timeline_text_overlap(text_clips, fps)
    story["timeline"]["video"] = fit_video_clips_to_text(story["timeline"].get("video"), story["timeline"]["text"], fps)
    if voice_clip is not None:
        voice_clip["end"] = round_to_frame(timeline_audio_end, fps)
        story["timeline"]["audio"] = normalize_audio_clips(timeline_audio, fps)
    sync_story_timeline(story)
    debug = {
        "expected_text": "\n".join(scene_texts),
        "transcription": transcription,
        "sceneRanges": scene_ranges,
        "fallbackRanges": fallback_ranges,
        "alignedRanges": aligned_ranges,
        "voiceOffset": voice_offset,
        "timelineAudioEnd": timeline_audio_end,
    }
    return {"story": story, "debug": debug}



def _voice_timeline_offset(story: dict[str, Any], voice_path: str) -> float:
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    timeline_audio = timeline.get("audio") if isinstance(timeline.get("audio"), list) else []
    normalized_voice_path = str(voice_path or "").replace("\\", "/").lstrip("/")
    voice_timeline_clips = []
    for clip in timeline_audio:
        if not isinstance(clip, dict) or str(clip.get("type") or "").lower() != "voice":
            continue
        src = str(clip.get("src") or "").replace("\\", "/").lstrip("/")
        if normalized_voice_path and src and (src == normalized_voice_path or src.endswith(normalized_voice_path) or normalized_voice_path.endswith(src)):
            voice_timeline_clips.append(clip)
        elif not normalized_voice_path:
            voice_timeline_clips.append(clip)
    if voice_timeline_clips:
        return max(0.0, min(float(clip.get("start") or 0.0) for clip in voice_timeline_clips))

    audio = story.get("audio") if isinstance(story.get("audio"), dict) else {}
    tracks = audio.get("tracks") if isinstance(audio.get("tracks"), list) else []
    voice_tracks = []
    for track in tracks:
        if not isinstance(track, dict) or str(track.get("type") or "").lower() != "voice":
            continue
        src = str(track.get("src") or "").replace("\\", "/").lstrip("/")
        if normalized_voice_path and src and (src == normalized_voice_path or src.endswith(normalized_voice_path) or normalized_voice_path.endswith(src)):
            voice_tracks.append(track)
        elif not normalized_voice_path:
            voice_tracks.append(track)
    if voice_tracks:
        return max(0.0, min(float(track.get("start") or 0.0) for track in voice_tracks))
    return max(0.0, float(audio.get("voiceStart") or audio.get("voice_start") or 0.0))



def transcribe_whisper(api_key: str, audio_path: Path, prompt: str | None = None) -> dict[str, Any]:
    fields = [
        ("model", "whisper-1"),
        ("language", "vi"),
        ("response_format", "verbose_json"),
        ("timestamp_granularities[]", "segment"),
        ("timestamp_granularities[]", "word"),
    ]
    if prompt:
        fields.append(("prompt", prompt))

    body, boundary = encode_multipart(
        fields=fields,
        files={"file": audio_path},
    )
    request = urllib.request.Request(
        "https://api.openai.com/v1/audio/transcriptions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode("utf-8")) from error



def encode_multipart(fields: dict[str, str] | list[tuple[str, str]], files: dict[str, Path]) -> tuple[bytes, str]:
    boundary = f"----generate-video-{uuid.uuid4().hex}"
    body = bytearray()
    field_items = fields.items() if isinstance(fields, dict) else fields
    for name, value in field_items:
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")
    for name, path in files.items():
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'.encode())
        body.extend(f"Content-Type: {content_type}\r\n\r\n".encode())
        body.extend(path.read_bytes())
        body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())
    return bytes(body), boundary



def map_scenes_to_segments(scene_texts: list[str], segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    remaining = list(segments)
    ranges = []
    for scene_text in scene_texts:
        best_score = 0.0
        best_end_index = -1
        combined = ""
        for index in range(min(len(remaining), 4)):
            combined = f"{combined} {remaining[index].get('text', '')}".strip()
            score = word_similarity(scene_text, combined)
            if score >= best_score:
                best_score = score
                best_end_index = index
        if best_end_index == -1 or best_score < 0.25:
            ranges.append({"start": None, "end": None, "score": best_score, "text": ""})
            continue
        matched = remaining[: best_end_index + 1]
        del remaining[: best_end_index + 1]
        ranges.append(
            {
                "start": float(matched[0]["start"]),
                "end": float(matched[-1]["end"]),
                "score": best_score,
                "text": " ".join(segment.get("text", "") for segment in matched).strip(),
            }
        )
    return ranges



def map_scenes_to_word_ranges(
    scene_texts: list[str],
    words: list[dict[str, Any]],
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not words:
        return map_scenes_to_segment_ranges(scene_texts, segments)

    total_scene_words = sum(len(get_words(text)) for text in scene_texts)
    if total_scene_words and len(words) < total_scene_words * 0.6:
        return [{"start": None, "end": None, "wordStartIndex": None, "wordEndIndex": None} for _ in scene_texts]

    ranges = []
    cursor = 0
    for scene_text in scene_texts:
        length = len(get_words(scene_text))
        start_index = cursor
        end_index = cursor + length - 1
        timed_words = [
            word
            for word in words[start_index : end_index + 1]
            if word.get("start") is not None and word.get("end") is not None
        ]
        ranges.append(
            {
                "start": timed_words[0].get("start") if timed_words else None,
                "end": timed_words[-1].get("end") if timed_words else None,
                "wordStartIndex": start_index,
                "wordEndIndex": end_index,
            }
        )
        cursor += length
    return ranges



def map_scenes_to_segment_ranges(scene_texts: list[str], segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    total_words = sum(len(get_words(text)) for text in scene_texts)
    audio_end = float(segments[-1].get("end") or 0) if segments else 0.0
    cursor = 0
    ranges = []
    for scene_text in scene_texts:
        word_count = len(get_words(scene_text))
        start = (cursor / total_words) * audio_end if total_words > 0 else None
        cursor += word_count
        end = (cursor / total_words) * audio_end if total_words > 0 else None
        ranges.append({"start": start, "end": end})
    return ranges
