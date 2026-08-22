from sqlalchemy.orm import Session

from common.db.models import ContentDuplicate, ContentItem


def find_duplicate_content(
    db: Session,
    scope: str,
    owner_user_id: str | None,
    canonical_url: str | None,
    content_hash: str | None,
    transcript_hash: str | None,
) -> tuple[ContentItem | None, str | None, str | None]:
    if canonical_url:
        existing = _visible_duplicate_query(db, scope, owner_user_id).filter(ContentItem.canonical_url == canonical_url).first()
        if existing:
            return existing, "EXACT_URL", "Same canonical URL"
    if content_hash:
        existing = _visible_duplicate_query(db, scope, owner_user_id).filter(ContentItem.content_hash == content_hash).first()
        if existing:
            return existing, "CONTENT_HASH", "Same content hash"
    if transcript_hash:
        existing = _visible_duplicate_query(db, scope, owner_user_id).filter(ContentItem.transcript_hash == transcript_hash).first()
        if existing:
            return existing, "TRANSCRIPT_SIMILARITY", "Same transcript hash"
    return None, None, None


def find_or_mark_duplicate(db: Session, content: ContentItem) -> bool:
    existing, match_type, reason = find_duplicate_content(
        db,
        scope=content.content_scope,
        owner_user_id=content.owner_user_id,
        canonical_url=content.canonical_url,
        content_hash=content.content_hash,
        transcript_hash=content.transcript_hash,
    )
    if not existing or existing.id == content.id:
        return False

    db.add(
        ContentDuplicate(
            primary_content_id=existing.id,
            duplicate_content_id=content.id,
            match_type=match_type or "CONTENT_HASH",
            similarity_score=100,
            decision="DUPLICATE",
            decision_reason=reason or "Same content hash",
        )
    )
    content.status = "DUPLICATE"
    return True


def _visible_duplicate_query(db: Session, scope: str, owner_user_id: str | None):
    query = db.query(ContentItem)
    if scope == "GLOBAL":
        return query.filter(ContentItem.content_scope == "GLOBAL")
    return query.filter(
        (ContentItem.content_scope == "GLOBAL")
        | ((ContentItem.content_scope == "PRIVATE") & (ContentItem.owner_user_id == owner_user_id))
    )

