import logging
from datetime import datetime

from sqlalchemy.orm import Session

from common.db.crawl_status import add_crawl_log, finalize_job_if_ready
from common.db.idempotency import claim_event
from common.db.models import ContentItem, ContentMedia, ContentSource, CrawlJob, Episode, ProcessingRun, Story
from app.deduplication.rules import find_or_mark_duplicate
from app.grouping.rules import extract_episode_number, grouping_key, normalize_story_text
from app.ordering.episodes import update_story_completion
from app.producers.story_events import StoryEventProducer
from app.repositories.processed_documents import ProcessedDocumentRepository

logger = logging.getLogger(__name__)


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

        content, story, is_duplicate, finalized, job_status = self._save_canonical(db, doc, processed_document_id, message.get("job_id"))
        db.commit()
        if story:
            self.producer.story_grouped(job_id=message.get("job_id"), story_id=str(story.id), content_id=str(content.id))
        self.producer.canonical_saved(job_id=message.get("job_id"), content_id=str(content.id), duplicate=is_duplicate)
        if finalized:
            self.producer.job_completed(job_id=message.get("job_id"), status=job_status or "SUCCEEDED")

    def _save_canonical(self, db: Session, doc: dict, processed_document_id: str, job_id: str | None):
        normalized = doc["normalized"]
        quality = doc["quality"]
        source_type = doc.get("source_type") or "BILIBILI"
        source_external_id = normalized.get("source_external_id") or normalized.get("source_url") or doc.get("raw_document_id") or processed_document_id
        existing_source = (
            db.query(ContentSource)
            .filter(
                ContentSource.source_type == source_type,
                ContentSource.source_external_id == str(source_external_id),
            )
            .first()
        )
        if existing_source:
            return self._handle_source_duplicate(db, existing_source, normalized, quality, doc.get("raw_document_id"), processed_document_id, job_id)

        job = db.get(CrawlJob, job_id) if job_id else None
        scope = job.content_scope if job and hasattr(job, "content_scope") else "GLOBAL"
        owner = job.requested_by if job and scope == "PRIVATE" else None
        created_by = job.created_by_type if job and hasattr(job, "created_by_type") else "SYSTEM"

        content = ContentItem(
            content_type=normalized.get("content_type", "VIDEO"),
            canonical_title=normalized.get("title") or "Untitled",
            normalized_title=normalized.get("normalized_title"),
            summary=normalized.get("description"),
            language=normalized.get("language") or "vi",
            content_scope=scope,
            owner_user_id=owner,
            created_by_type=created_by,
            status=quality.get("status", "NEEDS_REVIEW"),
            published_at=self._parse_datetime(normalized.get("published_at")),
            duration_seconds=self._as_int(normalized.get("duration_seconds")),
            canonical_url=normalized.get("source_url"),
            content_hash=normalized.get("content_hash"),
            transcript_hash=normalized.get("transcript_hash"),
            quality_score=quality.get("score", 0),
        )
        db.add(content)
        db.flush()

        db.add(
            ContentSource(
                content_id=content.id,
                source_type=source_type,
                source_external_id=str(source_external_id),
                source_url=normalized.get("source_url"),
                raw_document_id=doc.get("raw_document_id"),
                source_title=normalized.get("title"),
                source_author=normalized.get("author"),
                source_published_at=self._parse_datetime(normalized.get("published_at")),
                metadata_json=self._source_metadata(normalized, processed_document_id),
            )
        )
        self._create_media(db, content, normalized)

        is_duplicate = find_or_mark_duplicate(db, content)
        story = None
        if self._should_group_as_story(source_type, normalized):
            story = self._find_or_create_story(db, content, normalized)
            self._create_episode_if_needed(db, content, story, normalized)
            db.flush()
            db.refresh(story)
            update_story_completion(story)

        job = db.get(CrawlJob, job_id) if job_id else None
        if job:
            job.current_stage = "GROUPING" if story else "CANONICAL"
            job.total_duplicates += 1 if is_duplicate else 0
            job.progress_percent = max(float(job.progress_percent), 85)
            add_crawl_log(
                db,
                job_id=job.id,
                stage=job.current_stage,
                message="Canonical content saved",
                metadata={
                    "processed_document_id": processed_document_id,
                    "content_id": str(content.id),
                    "duplicate": is_duplicate,
                    "quality_score": quality.get("score", 0),
                    **({"story_id": str(story.id)} if story else {}),
                },
            )

        db.add(
            ProcessingRun(
                content_id=content.id,
                job_id=job.id if job else None,
                processing_type="CANONICAL_SAVE",
                status="SUCCEEDED",
                processor_version="1.0.0",
                input_reference=processed_document_id,
                output_reference=str(content.id),
                started_at=datetime.utcnow(),
                completed_at=datetime.utcnow(),
            )
        )
        db.flush()
        finalized = finalize_job_if_ready(db, job)
        return content, story, is_duplicate, finalized, job.status if job else None

    def _handle_source_duplicate(
        self,
        db: Session,
        existing_source: ContentSource,
        normalized: dict,
        quality: dict,
        raw_document_id: str | None,
        processed_document_id: str,
        job_id: str | None,
    ):
        content = db.get(ContentItem, existing_source.content_id)
        if not content:
            raise ValueError(f"Content source points to missing content: {existing_source.id}")
        existing_source.last_seen_at = datetime.utcnow()
        existing_source.raw_document_id = raw_document_id or existing_source.raw_document_id
        existing_source.metadata_json = {
            **(existing_source.metadata_json or {}),
            **self._source_metadata(normalized, processed_document_id),
            "source_duplicate": True,
        }
        story = None
        if self._should_group_as_story(existing_source.source_type, normalized):
            story = self._find_existing_story(db, content) or self._find_or_create_story(db, content, normalized)
            self._create_episode_if_needed(db, content, story, normalized)
        self._create_media(db, content, normalized)
        db.flush()
        if story:
            db.refresh(story)
            update_story_completion(story)

        job = db.get(CrawlJob, job_id) if job_id else None
        if job:
            job.current_stage = "GROUPING" if story else "CANONICAL"
            job.total_duplicates += 1
            job.progress_percent = max(float(job.progress_percent), 85)
            add_crawl_log(
                db,
                job_id=job.id,
                stage=job.current_stage,
                level="INFO",
                message="Source duplicate linked to existing canonical content",
                metadata={
                    "processed_document_id": processed_document_id,
                    "content_id": str(content.id),
                    "source_type": existing_source.source_type,
                    "source_external_id": existing_source.source_external_id,
                    "quality_score": quality.get("score", 0),
                    **({"story_id": str(story.id)} if story else {}),
                },
            )

        db.add(
            ProcessingRun(
                content_id=content.id,
                job_id=job.id if job else None,
                processing_type="CANONICAL_SAVE",
                status="SUCCEEDED",
                processor_version="1.0.0",
                input_reference=processed_document_id,
                output_reference=str(content.id),
                started_at=datetime.utcnow(),
                completed_at=datetime.utcnow(),
            )
        )
        db.flush()
        finalized = finalize_job_if_ready(db, job)
        return content, story, True, finalized, job.status if job else None

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

    def _find_or_create_story(self, db: Session, content: ContentItem, normalized: dict) -> Story:
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
        story = db.query(Story).filter(Story.content_id == content.id).first()
        if story:
            return story
        episode = db.query(Episode).filter(Episode.content_id == content.id).first()
        return db.get(Story, episode.story_id) if episode else None

    def _create_media(self, db: Session, content: ContentItem, normalized: dict) -> None:
        media_items = normalized.get("media") if isinstance(normalized.get("media"), list) else []
        if normalized.get("thumbnail_url"):
            media_items = [
                *media_items,
                {"media_type": "IMAGE", "source_url": normalized.get("thumbnail_url"), "role": "thumbnail"},
            ]
        seen: set[tuple[str, str]] = set()
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
            exists = (
                db.query(ContentMedia)
                .filter(
                    ContentMedia.content_id == content.id,
                    ContentMedia.source_url == source_url,
                    ContentMedia.media_type == media_type,
                )
                .first()
            )
            if exists:
                continue
            db.add(
                ContentMedia(
                    content_id=content.id,
                    media_type=str(media_type),
                    source_url=str(source_url),
                    thumbnail_url=normalized.get("thumbnail_url") if str(media_type).upper().startswith("VIDEO") else None,
                    duration_seconds=self._as_int(item.get("duration_seconds") or normalized.get("duration_seconds")),
                )
            )

    def _create_episode_if_needed(self, db: Session, content: ContentItem, story: Story, normalized: dict) -> None:
        episodes = normalized.get("episodes") if isinstance(normalized.get("episodes"), list) else []
        if episodes:
            seen_episode_keys: set[tuple[int | None, str]] = set()
            for index, episode in enumerate(episodes, start=1):
                if not isinstance(episode, dict):
                    continue
                episode_number = self._as_int(episode.get("episode_index")) or index
                episode_title = str(episode.get("title") or content.canonical_title or "").strip()
                episode_key = (episode_number, episode_title)
                if episode_key in seen_episode_keys:
                    continue
                seen_episode_keys.add(episode_key)
                if self._episode_exists(db, story, episode_number, episode_title):
                    continue
                db.add(
                    Episode(
                        content_id=content.id,
                        story_id=story.id,
                        episode_number=episode_number,
                        sequence_order=episode_number,
                        episode_title=episode_title,
                        duration_seconds=self._as_int(episode.get("duration_seconds")),
                    )
                )
            return

        if content.content_type not in {"VIDEO", "EPISODE", "PLAYLIST", "STORY"}:
            return
        episode_number = extract_episode_number(normalized.get("title") or "")
        if self._episode_exists(db, story, episode_number, content.canonical_title):
            return
        db.add(
            Episode(
                content_id=content.id,
                story_id=story.id,
                episode_number=episode_number,
                sequence_order=episode_number,
                episode_title=content.canonical_title,
                duration_seconds=content.duration_seconds,
            )
        )

    def _episode_exists(self, db: Session, story: Story, episode_number: int | None, episode_title: str | None) -> bool:
        query = db.query(Episode).filter(Episode.story_id == story.id)
        if episode_number:
            query = query.filter(Episode.episode_number == episode_number)
        elif episode_title:
            query = query.filter(Episode.episode_title == episode_title)
        else:
            return False
        return db.query(query.exists()).scalar()

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
            return None
