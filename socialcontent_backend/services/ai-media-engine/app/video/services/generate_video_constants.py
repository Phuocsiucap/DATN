from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[5]
RENDER_WORKSPACE_ROOT = PROJECT_ROOT / "data_demo" / "video_gen_demo"
PUBLIC_DIR = RENDER_WORKSPACE_ROOT / "public"
AUDIO_DIR = PUBLIC_DIR / "assets" / "audio"
VIDEO_ASSET_DIR = PUBLIC_DIR / "assets" / "videos"
VIDEO_OUT_DIR = RENDER_WORKSPACE_ROOT / "out"

DEFAULT_IMAGES = [
    "assets/images/001-signal-room.png",
    "assets/images/002-alien-tower.png",
    "assets/images/003-final-light.png",
]
DEFAULT_EFFECTS = ["slow-zoom", "pan-right", "pan-left", "push-in"]
DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"
DEFAULT_VOICE_PROVIDER = "elevenlabs"
EDGE_TTS_NAMMINH_PROVIDER = "edge_tts_namminh"
EDGE_TTS_HOAIMY_PROVIDER = "edge_tts_hoaimy"
EDGE_TTS_NAMMINH_VOICE = "vi-VN-NamMinhNeural"
EDGE_TTS_HOAIMY_VOICE = "vi-VN-HoaiMyNeural"
EDGE_TTS_VOICES = {
    EDGE_TTS_NAMMINH_PROVIDER: EDGE_TTS_NAMMINH_VOICE,
    EDGE_TTS_HOAIMY_PROVIDER: EDGE_TTS_HOAIMY_VOICE,
}
