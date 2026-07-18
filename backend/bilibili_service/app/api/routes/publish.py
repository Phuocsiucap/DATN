import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from backend.bilibili_service.app.api.deps import CurrentUser, get_current_user
from backend.bilibili_service.app.integrations.bilibili.deepseek_client import deepseek_chat_json
from backend.bilibili_service.app.schemas.api import JobRecord, TikTokMetadataResponse
from backend.bilibili_service.app.services.jobs import get_existing_job
from backend.bilibili_service.app.services.runtime import db, settings


router = APIRouter()


@router.post("/{job_id}/tiktok-metadata", response_model=TikTokMetadataResponse)
def generate_tiktok_metadata(job_id: int, current_user: CurrentUser = Depends(get_current_user)) -> TikTokMetadataResponse:
    job = get_existing_job(job_id, current_user.id)
    existing = job.artifacts.get("tiktok_metadata")
    if isinstance(existing, dict) and existing.get("title") and existing.get("description"):
        return TikTokMetadataResponse(**existing)

    context = load_translation_context(job)
    payload = {
        "source": {
            "input_text_vi": job.input_text,
            "crawler_title_zh": job.artifacts.get("crawler_title") or job.artifacts.get("raw_title") or "",
            "origin_url": job.artifacts.get("origin_video_url") or job.source_url or "",
            "keyword_plan": job.artifacts.get("keyword_plan") or {},
            "playlist": job.artifacts.get("playlist") or {},
            "segments": job.artifacts.get("segments") or [],
            "subtitle_context": context,
        }
    }
    data = deepseek_chat_json(
        model=settings.deepseek_subtitle_model,
        system_prompt=(
            "You generate Vietnamese TikTok publishing metadata for repackaged Chinese short-drama/video clips. "
            "Return ONLY JSON: {\"title\":\"...\",\"description\":\"...\",\"hashtags\":[\"...\"],\"hook\":\"...\",\"source_summary\":\"...\"}. "
            "Use Vietnamese. Keep title under 80 characters, description under 220 characters. "
            "Hashtags must be 5-10 TikTok-ready tags, each starts with #, no spaces. "
            "Base the content on crawled title, keyword intent, playlist/segment data, and subtitle context. "
            "Do not mention Bilibili, crawling, copyright, or internal tools."
        ),
        user_payload=payload,
        max_tokens=900,
        temperature=0.2,
    )
    metadata = TikTokMetadataResponse(
        title=str(data.get("title") or "").strip(),
        description=str(data.get("description") or "").strip(),
        hashtags=[normalize_hashtag(item) for item in data.get("hashtags", []) if str(item).strip()][:10],
        hook=str(data.get("hook") or "").strip(),
        source_summary=str(data.get("source_summary") or "").strip(),
    )
    if not metadata.title or not metadata.description or not metadata.hashtags:
        raise HTTPException(status_code=422, detail="DeepSeek returned incomplete TikTok metadata.")
    db.update_job(job_id, artifacts={"tiktok_metadata": metadata.model_dump()})
    return metadata


def load_translation_context(job: JobRecord) -> dict:
    path_value = job.artifacts.get("translation_context_path")
    if not isinstance(path_value, str):
        return {}
    path = Path(path_value)
    if not path.exists() or not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def normalize_hashtag(value: object) -> str:
    text = str(value).strip()
    if not text:
        return ""
    text = text.replace(" ", "")
    return text if text.startswith("#") else f"#{text}"
