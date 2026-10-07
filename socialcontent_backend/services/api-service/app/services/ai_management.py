from __future__ import annotations

import re
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session, selectinload

from common.db.models import AiAnalysisRun, AiContentDecision, SocialPost, SocialPostMetric, SocialProfile, SocialProfileStrategy


def _aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _split_topics(value: str | None) -> list[str]:
    return [item.strip() for item in re.split(r"[,;\n]+", value or "") if item.strip()]


def _topic_key(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _extract_post_topics(post: SocialPost, strategy: SocialProfileStrategy | None) -> list[str]:
    text = f"{post.title or ''} {post.caption or ''}"
    tags = [match.strip("#").lower() for match in re.findall(r"#[\wÀ-ỹ-]+", text)]
    if tags:
        return tags[:5]

    configured = _split_topics(strategy.content_topics if strategy else "")
    lowered = text.lower()
    matched = [topic for topic in configured if _topic_key(topic) in lowered]
    if matched:
        return matched[:3]

    words = [part.strip(".,;:!?()[]{}").lower() for part in text.split() if len(part.strip(".,;:!?()[]{}")) >= 4]
    return words[:2] or ["chung"]


def _latest_metrics_by_post(db: Session, post_ids: list[uuid.UUID]) -> dict[uuid.UUID, SocialPostMetric]:
    if not post_ids:
        return {}
    latest: dict[uuid.UUID, SocialPostMetric] = {}
    metrics = (
        db.query(SocialPostMetric)
        .filter(SocialPostMetric.post_id.in_(post_ids))
        .order_by(SocialPostMetric.post_id.asc(), SocialPostMetric.captured_at.asc())
        .all()
    )
    for metric in metrics:
        latest[metric.post_id] = metric
    return latest


def _first_metrics_by_post(db: Session, post_ids: list[uuid.UUID]) -> dict[uuid.UUID, SocialPostMetric]:
    if not post_ids:
        return {}
    first: dict[uuid.UUID, SocialPostMetric] = {}
    metrics = (
        db.query(SocialPostMetric)
        .filter(SocialPostMetric.post_id.in_(post_ids))
        .order_by(SocialPostMetric.post_id.asc(), SocialPostMetric.captured_at.asc())
        .all()
    )
    for metric in metrics:
        first.setdefault(metric.post_id, metric)
    return first


def _engagement(metric: SocialPostMetric | None) -> float:
    if not metric or not metric.views:
        return 0.0
    return round(((metric.likes or 0) + (metric.comments or 0) + (metric.shares or 0)) / max(metric.views, 1) * 100, 2)


def _serialize_run(run: AiAnalysisRun, include_decisions: bool = True) -> dict[str, Any]:
    data = {
        "id": str(run.id),
        "profile_id": str(run.profile_id),
        "trigger_type": run.trigger_type,
        "status": run.status,
        "data_range_start": run.data_range_start,
        "data_range_end": run.data_range_end,
        "summary": run.summary,
        "input": run.input_jsonb or {},
        "output": run.output_jsonb or {},
        "error_message": run.error_message,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "created_at": run.created_at,
    }
    if include_decisions:
        data["decisions"] = [_serialize_decision(decision) for decision in run.decisions]
    return data


def _serialize_decision(decision: AiContentDecision) -> dict[str, Any]:
    return {
        "id": str(decision.id),
        "analysis_run_id": str(decision.analysis_run_id),
        "profile_id": str(decision.profile_id),
        "decision_type": decision.decision_type,
        "title": decision.title,
        "target_audience": decision.target_audience,
        "recommended_topics": decision.recommended_topics or [],
        "recommended_posting_times": decision.recommended_posting_times or [],
        "growth_insights": decision.growth_insights or [],
        "content_warnings": decision.content_warnings or [],
        "summary": decision.summary,
        "confidence_score": decision.confidence_score,
        "metadata": decision.metadata_json or {},
        "created_at": decision.created_at,
    }


class AiManagementService:
    def get_config(self, profile: SocialProfile) -> dict[str, Any]:
        strategy = profile.strategy
        return {
            "profile_id": str(profile.id),
            "ai_management_enabled": bool(getattr(strategy, "ai_management_enabled", False)),
            "ai_management_frequency_days": int(getattr(strategy, "ai_management_frequency_days", 7) or 7),
            "ai_management_last_analysis_at": getattr(strategy, "ai_management_last_analysis_at", None),
        }

    def update_config(self, db: Session, profile: SocialProfile, enabled: bool | None, frequency_days: int | None) -> dict[str, Any]:
        strategy = profile.strategy
        if strategy is None:
            strategy = SocialProfileStrategy(profile_id=profile.id)
            db.add(strategy)
            db.flush()
        if enabled is not None:
            strategy.ai_management_enabled = bool(enabled)
        if frequency_days is not None:
            strategy.ai_management_frequency_days = max(1, min(int(frequency_days), 90))
        db.commit()
        db.refresh(strategy)
        return self.get_config(profile)

    def latest_report(self, db: Session, profile: SocialProfile, limit: int = 8) -> dict[str, Any]:
        runs = (
            db.query(AiAnalysisRun)
            .options(selectinload(AiAnalysisRun.decisions))
            .filter(AiAnalysisRun.profile_id == profile.id)
            .order_by(AiAnalysisRun.created_at.desc())
            .limit(max(1, min(limit, 50)))
            .all()
        )
        latest = runs[0] if runs else None
        return {
            "profile_id": str(profile.id),
            "config": self.get_config(profile),
            "latest_run": _serialize_run(latest) if latest else None,
            "history": [_serialize_run(run, include_decisions=False) for run in runs],
        }

    def analyze(self, db: Session, profile: SocialProfile, days: int = 7, trigger_type: str = "manual") -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        days = max(1, min(int(days or 7), 90))
        start = now - timedelta(days=days)
        strategy = profile.strategy

        run = AiAnalysisRun(
            profile_id=profile.id,
            trigger_type=trigger_type,
            status="running",
            data_range_start=start,
            data_range_end=now,
            input_jsonb={"days": days, "profile_platform": profile.platform},
            output_jsonb={},
            started_at=now,
            created_at=now,
        )
        db.add(run)
        db.flush()

        posts = (
            db.query(SocialPost)
            .filter(SocialPost.profile_id == profile.id, SocialPost.published_at >= start, SocialPost.published_at <= now)
            .order_by(SocialPost.published_at.asc())
            .all()
        )
        post_ids = [post.id for post in posts]
        latest_metrics = _latest_metrics_by_post(db, post_ids)
        first_metrics = _first_metrics_by_post(db, post_ids)

        topic_stats: dict[str, dict[str, Any]] = {}
        slot_stats: dict[str, dict[str, Any]] = {}
        total_views = 0
        total_engagement = 0.0
        growth_items: list[dict[str, Any]] = []

        for post in posts:
            latest = latest_metrics.get(post.id)
            first = first_metrics.get(post.id)
            views = int(latest.views if latest else 0)
            growth = max(views - int(first.views if first else 0), 0)
            engagement = _engagement(latest)
            total_views += views
            total_engagement += engagement

            published_at = _aware_utc(post.published_at) or now
            hour_slot = f"{published_at.hour:02d}:00-{(published_at.hour + 1) % 24:02d}:00"
            slot = slot_stats.setdefault(hour_slot, {"slot": hour_slot, "posts": 0, "views": 0, "growth": 0, "engagement_total": 0.0})
            slot["posts"] += 1
            slot["views"] += views
            slot["growth"] += growth
            slot["engagement_total"] += engagement

            for topic in _extract_post_topics(post, strategy):
                key = _topic_key(topic)
                item = topic_stats.setdefault(key, {"topic": topic, "posts": 0, "views": 0, "growth": 0, "engagement_total": 0.0})
                item["posts"] += 1
                item["views"] += views
                item["growth"] += growth
                item["engagement_total"] += engagement

            growth_items.append({
                "post_id": str(post.id),
                "title": post.title,
                "published_at": post.published_at,
                "views": views,
                "growth": growth,
                "engagement_rate": engagement,
            })

        topics = self._rank_topics(topic_stats)
        time_slots = self._rank_time_slots(slot_stats)
        avg_engagement = round(total_engagement / len(posts), 2) if posts else 0.0
        target_audience = self._target_audience(profile, strategy, topics)
        warnings = self._warnings(posts, topics, time_slots)
        summary = self._summary(posts, topics, time_slots, target_audience)

        output = {
            "posts_analyzed": len(posts),
            "total_views": total_views,
            "avg_engagement_rate": avg_engagement,
            "top_topics": topics,
            "best_posting_times": time_slots,
            "top_growth_posts": sorted(growth_items, key=lambda item: (item["growth"], item["views"]), reverse=True)[:5],
            "target_audience": target_audience,
            "content_warnings": warnings,
        }

        decision = AiContentDecision(
            analysis_run_id=run.id,
            profile_id=profile.id,
            decision_type="content_strategy",
            title="Gợi ý chiến lược nội dung và lịch đăng",
            target_audience=target_audience,
            recommended_topics=topics[:5],
            recommended_posting_times=time_slots[:5],
            growth_insights=output["top_growth_posts"],
            content_warnings=warnings,
            summary=summary,
            confidence_score=self._confidence(posts, topics, time_slots),
            metadata_json={"avg_engagement_rate": avg_engagement, "total_views": total_views},
        )
        db.add(decision)

        run.status = "completed"
        run.summary = summary
        run.output_jsonb = output
        run.finished_at = datetime.now(timezone.utc)
        if strategy:
            strategy.ai_management_last_analysis_at = run.finished_at
        db.commit()
        db.refresh(run)
        return _serialize_run(run)

    def _rank_topics(self, stats: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        rows = []
        for item in stats.values():
            posts = max(int(item["posts"]), 1)
            avg_engagement = round(float(item["engagement_total"]) / posts, 2)
            score = round(float(item["views"]) + float(item["growth"]) * 0.7 + avg_engagement * 100, 2)
            rows.append({**item, "avg_views": round(item["views"] / posts), "avg_engagement_rate": avg_engagement, "score": score})
        return sorted(rows, key=lambda item: item["score"], reverse=True)

    def _rank_time_slots(self, stats: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        rows = []
        for item in stats.values():
            posts = max(int(item["posts"]), 1)
            avg_engagement = round(float(item["engagement_total"]) / posts, 2)
            score = round((float(item["views"]) / posts) + (float(item["growth"]) / posts) * 0.8 + avg_engagement * 80, 2)
            rows.append({**item, "avg_views": round(item["views"] / posts), "avg_engagement_rate": avg_engagement, "score": score})
        return sorted(rows, key=lambda item: item["score"], reverse=True)

    def _target_audience(self, profile: SocialProfile, strategy: SocialProfileStrategy | None, topics: list[dict[str, Any]]) -> str:
        if strategy and strategy.target_audience.strip():
            return strategy.target_audience.strip()
        metadata = profile.metadata_json or {}
        audience = metadata.get("audience") or metadata.get("target_audience")
        if isinstance(audience, str) and audience.strip():
            return audience.strip()
        if topics:
            return f"Nhóm người xem quan tâm mạnh tới {topics[0]['topic']} và các nội dung liên quan."
        return "Chưa đủ dữ liệu nhân khẩu học; tạm ưu tiên nhóm khán giả hiện tại của kênh."

    def _warnings(self, posts: list[SocialPost], topics: list[dict[str, Any]], slots: list[dict[str, Any]]) -> list[dict[str, str]]:
        warnings: list[dict[str, str]] = []
        if len(posts) < 5:
            warnings.append({"level": "medium", "message": "Dữ liệu còn ít, nên xem gợi ý như hướng thử nghiệm trong tuần tới."})
        if not topics:
            warnings.append({"level": "low", "message": "Chưa nhận diện được chủ đề nổi bật từ caption/title."})
        if not slots:
            warnings.append({"level": "low", "message": "Chưa đủ dữ liệu thời gian đăng để chọn khung giờ tối ưu."})
        return warnings

    def _summary(self, posts: list[SocialPost], topics: list[dict[str, Any]], slots: list[dict[str, Any]], audience: str) -> str:
        if not posts:
            return "Chưa có bài đăng trong khoảng phân tích, hệ thống chưa thể đưa ra khuyến nghị đáng tin cậy."
        topic_text = topics[0]["topic"] if topics else "các chủ đề hiện tại"
        slot_text = slots[0]["slot"] if slots else "khung giờ đang dùng"
        return f"Nên ưu tiên {topic_text}, nhắm tới {audience}, và thử đăng nhiều hơn trong khung {slot_text}."

    def _confidence(self, posts: list[SocialPost], topics: list[dict[str, Any]], slots: list[dict[str, Any]]) -> float:
        sample_score = min(len(posts) / 20, 1.0) * 0.5
        topic_score = 0.25 if topics else 0
        slot_score = 0.25 if slots else 0
        return round(sample_score + topic_score + slot_score, 2)
