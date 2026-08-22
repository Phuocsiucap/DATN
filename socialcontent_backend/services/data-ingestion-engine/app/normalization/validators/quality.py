def score_quality(normalized: dict) -> tuple[int, list[str], list[str]]:
    score = 0
    missing: list[str] = []
    warnings: list[str] = []
    if normalized.get("title"):
        score += 15
    else:
        missing.append("title")
    if normalized.get("content") or normalized.get("transcript"):
        score += 25
    else:
        missing.append("content_or_transcript")
    if normalized.get("source_url"):
        score += 10
    if normalized.get("published_at"):
        score += 10
    else:
        warnings.append("missing_published_at")
    if normalized.get("author"):
        score += 5
    if normalized.get("media"):
        score += 10
    if len(normalized.get("content") or normalized.get("transcript") or "") >= 60:
        score += 15
    else:
        warnings.append("short_content")
    if normalized.get("source_external_id") and normalized.get("language"):
        score += 10
    return min(score, 100), missing, warnings


def status_from_score(score: int) -> str:
    if score >= 80:
        return "READY"
    if score >= 60:
        return "USABLE_WITH_WARNING"
    return "NEEDS_REVIEW"
