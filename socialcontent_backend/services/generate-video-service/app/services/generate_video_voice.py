from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from common.core.config import get_settings
from common.core.llm import deepseek_chat_completion
from app.services.generate_video_constants import (
    AUDIO_DIR,
    DEFAULT_VOICE_ID,
    DEFAULT_VOICE_PROVIDER,
    EDGE_TTS_HOAIMY_PROVIDER,
    EDGE_TTS_NAMMINH_PROVIDER,
    EDGE_TTS_VOICES,
)
from app.services.generate_video_timeline import (
    edge_tts_pause_text,
    strip_voice_tags,
    sync_story_timeline,
    timeline_text_clips,
    upsert_timeline_audio_clip,
)


def enhance_emotion_and_generate_voice(
    story: dict[str, Any],
    voice_id: str | None = None,
    voice_speed: float = 1.0,
    voice_provider: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    sync_story_timeline(story)
    timeline = story.get("timeline") if isinstance(story.get("timeline"), dict) else {}
    text_clips = timeline.get("text") if isinstance(timeline.get("text"), list) else []
    if not text_clips:
        raise RuntimeError("Story has no timeline text clips to generate voice")
    for clip in text_clips:
        clip["text"] = strip_voice_tags(str(clip.get("text") or ""))
    selected_voice_provider = normalize_voice_provider(voice_provider)
    selected_voice_speed = clamp_voice_speed(voice_speed)
    selected_voice_id = EDGE_TTS_VOICES.get(selected_voice_provider) or voice_id or DEFAULT_VOICE_ID
    if selected_voice_provider == DEFAULT_VOICE_PROVIDER:
        tagged_lines = tag_with_deepseek(story, settings)
        for clip, tagged in zip(text_clips, tagged_lines):
            clip["text"] = strip_voice_tags(str(clip.get("text") or ""))
            clip["voice_text"] = tagged
    else:
        for clip in text_clips:
            clip["voice_text"] = edge_tts_pause_text(str(clip.get("voice_text") or clip.get("text") or ""))

    audio_filename = story_audio_filename(story)
    audio_path = AUDIO_DIR / audio_filename
    if selected_voice_provider in EDGE_TTS_VOICES:
        voice_text = build_edge_tts_voice_text(story)
        generate_edge_tts_voice(voice_text, selected_voice_id, audio_path)
    else:
        generate_elevenlabs_voice(story, settings, selected_voice_id, selected_voice_speed, audio_path)
        voice_text = build_voice_text(story)
    story.setdefault("audio", {})
    story["audio"]["voice"] = f"assets/audio/{audio_filename}"
    story["audio"]["voiceVolume"] = 1
    story["audio"]["voiceProvider"] = selected_voice_provider
    story["audio"]["voiceId"] = selected_voice_id
    if story["audio"].get("music"):
        story["audio"]["musicVolume"] = 0.08
    upsert_timeline_audio_clip(
        story,
        {
            "id": "voice-main",
            "type": "voice",
            "start": 0,
            "end": None,
            "src": f"assets/audio/{audio_filename}",
            "volume": 1,
        },
    )
    return {
        "story": story,
        "voice_provider": selected_voice_provider,
        "voice_id": selected_voice_id,
        "voice_speed": selected_voice_speed,
        "voice_text": voice_text,
        "audio_url": f"/api/v1/generate-video/media/assets/audio/{audio_filename}",
    }



def save_uploaded_audio(original_filename: str, content: bytes) -> str:
    suffix = Path(original_filename or "audio").suffix.lower()
    if suffix not in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm"}:
        raise RuntimeError("Unsupported audio file type")
    if not content:
        raise RuntimeError("Empty audio file")
    stem = Path(original_filename or "audio").stem
    safe_stem = re.sub(r"[^a-zA-Z0-9._-]+", "-", stem).strip("-") or "audio"
    filename = f"upload-{uuid.uuid4().hex[:10]}-{safe_stem}{suffix}"
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    output_path = AUDIO_DIR / filename
    output_path.write_bytes(content)
    return f"assets/audio/{filename}"



def save_uploaded_audio_base64(original_filename: str, content_base64: str) -> str:
    try:
        content = base64.b64decode(content_base64, validate=True)
    except Exception as error:
        raise RuntimeError("Invalid audio payload") from error
    return save_uploaded_audio(original_filename, content)



def story_audio_filename(story: dict[str, Any]) -> str:
    meta = story.get("meta") if isinstance(story.get("meta"), dict) else {}
    project_id = str(meta.get("project_id") or "").strip()
    if project_id:
        return f"voice-project-{project_id}.mp3"
    return "voice-elevenlabs.mp3"



def tag_with_deepseek(story: dict[str, Any], settings) -> list[str]:
    if not settings.deepseek_api_key:
        raise RuntimeError("Missing ACD_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY")

    lines = [strip_voice_tags(str(clip.get("text") or "")) for clip in timeline_text_clips(story)]
    result = deepseek_chat_completion(
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        model="deepseek-v4-flash",
        messages=[
            {"role": "system", "content": "You prepare cinematic Vietnamese scripts for ElevenLabs v3."},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": "Add ElevenLabs v3 emotion tags.",
                        "rules": [
                            "Keep Vietnamese text unchanged.",
                            "Return only JSON array of strings.",
                            "Use tags like [whispers], [gasp], [serious], [confident], [sighs], [frustrated].",
                        ],
                        "lines": lines,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        temperature=0.4,
        timeout=60,
    )
    tagged = result.parsed_json()
    if not isinstance(tagged, list) or len(tagged) != len(lines):
        raise RuntimeError(f"Unexpected DeepSeek response: {result.content}")
    return [str(item) for item in tagged]



def generate_elevenlabs_voice(story: dict[str, Any], settings, voice_id: str, voice_speed: float, out_path: Path) -> None:
    api_key = get_elevenlabs_api_key(settings)
    if not api_key:
        raise RuntimeError("Missing ELEVENLABS_API_KEY")

    payload = {
        "text": build_voice_text(story),
        "model_id": __import__("os").getenv("ELEVENLABS_MODEL_ID", "eleven_v3"),
        "language_code": __import__("os").getenv("ELEVENLABS_LANGUAGE_CODE", "vi"),
        "voice_settings": {
            "speed": voice_speed,
        },
    }
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format={__import__('os').getenv('ELEVENLABS_OUTPUT_FORMAT', 'mp3_44100_128')}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            audio = response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode("utf-8")) from error
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(audio)



def generate_edge_tts_voice(text: str, voice: str, out_path: Path) -> None:
    try:
        import edge_tts
    except ImportError as error:
        raise RuntimeError("Missing edge-tts package. Install requirements for generate-video-service again.") from error

    async def save_voice() -> None:
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate="+0%",
            pitch="-2Hz",
        )
        await communicate.save(str(out_path))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    asyncio.run(save_voice())



def get_elevenlabs_api_key(settings=None) -> str:
    if settings is None:
        try:
            from common.core.config import settings as app_settings

            settings = app_settings
        except Exception:
            settings = None
    return (getattr(settings, "elevenlabs_api_key", "") if settings else "") or __import__("os").getenv("ELEVENLABS_API_KEY", "")



def build_voice_text(story: dict[str, Any]) -> str:
    return "\n\n".join(
        strip_voice_tags(str(clip.get("voice_text") or clip.get("text") or ""))
        for clip in timeline_text_clips(story)
    )



def build_edge_tts_voice_text(story: dict[str, Any]) -> str:
    lines = [
        edge_tts_pause_text(str(clip.get("voice_text") or clip.get("text") or ""))
        for clip in timeline_text_clips(story)
    ]
    return "\n\n".join(line for line in lines if line)



def clamp_voice_speed(value: float) -> float:
    try:
        speed = float(value)
    except (TypeError, ValueError):
        speed = 1.0
    return max(0.7, min(1.2, speed))



def normalize_voice_provider(value: str | None) -> str:
    provider = str(value or DEFAULT_VOICE_PROVIDER).strip().lower()
    if provider in {"edge", "edge_tts", EDGE_TTS_NAMMINH_PROVIDER}:
        return EDGE_TTS_NAMMINH_PROVIDER
    if provider in {"hoaimy", "hoai_my", "edge_tts_hoai_my", EDGE_TTS_HOAIMY_PROVIDER}:
        return EDGE_TTS_HOAIMY_PROVIDER
    return DEFAULT_VOICE_PROVIDER
