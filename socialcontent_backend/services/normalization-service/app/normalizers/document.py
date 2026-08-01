import hashlib
from datetime import datetime, timezone

from app.cleaners.text import clean_text, normalize_title
from app.validators.quality import score_quality, status_from_score


def normalize_raw_document(raw_document: dict) -> dict:
    raw = raw_document.get("raw", {})
    json_data = raw.get("json") or {}
    title = clean_text(json_data.get("title") or json_data.get("video_title") or json_data.get("article_name"))
    content = clean_text(raw.get("text") or json_data.get("text") or json_data.get("description"))
    normalized = {
        "title": title,
        "normalized_title": normalize_title(title),
        "description": clean_text(json_data.get("description")),
        "author": clean_text(json_data.get("author")),
        "published_at": json_data.get("published_at"),
        "language": json_data.get("language") or "vi",
        "content": content,
        "transcript": clean_text(json_data.get("transcript")),
        "media": raw_document.get("media") or [],
        "source_url": raw_document.get("source_url") or json_data.get("url"),
        "source_external_id": raw_document.get("source_external_id"),
        "content_type": raw_document.get("content_type", "VIDEO"),
        "duration_seconds": json_data.get("duration_seconds"),
        "thumbnail_url": json_data.get("thumbnail_url"),
        "embed_url": json_data.get("embed_url"),
        "review_count": json_data.get("review_count"),
        "danmaku_count": json_data.get("danmaku_count"),
        "metadata_only": bool(json_data.get("metadata_only")),
        "aid": json_data.get("aid"),
        "bvid": json_data.get("bvid"),
        "cid": json_data.get("cid"),
        "season_id": json_data.get("season_id"),
        "season_title": clean_text(json_data.get("season_title")),
        "series_title": clean_text(json_data.get("series_title")),
        "series_source": json_data.get("series_source"),
        "episode_count": json_data.get("episode_count"),
        "episodes": json_data.get("episodes") if isinstance(json_data.get("episodes"), list) else [],
        "related": json_data.get("related") if isinstance(json_data.get("related"), list) else [],
    }
    body_for_hash = " ".join([normalized["normalized_title"], normalized["content"], normalized["transcript"]])
    normalized["content_hash"] = hashlib.sha256(body_for_hash.encode("utf-8")).hexdigest()
    normalized["title_hash"] = hashlib.sha256(normalized["normalized_title"].encode("utf-8")).hexdigest()
    normalized["transcript_hash"] = hashlib.sha256(normalized["transcript"].encode("utf-8")).hexdigest() if normalized["transcript"] else None
    score, missing, warnings = score_quality(normalized)
    return {
        "raw_document_id": str(raw_document.get("_id")),
        "job_id": raw_document.get("job_id"),
        "source_type": raw_document.get("source_type"),
        "normalizer_version": "1.0.0",
        "normalized": normalized,
        "quality": {"is_valid": score >= 60, "score": score, "status": status_from_score(score), "missing_fields": missing, "warnings": warnings},
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }
