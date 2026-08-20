from sqlalchemy.orm import Session

from common.db.models import ContentDuplicate, ContentItem


def find_or_mark_duplicate(db: Session, content: ContentItem) -> bool:
    existing = None
    match_type = None
    reason = None
    if content.canonical_url:
        existing = _visible_duplicate_query(db, content).filter(ContentItem.canonical_url == content.canonical_url).first()
        match_type = "EXACT_URL"
        reason = "Same canonical URL"
    if not existing and content.content_hash:
        existing = _visible_duplicate_query(db, content).filter(ContentItem.content_hash == content.content_hash).first()
        match_type = "CONTENT_HASH"
        reason = "Same content hash"
    if not existing and content.transcript_hash:
        existing = _visible_duplicate_query(db, content).filter(ContentItem.transcript_hash == content.transcript_hash).first()
        match_type = "TRANSCRIPT_SIMILARITY"
        reason = "Same transcript hash"
    if not existing:
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


def _visible_duplicate_query(db: Session, content: ContentItem):
    query = db.query(ContentItem).filter(ContentItem.id != content.id)
    if content.content_scope == "GLOBAL":
        return query.filter(ContentItem.content_scope == "GLOBAL")
    return query.filter(
        (ContentItem.content_scope == "GLOBAL")
        | ((ContentItem.content_scope == "PRIVATE") & (ContentItem.owner_user_id == content.owner_user_id))
    )
