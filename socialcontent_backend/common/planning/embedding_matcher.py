from __future__ import annotations

import hashlib
import math
import re
import unicodedata
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.core.embedding_service_client import (
    create_embeddings as create_service_embeddings,
    ensure_content_embeddings as ensure_service_content_embeddings,
    embedding_model_storage_name,
)
from common.db.models import ContentEmbedding, ContentItem, SocialProfileStrategy, TopicEmbedding


@dataclass
class StrategyCandidateScore:
    content: ContentItem
    similarity: float
    score: float
    quality_score: float
    threshold: float
    eligible: bool
    matched_topics: list[str] = field(default_factory=list)
    avoided_topics: list[str] = field(default_factory=list)
    selection_reasons: list[str] = field(default_factory=list)
    rejection_reasons: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class StrategyEmbeddingMatcher:
    _topic_cache: dict[str, tuple[str, list[float]]] = {}

    def __init__(self) -> None:
        self.settings = get_settings()
        self._ensured_content_keys: set[str] = set()

    def rank_candidates(
        self,
        db: Session,
        items: list[ContentItem],
        strategy: SocialProfileStrategy,
        *,
        limit: int,
    ) -> list[StrategyCandidateScore]:
        self.ensure_content_embeddings(db, items, preferred_model_name=self.model_name())
        scores = [self.score_candidate(db, content, strategy) for content in items]
        scores.sort(
            key=lambda item: (
                item.eligible,
                item.similarity,
                item.score,
                item.quality_score,
                item.content.updated_at or item.content.created_at,
            ),
            reverse=True,
        )
        return scores[:limit]

    def score_candidate(self, db: Session, content: ContentItem, strategy: SocialProfileStrategy) -> StrategyCandidateScore:
        content_topics = self.split_terms(strategy.content_topics)
        content_topic_descriptions = self.topic_descriptions_map(getattr(strategy, "content_topic_descriptions", None))
        avoid_topic_descriptions = self.topic_descriptions_map(getattr(strategy, "avoid_topic_descriptions", None))
        threshold = self.strategy_similarity_threshold(strategy)
        topic_threshold = threshold
        avoid_threshold = self.strategy_avoid_similarity_threshold(strategy)
        quality = round(float(content.quality_score or 0), 1)
        keyword_matched_topics = self.matched_terms(content, strategy.content_topics)
        keyword_avoided_topics = self.matched_terms(content, strategy.avoid_topics)
        topic_matches: list[dict[str, Any]] = []
        avoid_topic_matches: list[dict[str, Any]] = []
        matched_topics = list(keyword_matched_topics)
        avoided_topics = list(keyword_avoided_topics)

        similarity = 0.0
        passed_similarity_gate = False
        model_name = None
        vector_source = "missing"
        rejection_reasons: list[str] = []

        all_topic_evaluations: list[dict[str, Any]] = []
        avoid_topic_evaluations: list[dict[str, Any]] = []

        if content_topics:
            try:
                model_name = self.model_name()
                content_embedding = self.ensure_content_embedding(db, content, preferred_model_name=model_name)
                content_vector = self.vector_values(content_embedding.embedding) if content_embedding else []
                if content_vector:
                    vector_source = "topic_cosine_threshold"
                    all_topic_evaluations = self.score_topics(
                        db,
                        strategy.content_topics,
                        content_vector,
                        threshold=topic_threshold,
                        descriptions=content_topic_descriptions,
                    )
                    avoid_topic_evaluations = self.score_topics(
                        db,
                        strategy.avoid_topics,
                        content_vector,
                        threshold=avoid_threshold,
                        descriptions=avoid_topic_descriptions,
                    )
                    embedding_topic_matches = [item for item in all_topic_evaluations if item.get("matched")]
                    embedding_avoid_topic_matches = [item for item in avoid_topic_evaluations if item.get("matched")]
                    passed_similarity_gate = bool(embedding_topic_matches)
                    similarity = self.top_similarity(all_topic_evaluations)
                    topic_matches = embedding_topic_matches
                    avoid_topic_matches = embedding_avoid_topic_matches
                    matched_topics = self.unique_terms([*keyword_matched_topics, *(item["topic"] for item in topic_matches)])
                    avoided_topics = self.unique_terms([*keyword_avoided_topics, *(item["topic"] for item in avoid_topic_matches)])
                else:
                    matched_topics = self.unique_terms([*keyword_matched_topics, *(item["topic"] for item in topic_matches)])
                    avoided_topics = self.unique_terms([*keyword_avoided_topics, *(item["topic"] for item in avoid_topic_matches)])
                    rejection_reasons.append("Missing content embedding vector")
            except Exception as exc:
                import logging
                logging.getLogger("embedding_matcher").warning(f"Error scoring candidate {content.id}: {exc}")
                rejection_reasons.append(f"Embedding service unavailable: {exc}")
        else:
            rejection_reasons.append("Profile strategy has no content_topics to embed")

        score = round(max(0.0, min(100.0, similarity * 100.0)), 1)
        has_required_video = self.has_video_signal(content) if getattr(strategy, "require_video", False) else True

        if content_topics and not passed_similarity_gate:
            rejection_reasons.append(f"No content topic cosine reached threshold {threshold:.4f}; top cosine={similarity:.4f}")
        if avoided_topics:
            rejection_reasons.append(f"Matched avoid topics above threshold {avoid_threshold:.4f}: {', '.join(avoided_topics[:5])}")
        if not has_required_video:
            rejection_reasons.append("Profile strategy requires video, but this content has no video signal")

        eligible = content.status in {"READY", "USABLE_WITH_WARNING"} and passed_similarity_gate and not avoided_topics and has_required_video
        selection_reasons = [
            "Included because the content item is available for this profile's strategy matching",
            f"Topic cosine threshold gate={passed_similarity_gate}, top_cosine={similarity:.4f}, threshold={threshold:.4f}, avoid_threshold={avoid_threshold:.4f}",
        ]
        if matched_topics:
            selection_reasons.append(f"Matched priority topics: {', '.join(matched_topics[:5])}")
        elif all_topic_evaluations:
            top_evals = [f"{item['topic']} ({item['similarity']:.4f})" for item in all_topic_evaluations[:3]]
            selection_reasons.append(f"Top evaluated strategy topics: {', '.join(top_evals)}")
        if avoided_topics:
            selection_reasons.append(f"Blocked by avoid topics: {', '.join(avoided_topics[:5])}")
        if eligible:
            selection_reasons.append("Eligible for AI workflow decision because embedding similarity passed the strategy threshold")

        display_topic_matches = topic_matches if topic_matches else all_topic_evaluations[:5]
        top_topic_match = all_topic_evaluations[0] if all_topic_evaluations else None

        return StrategyCandidateScore(
            content=content,
            similarity=round(similarity, 4),
            score=score,
            quality_score=quality,
            threshold=round(threshold, 4),
            eligible=eligible,
            matched_topics=matched_topics,
            avoided_topics=avoided_topics,
            selection_reasons=selection_reasons,
            rejection_reasons=rejection_reasons,
            metadata={
                "selection_algorithm": "topic_cosine_threshold_ai_workflow_v2",
                "strategy_topics": self.split_terms(strategy.content_topics),
                "score_breakdown": {
                    "strategy_score": score,
                    "embedding_similarity": round(similarity, 4),
                    "similarity_threshold": round(threshold, 4),
                    "passed_similarity_gate": passed_similarity_gate,
                    "similarity_source": vector_source,
                    "top_topic_match": top_topic_match,
                    "quality_score": quality,
                    "matched_topics": matched_topics,
                    "avoided_topics": avoided_topics,
                    "topic_matches": display_topic_matches,
                    "topic_scores": all_topic_evaluations,
                    "avoid_topic_matches": avoid_topic_matches,
                    "blocked_by_avoid_topics": bool(avoided_topics),
                    "topic_match_threshold": topic_threshold,
                    "avoid_similarity_threshold": avoid_threshold,
                    "require_video": bool(getattr(strategy, "require_video", False)),
                    "has_required_video": has_required_video,
                    "embedding_model": model_name,
                    "vector_source": vector_source,
                },
                "embedding_similarity": round(similarity, 4),
                "similarity_threshold": round(threshold, 4),
                "passed_similarity_gate": passed_similarity_gate,
                "similarity_source": vector_source,
                "top_topic_match": top_topic_match,
                "quality_score": quality,
                "matched_topics": matched_topics,
                "avoided_topics": avoided_topics,
                "topic_matches": display_topic_matches,
                "topic_scores": all_topic_evaluations,
                "avoid_topic_matches": avoid_topic_matches,
                "blocked_by_avoid_topics": bool(avoided_topics),
                "topic_match_threshold": topic_threshold,
                "avoid_similarity_threshold": avoid_threshold,
                "embedding_model": model_name,
            },
        )

    def ensure_content_embedding(
        self,
        db: Session,
        content: ContentItem,
        *,
        preferred_model_name: str | None,
    ) -> ContentEmbedding | None:
        self.ensure_service_content_embeddings_once([content], preferred_model_name=preferred_model_name)
        query = db.query(ContentEmbedding).filter(ContentEmbedding.content_id == content.id)
        if preferred_model_name:
            existing = query.filter(ContentEmbedding.model_name == preferred_model_name).first()
            if existing:
                return existing

        existing = query.order_by(ContentEmbedding.updated_at.desc()).first()
        if not preferred_model_name and existing and self.vector_values(existing.embedding):
            return existing

        return (
            db.query(ContentEmbedding)
            .filter(
                ContentEmbedding.content_id == content.id,
                *([ContentEmbedding.model_name == preferred_model_name] if preferred_model_name else []),
            )
            .order_by(ContentEmbedding.updated_at.desc())
            .first()
        )

    def ensure_content_embeddings(
        self,
        db: Session,
        contents: list[ContentItem],
        *,
        preferred_model_name: str | None,
    ) -> dict[Any, ContentEmbedding]:
        if not contents:
            return {}

        self.ensure_service_content_embeddings_once(contents, preferred_model_name=preferred_model_name)
        content_by_id = {content.id: content for content in contents}
        existing_rows = (
            db.query(ContentEmbedding)
            .filter(ContentEmbedding.content_id.in_(list(content_by_id)), ContentEmbedding.model_name == preferred_model_name)
            .all()
            if preferred_model_name
            else []
        )
        embeddings_by_content_id = {row.content_id: row for row in existing_rows if self.vector_values(row.embedding)}
        return embeddings_by_content_id

    def ensure_service_content_embeddings_once(
        self,
        contents: list[ContentItem],
        *,
        preferred_model_name: str | None,
    ) -> None:
        ids_to_ensure = []
        ensured_keys = []
        for content in contents:
            cache_key = f"{preferred_model_name or self.model_name()}:{content.id}"
            if cache_key in self._ensured_content_keys:
                continue
            ids_to_ensure.append(str(content.id))
            ensured_keys.append(cache_key)
        if not ids_to_ensure:
            return
        try:
            ensure_service_content_embeddings(ids_to_ensure)
            self._ensured_content_keys.update(ensured_keys)
        except Exception as exc:
            import logging
            logging.getLogger("embedding_matcher").warning(f"Failed to ensure content embeddings: {exc}")

    def model_name(self) -> str:
        return embedding_model_storage_name()

    def score_topics(
        self,
        db: Session,
        raw_topics: str | None,
        content_vector: list[float],
        *,
        threshold: float,
        descriptions: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        topics = self.split_terms(raw_topics)
        if not topics or not content_vector:
            return []

        description_map = self.topic_descriptions_map(descriptions)
        topic_vectors = self.topic_embeddings(db, topics, descriptions=description_map)
        scores: list[dict[str, Any]] = []
        for topic in topics:
            vector = topic_vectors.get(topic)
            if not vector:
                continue
            description = self.topic_description(topic, self.custom_topic_description(topic, description_map))
            similarity = self.cosine_similarity(content_vector, vector)
            scores.append(
                {
                    "topic": topic,
                    "topic_key": self.topic_key(topic),
                    "description": description,
                    "similarity": round(similarity, 4),
                    "threshold": round(threshold, 4),
                    "matched": similarity >= threshold,
                    "match_source": "embedding",
                }
            )
        scores.sort(key=lambda item: item["similarity"], reverse=True)
        return scores

    def topic_embeddings(self, db: Session, topics: list[str], *, descriptions: dict[str, str] | None = None) -> dict[str, list[float]]:
        result: dict[str, list[float]] = {}
        missing: list[str] = []
        model_name = self.model_name()
        unique_topics = self.unique_terms(topics)
        description_map = self.topic_descriptions_map(descriptions)
        text_by_topic = {
            topic: self.topic_embedding_text(topic, self.custom_topic_description(topic, description_map))
            for topic in unique_topics
        }
        key_by_topic = {topic: self.topic_key(topic) for topic in unique_topics}
        hash_by_topic = {topic: self.embedding_text_hash(text_by_topic[topic]) for topic in unique_topics}

        for topic in unique_topics:
            cache_key = f"{model_name}:{key_by_topic[topic]}:{hash_by_topic[topic]}"
            cached = self._topic_cache.get(cache_key)
            if cached:
                result[topic] = cached[1]
            else:
                missing.append(topic)

        if missing:
            missing_by_key_hash = {(key_by_topic[topic], hash_by_topic[topic]): topic for topic in missing}
            existing_rows = (
                db.query(TopicEmbedding)
                .filter(
                    TopicEmbedding.topic_key.in_([key_by_topic[topic] for topic in missing]),
                    TopicEmbedding.embedding_text_hash.in_([hash_by_topic[topic] for topic in missing]),
                    TopicEmbedding.model_name == model_name,
                )
                .all()
            )
            for row in existing_rows:
                topic = missing_by_key_hash.get((row.topic_key, row.embedding_text_hash))
                if not topic:
                    continue
                vector = self.vector_values(row.embedding)
                if vector and row.embedding_text == text_by_topic[topic]:
                    cache_key = f"{model_name}:{row.topic_key}:{row.embedding_text_hash}"
                    self._topic_cache[cache_key] = (row.model_name, vector)
                    result[topic] = vector

            missing = [topic for topic in missing if topic not in result]

        if missing:
            try:
                texts = [text_by_topic[topic] for topic in missing]
                response = create_service_embeddings(
                    texts,
                    run_type="PLANNING",
                    step_name="strategy_topic_embeddings",
                )
                upsert_rows = []
                for topic, vector in zip(missing, response.embeddings):
                    cache_key = f"{response.model_name}:{key_by_topic[topic]}:{hash_by_topic[topic]}"
                    self._topic_cache[cache_key] = (response.model_name, vector)
                    result[topic] = vector
                    now = datetime.utcnow()
                    upsert_rows.append(
                        {
                            "id": uuid.uuid4(),
                            "topic_key": key_by_topic[topic],
                            "topic": topic,
                            "embedding_text": text_by_topic[topic],
                            "embedding_text_hash": hash_by_topic[topic],
                            "embedding": vector,
                            "model_name": response.model_name,
                            "embedding_dim": len(vector),
                            "created_at": now,
                            "updated_at": now,
                        }
                    )
                if upsert_rows:
                    stmt = pg_insert(TopicEmbedding.__table__).values(upsert_rows)
                    db.execute(
                        stmt.on_conflict_do_update(
                            constraint="uq_topic_embedding_model_text",
                            set_={
                                "topic": stmt.excluded.topic,
                                "embedding_text": stmt.excluded.embedding_text,
                                "embedding_text_hash": stmt.excluded.embedding_text_hash,
                                "embedding": stmt.excluded.embedding,
                                "embedding_dim": stmt.excluded.embedding_dim,
                                "updated_at": stmt.excluded.updated_at,
                            },
                        )
                    )
                    db.flush()
            except Exception as exc:
                import logging
                logging.getLogger("embedding_matcher").warning(f"Failed to fetch topic embeddings: {exc}")
        return result

    @staticmethod
    def top_similarity(matches: list[dict[str, Any]]) -> float:
        if not matches:
            return 0.0
        return max(0.0, min(1.0, max(float(item.get("similarity") or 0.0) for item in matches)))

    def strategy_similarity_threshold(self, strategy: SocialProfileStrategy) -> float:
        value = (
            getattr(strategy, "min_similarity", None)
            or getattr(strategy, "relation_threshold", None)
            or self.settings.embedding_similarity_threshold
        )
        return max(0.0, min(1.0, float(value or 0.62)))

    @staticmethod
    def strategy_avoid_similarity_threshold(strategy: SocialProfileStrategy) -> float:
        value = getattr(strategy, "avoid_similarity_threshold", None)
        return max(0.0, min(1.0, float(value if value is not None else 0.72)))

    def matched_terms(self, content: ContentItem, raw_terms: str | None) -> list[str]:
        text = self.content_match_text(content)
        return [term for term in self.split_terms(raw_terms) if term.lower() in text]

    def content_match_text(self, content: ContentItem) -> str:
        metadata = self.source_metadata(content)
        tags = metadata.get("tags") if isinstance(metadata.get("tags"), list) else []
        return " ".join(
            str(value or "")
            for value in [
                content.canonical_title,
                content.normalized_title,
                content.summary,
                metadata.get("category"),
                " ".join(str(tag) for tag in tags),
            ]
        ).lower()

    def source_metadata(self, content: ContentItem) -> dict[str, Any]:
        sources = content.sources_jsonb if isinstance(content.sources_jsonb, list) else []
        primary_source = sources[0] if sources else {}
        metadata = primary_source.get("metadata_json") if isinstance(primary_source, dict) else {}
        return metadata if isinstance(metadata, dict) else {}

    def has_video_signal(self, content: ContentItem) -> bool:
        if str(content.content_type or "").upper() == "VIDEO" or content.duration_seconds:
            return True
        media = content.media_jsonb if isinstance(content.media_jsonb, list) else []
        return any("VIDEO" in str(item.get("media_type") or item.get("type") or "").upper() for item in media if isinstance(item, dict))

    @staticmethod
    def split_terms(value: str | None) -> list[str]:
        return [part.strip() for part in str(value or "").replace("\n", ",").split(",") if part.strip()]

    @staticmethod
    def topic_embedding_text(topic: str, description: str | None = None) -> str:
        clean_topic = str(topic or "").strip()
        resolved_description = StrategyEmbeddingMatcher.topic_description(clean_topic, description)
        if resolved_description:
            return f"Topic: {clean_topic}\nDescription: {resolved_description}"
        return f"Topic: {clean_topic}"

    @staticmethod
    def topic_description(topic: str, custom_description: str | None = None) -> str:
        custom = str(custom_description or "").strip()
        if custom:
            return custom
        return ""

    @staticmethod
    def topic_key(topic: str) -> str:
        normalized = unicodedata.normalize("NFD", str(topic or "").strip().lower())
        without_marks = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
        without_marks = without_marks.replace("đ", "d")
        return re.sub(r"\s+", " ", without_marks).strip()

    @staticmethod
    def topic_descriptions_map(value: Any) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}
        result: dict[str, str] = {}
        for key, description in value.items():
            normalized_key = StrategyEmbeddingMatcher.topic_key(str(key or ""))
            clean_description = str(description or "").strip()
            if normalized_key and clean_description:
                result[normalized_key] = clean_description
        return result

    @staticmethod
    def custom_topic_description(topic: str, descriptions: dict[str, str] | None) -> str | None:
        if not descriptions:
            return None
        return descriptions.get(StrategyEmbeddingMatcher.topic_key(topic))

    @staticmethod
    def embedding_text_hash(value: str) -> str:
        return hashlib.md5(str(value or "").encode("utf-8")).hexdigest()

    @staticmethod
    def unique_terms(values: Iterable[str]) -> list[str]:
        seen: set[str] = set()
        terms: list[str] = []
        for value in values:
            term = str(value or "").strip()
            key = term.lower()
            if term and key not in seen:
                seen.add(key)
                terms.append(term)
        return terms

    @staticmethod
    def vector_values(value: Any) -> list[float]:
        if value is None:
            return []
        if hasattr(value, "tolist"):
            value = value.tolist()
        if isinstance(value, str):
            value = value.strip().strip("[]")
            if not value:
                return []
            return [float(part.strip()) for part in value.split(",") if part.strip()]
        if isinstance(value, Iterable):
            return [float(item) for item in value]
        return []

    @staticmethod
    def cosine_similarity(left: Iterable[float], right: Iterable[float]) -> float:
        left_values = list(left)
        right_values = list(right)
        if len(left_values) != len(right_values) or not left_values:
            return 0.0
        dot = sum(a * b for a, b in zip(left_values, right_values))
        left_norm = math.sqrt(sum(a * a for a in left_values))
        right_norm = math.sqrt(sum(b * b for b in right_values))
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return dot / (left_norm * right_norm)
