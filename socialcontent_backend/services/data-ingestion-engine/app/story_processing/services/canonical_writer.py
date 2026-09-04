import hashlib
import html
import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from common.db.crawl_status import add_crawl_log, finalize_job_if_ready
from common.db.idempotency import claim_event
from common.db.models import ContentItem, CrawlJob, CrawlJobContent, Story, KafkaTask
from app.story_processing.deduplication.rules import find_duplicate_content
from app.story_processing.grouping.rules import extract_episode_number, grouping_key, normalize_story_text
from app.story_processing.ordering.episodes import update_story_completion
from app.story_processing.producers.story_events import StoryEventProducer
from app.story_processing.repositories.processed_documents import ProcessedDocumentRepository

logger = logging.getLogger(__name__)


def _clean_text(val: str | None) -> str | None:
    if not val:
        return val
    return html.unescape(val).strip()


class CanonicalWriter:
    consumer_name = "story-processing-service"

    def __init__(
        self,
        repository: ProcessedDocumentRepository | None = None,
        producer: StoryEventProducer | None = None,
    ) -> None:
        self.repository = repository or ProcessedDocumentRepository()
        self.producer = producer or StoryEventProducer()

    def handle_content_normalized(self, db: Session, message: dict) -> None:
        event_id = message.get("event_id")
        if event_id and not claim_event(db, event_id, self.consumer_name):
            logger.info(f"[story-processing-service] Event {event_id} already processed, skipping.")
            return

        payload = message.get("payload", {})
        processed_document_id = payload.get("processed_document_id")
        if not processed_document_id:
            return
        logger.info(f"[story-processing-service] Processing canonical save for processed_doc {processed_document_id}")

        doc = self.repository.get(processed_document_id)
        if not doc:
            raise ValueError(f"Processed document not found: {processed_document_id}")
        job = db.get(CrawlJob, message.get("job_id")) if message.get("job_id") else None
        if job and job.status == "CANCELLED":
            add_crawl_log(
                db,
                job_id=job.id,
                stage="GROUPING",
                level="INFO",
                message="Canonical save skipped because job was cancelled",
                metadata={"processed_document_id": processed_document_id},
            )
            db.commit()
            return

        try:
            content, story, is_duplicate, finalized, job_status = self._save_canonical(db, doc, processed_document_id, message.get("job_id"), message.get("task_id"))
            db.commit()
        except Exception as exc:
            db.rollback()
            job = db.get(CrawlJob, message.get("job_id")) if message.get("job_id") else None
            if job:
                job.total_failed += 1
                db.add(
                    KafkaTask(
                        reference_id=job.id,
                        reference_type="crawl_job",
                        task_type="NORMALIZE",
                        status="FAILED",
                        started_at=datetime.utcnow(),
                        completed_at=datetime.utcnow(),
                        error_message=str(exc)[-2000:],
                        payload_jsonb={"input_reference": processed_document_id},
                    )
                )
                add_crawl_log(
                    db,
                    job_id=job.id,
                    stage="CANONICAL",
                    level="ERROR",
                    message="Canonical content save failed",
                    metadata={"processed_document_id": processed_document_id, "error": str(exc)},
                )
                finalized = finalize_job_if_ready(db, job)
                db.commit()
                if finalized:
                    self.producer.job_completed(job_id=job.id, status=job.status)
            return
        else:
            if story:
                self.producer.story_grouped(job_id=message.get("job_id"), story_id=str(story.id), content_id=str(content.id))
            self.producer.canonical_saved(job_id=message.get("job_id"), content_id=str(content.id), duplicate=is_duplicate)
            if finalized:
                self.producer.job_completed(job_id=message.get("job_id"), status=job_status or "SUCCEEDED")

    def _save_canonical(self, db: Session, doc: dict, processed_document_id: str, job_id: str | None, task_id: str | None):
        normalized = doc["normalized"]
        quality = doc["quality"]
        source_type = doc.get("source_type") or "BILIBILI"
        source_external_id = normalized.get("source_external_id") or normalized.get("source_url") or processed_document_id
        self._lock_source_identity(db, source_type, str(source_external_id))
        job = db.get(CrawlJob, job_id) if job_id else None

        # In JSONB model, we check if ContentItem already exists with this source_external_id
        # We can use JSONB containment or just fallback to content duplicates for now
        # Actually it's easier to find existing content that matches content_hash
        scope = job.content_scope if job and hasattr(job, "content_scope") else "GLOBAL"
        owner = job.requested_by if job and scope == "PRIVATE" else None
        created_by = job.created_by_type if job and hasattr(job, "created_by_type") else "SYSTEM"

        canonical_url = normalized.get("source_url")
        content_hash = normalized.get("content_hash")
        transcript_hash = normalized.get("transcript_hash")

        existing_content, match_type, reason = find_duplicate_content(
            db=db,
            scope=scope,
            owner_user_id=owner,
            canonical_url=canonical_url,
            content_hash=content_hash,
            transcript_hash=transcript_hash,
        )
        if existing_content:
            return self._handle_content_duplicate(
                db=db,
                existing_content=existing_content,
                match_type=match_type or "CONTENT_HASH",
                reason=reason or "Same content hash",
                source_type=source_type,
                source_external_id=str(source_external_id),
                normalized=normalized,
                quality=quality,
                processed_document_id=processed_document_id,
                job_id=job_id,
            )

        sources_jsonb = [{
            "source_type": source_type,
            "source_external_id": str(source_external_id),
            "source_url": normalized.get("source_url"),
            "processed_document_id": processed_document_id,
            "source_title": normalized.get("title"),
            "source_author": normalized.get("author"),
            "source_published_at": normalized.get("published_at"),
            "is_primary": True,
            "metadata_json": self._source_metadata(normalized, processed_document_id),
        }]

        media_jsonb = self._extract_media(normalized)

        content = ContentItem(
            content_type=normalized.get("content_type", "VIDEO"),
            canonical_title=_clean_text(normalized.get("title")) or "Untitled",
            normalized_title=_clean_text(normalized.get("normalized_title")),
            summary=_clean_text(normalized.get("description")),
            language=normalized.get("language") or "vi",
            content_scope=scope,
            owner_user_id=owner,
            crawl_job_id=job.id if job else None,
            created_by_type=created_by,
            status=quality.get("status", "NEEDS_REVIEW"),
            published_at=self._parse_datetime(normalized.get("published_at")),
            duration_seconds=self._as_int(normalized.get("duration_seconds")),
            canonical_url=canonical_url,
            content_hash=content_hash,
            transcript_hash=transcript_hash,
            quality_score=quality.get("score", 0),
            mongo_normalized_id=processed_document_id,
            sources_jsonb=sources_jsonb,
            media_jsonb=media_jsonb,
        )
        db.add(content)
        db.flush()
        self._link_content_to_job(
            db,
            job=job,
            content=content,
            is_duplicate=False,
            match_type="NEW_CANONICAL",
            source_type=source_type,
            source_external_id=str(source_external_id),
            processed_document_id=processed_document_id,
            metadata={"quality_score": quality.get("score", 0)},
        )

        story = None
        if self._should_group_as_story(source_type, normalized):
            story = self._find_or_create_story(db, content, normalized, source_type)
            self._apply_episode(content, story, normalized)
            db.flush()
            db.refresh(story)
            update_story_completion(story)

        job = db.get(CrawlJob, job_id) if job_id else None
        if job:
            job.current_stage = "GROUPING" if story else "CANONICAL"
            job.progress_percent = max(float(job.progress_percent), 85)
            add_crawl_log(
                db,
                job_id=job.id,
                stage=job.current_stage,
                message="Canonical content saved",
                metadata={
                    "processed_document_id": processed_document_id,
                    "content_id": str(content.id),
                    "duplicate": False,
                    "quality_score": quality.get("score", 0),
                    **({"story_id": str(story.id)} if story else {}),
                },
            )

        task = db.get(KafkaTask, task_id) if task_id else None
        if task:
            task.status = "COMPLETED"
            task.completed_at = datetime.utcnow()
            task.result_jsonb = {"output_reference": str(content.id)}
            db.add(task)
        else:
            db.add(
                KafkaTask(
                    reference_id=job.id if job else None,
                    reference_type="crawl_job",
                    task_type="NORMALIZE",
                    status="COMPLETED",
                    started_at=datetime.utcnow(),
                    completed_at=datetime.utcnow(),
                    payload_jsonb={"input_reference": processed_document_id},
                    result_jsonb={"output_reference": str(content.id)},
                )
            )
        db.flush()
        finalized = finalize_job_if_ready(db, job)
        return content, story, False, finalized, job.status if job else None

    def _handle_content_duplicate(
        self,
        db: Session,
        existing_content: ContentItem,
        match_type: str,
        reason: str,
        source_type: str,
        source_external_id: str,
        normalized: dict,
        quality: dict,
        processed_document_id: str,
        job_id: str | None,
    ):
        new_source = {
            "source_type": source_type,
            "source_external_id": str(source_external_id),
            "source_url": normalized.get("source_url"),
            "processed_document_id": processed_document_id,
            "source_title": normalized.get("title"),
            "source_author": normalized.get("author"),
            "source_published_at": normalized.get("published_at"),
            "is_primary": False,
            "metadata_json": {
                **self._source_metadata(normalized, processed_document_id),
                "content_duplicate": True,
                "match_type": match_type,
                "decision_reason": reason,
            },
        }

        sources = existing_content.sources_jsonb if isinstance(existing_content.sources_jsonb, list) else []
        sources.append(new_source)
        existing_content.sources_jsonb = sources

        media = existing_content.media_jsonb if isinstance(existing_content.media_jsonb, list) else []
        new_media = self._extract_media(normalized)

        existing_urls = {m.get("source_url") for m in media if isinstance(m, dict)}
        for m in new_media:
            if m.get("source_url") not in existing_urls:
                media.append(m)
        existing_content.media_jsonb = media
        existing_content.duplicate_count = (existing_content.duplicate_count or 0) + 1
        db.add(existing_content)

        story = None
        if self._should_group_as_story(source_type, normalized):
            story = self._find_existing_story(db, existing_content) or self._find_or_create_story(db, existing_content, normalized, source_type)
            self._apply_episode(existing_content, story, normalized)
            db.flush()
            if story:
                db.refresh(story)
                update_story_completion(story)

        job = db.get(CrawlJob, job_id) if job_id else None
        if job:
            self._link_content_to_job(
                db,
                job=job,
                content=existing_content,
                is_duplicate=True,
                match_type=match_type,
                source_type=source_type,
                source_external_id=source_external_id,
                processed_document_id=processed_document_id,
                metadata={"reason": reason, "quality_score": quality.get("score", 0)},
            )
            job.current_stage = "GROUPING" if story else "CANONICAL"
            job.total_duplicates += 1
            job.progress_percent = max(float(job.progress_percent), 85)
            add_crawl_log(
                db,
                job_id=job.id,
                stage=job.current_stage,
                level="INFO",
                message="Content duplicate linked to existing canonical content",
                metadata={
                    "processed_document_id": processed_document_id,
                    "content_id": str(existing_content.id),
                    "match_type": match_type,
                    "reason": reason,
                    "quality_score": quality.get("score", 0),
                    **({"story_id": str(story.id)} if story else {}),
                },
            )

        db.add(
            KafkaTask(
                reference_id=job.id if job else None,
                reference_type="crawl_job",
                task_type="NORMALIZE",
                status="COMPLETED",
                started_at=datetime.utcnow(),
                completed_at=datetime.utcnow(),
                payload_jsonb={"input_reference": processed_document_id},
                result_jsonb={"output_reference": str(existing_content.id)},
            )
        )
        db.flush()
        finalized = finalize_job_if_ready(db, job)
        return existing_content, story, True, finalized, job.status if job else None

    @staticmethod
    def _link_content_to_job(
        db: Session,
        *,
        job: CrawlJob | None,
        content: ContentItem,
        is_duplicate: bool,
        match_type: str | None,
        source_type: str | None,
        source_external_id: str | None,
        processed_document_id: str | None,
        metadata: dict | None = None,
    ) -> CrawlJobContent | None:
        if not job:
            return None

        link = db.get(CrawlJobContent, (job.id, content.id))
        if not link:
            link = CrawlJobContent(
                job_id=job.id,
                content_id=content.id,
                is_duplicate=is_duplicate,
                match_type=match_type,
                source_type=source_type,
                source_external_id=source_external_id,
                processed_document_id=processed_document_id,
                occurrence_count=1,
                metadata_json=metadata or {},
            )
        else:
            link.is_duplicate = bool(link.is_duplicate or is_duplicate)
            link.match_type = match_type or link.match_type
            link.source_type = source_type or link.source_type
            link.source_external_id = source_external_id or link.source_external_id
            link.processed_document_id = processed_document_id or link.processed_document_id
            link.occurrence_count = int(link.occurrence_count or 0) + 1
            link.metadata_json = {
                **(link.metadata_json if isinstance(link.metadata_json, dict) else {}),
                **(metadata or {}),
            }
        db.add(link)
        db.flush()
        return link

    def _lock_source_identity(self, db: Session, source_type: str, source_external_id: str) -> None:
        key_bytes = hashlib.sha256(f"{source_type}:{source_external_id}".encode("utf-8")).digest()[:8]
        lock_key = int.from_bytes(key_bytes, byteorder="big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": lock_key})

    def _should_group_as_story(self, source_type: str | None, normalized: dict) -> bool:
        if (source_type or "").upper() == "VNEXPRESS":
            return False
        if (source_type or "").upper() == "BILIBILI":
            return True
        return bool(
            normalized.get("season_title")
            or normalized.get("series_title")
            or normalized.get("season_id")
            or normalized.get("episodes")
        )

    def _source_metadata(self, normalized: dict, processed_document_id: str) -> dict:
        return {
            "processed_document_id": processed_document_id,
            "article_id": normalized.get("article_id"),
            "category_id": normalized.get("category_id"),
            "site_id": normalized.get("site_id"),
            "category": normalized.get("category"),
            "published_at": normalized.get("published_at"),
            "tags": normalized.get("tags") or [],
            "image_count": len(normalized.get("images") or []),
            "video_count": len(normalized.get("videos") or []),
            "metadata_only": normalized.get("metadata_only"),
            "thumbnail_url": normalized.get("thumbnail_url"),
            "embed_url": normalized.get("embed_url"),
            "review_count": normalized.get("review_count"),
            "danmaku_count": normalized.get("danmaku_count"),
            "aid": normalized.get("aid"),
            "bvid": normalized.get("bvid"),
            "cid": normalized.get("cid"),
            "season_id": normalized.get("season_id"),
            "season_title": normalized.get("season_title"),
            "series_title": normalized.get("series_title"),
            "series_source": normalized.get("series_source"),
            "episode_count": normalized.get("episode_count"),
            "related_count": len(normalized.get("related") or []),
        }

    def _find_or_create_story(self, db: Session, content: ContentItem, normalized: dict, source_type: str | None = None) -> Story:
        title = normalized.get("season_title") or normalized.get("series_title") or normalized.get("title") or ""
        key = grouping_key(title, normalized.get("author"), normalized.get("language") or "vi")
        story = db.query(Story).filter(Story.normalized_name == key).first()
        if story:
            return story
        story_name = normalize_story_text(title)
        story = Story(
            content_id=content.id,
            canonical_name=story_name.title(),
            normalized_name=key,
            description=normalized.get("description"),
            language=normalized.get("language") or "vi",
            grouping_confidence=85,
        )
        db.add(story)
        db.flush()
        return story

    def _find_existing_story(self, db: Session, content: ContentItem) -> Story | None:
        if content.story_id:
            return db.get(Story, content.story_id)
        story = db.query(Story).filter(Story.content_id == content.id).first()
        return story

    def _extract_media(self, normalized: dict) -> list[dict]:
        media_items = normalized.get("media") if isinstance(normalized.get("media"), list) else []
        video_thumbnail_urls = {
            self._media_url_fingerprint(item.get("thumbnail_url"))
            for item in media_items
            if isinstance(item, dict)
            and str(item.get("media_type") or item.get("type") or "").upper().startswith("VIDEO")
            and item.get("thumbnail_url")
        }
        primary_thumbnail = normalized.get("thumbnail_url")
        if primary_thumbnail and self._media_url_fingerprint(primary_thumbnail) not in video_thumbnail_urls:
            media_items = [
                *media_items,
                {"media_type": "IMAGE", "source_url": primary_thumbnail, "role": "thumbnail"},
            ]
        seen: set[tuple[str, str]] = set()
        result = []
        for item in media_items:
            if not isinstance(item, dict):
                continue
            source_url = item.get("source_url")
            media_type = item.get("media_type") or item.get("type")
            if not source_url or not media_type:
                continue
            media_key = (str(media_type), str(source_url))
            if media_key in seen:
                continue
            seen.add(media_key)
            is_video = str(media_type).upper().startswith("VIDEO")
            result.append({
                "media_type": str(media_type),
                "source_url": str(source_url),
                "role": item.get("role"),
                "thumbnail_url": item.get("thumbnail_url") or (normalized.get("thumbnail_url") if is_video else None),
                "duration_seconds": self._as_int(item.get("duration_seconds") or normalized.get("duration_seconds")),
                "format": item.get("format"),
                "mime_type": item.get("mime_type"),
                "embed_url": item.get("embed_url"),
                "provider": item.get("provider"),
                "video_id": item.get("video_id"),
                "title": item.get("title"),
                "description": item.get("description"),
                "upload_date": item.get("upload_date"),
                "duration": item.get("duration"),
                "qualities": item.get("qualities") if isinstance(item.get("qualities"), list) else [],
                "max_quality": item.get("max_quality"),
                "extraction_source": item.get("extraction_source"),
                "alt": item.get("alt"),
                "caption": item.get("caption"),
            })
        return result

    @staticmethod
    def _media_url_fingerprint(value: str | None) -> str:
        return str(value or "").split("?", 1)[0].split("#", 1)[0].lower()

    def _apply_episode(self, content: ContentItem, story: Story, normalized: dict) -> None:
        content.story_id = story.id

        episodes = normalized.get("episodes") if isinstance(normalized.get("episodes"), list) else []
        if episodes:
            for index, episode in enumerate(episodes, start=1):
                if not isinstance(episode, dict):
                    continue
                episode_number = self._as_int(episode.get("episode_index")) or index
                content.episode_order = episode_number
                return

        if content.content_type in {"VIDEO", "EPISODE", "PLAYLIST", "STORY"}:
            content.episode_order = extract_episode_number(normalized.get("title") or "")

    def _as_int(self, value) -> int | None:
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _parse_datetime(self, value) -> datetime | None:
        if not value:
            return None
        if isinstance(value, datetime):
            return value
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            pass

        match = re.search(
            r"(\d{1,2})/(\d{1,2})/(\d{4})\s*,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?",
            str(value),
        )
        if not match:
            return None
        day, month, year, hour, minute, second = match.groups()
        return datetime(
            int(year),
            int(month),
            int(day),
            int(hour),
            int(minute),
            int(second or 0),
            tzinfo=timezone(timedelta(hours=7)),
        )
