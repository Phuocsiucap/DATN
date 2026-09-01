from sqlalchemy.orm import Session

from common.db.models import ContentItem


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


def _visible_duplicate_query(db: Session, scope: str, owner_user_id: str | None):
    query = db.query(ContentItem)
    if scope == "GLOBAL":
        return query.filter(ContentItem.content_scope == "GLOBAL")
    return query.filter(
        (ContentItem.content_scope == "GLOBAL")
        | ((ContentItem.content_scope == "PRIVATE") & (ContentItem.owner_user_id == owner_user_id))
    )

