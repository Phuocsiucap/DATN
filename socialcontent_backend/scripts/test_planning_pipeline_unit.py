from __future__ import annotations

import os
from pathlib import Path
import sys
from unittest.mock import MagicMock, patch

backend_dir = Path(__file__).resolve().parents[1]
services_dir = backend_dir / "services"
api_service_dir = services_dir / "api-service"
planning_orchestrator_dir = services_dir / "planning-orchestrator"

sys.path.insert(0, str(api_service_dir))
sys.path.insert(0, str(planning_orchestrator_dir))
sys.path.insert(0, str(services_dir))
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv

root_env = Path(__file__).resolve().parents[2] / ".env"
if root_env.exists():
    load_dotenv(root_env, override=True)

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from common.core.config import get_settings
from common.db.models import (
    Base,
    ContentItem,
    CrawlJob,
    Episode,
    Module2Handoff,
    PlanningCandidate,
    PlanningJob,
    ProfileSeriesTrack,
    SocialProfile,
    SocialProfileStrategy,
    Story,
    User,
)

# Mock kafka publish and mongodb
with patch("common.events.kafka.publish"), patch("common.db.mongo.series_contexts") as mock_mongo_ctx, patch("common.db.mongo.planning_inputs"), patch("common.db.mongo.planning_outputs"):
    mock_mongo_ctx.return_value.insert_one.return_value.inserted_id = "mock_mongo_id_123"
    mock_mongo_ctx.return_value.find_one.return_value = {
        "_id": "mock_mongo_id_123",
        "series_id": "mock_series",
        "version": 1,
        "story_summary": {"premise": "Test premise"},
        "characters": [],
        "story_events": [],
        "narrative_coverage": [],
    }

    from app.services.pipeline import PlanningPipeline

    def test_pipeline_new_and_continue_modes():
        print("=" * 80)
        print("TESTING PLANNING PIPELINE (NEW & CONTINUE MODES)")
        print("=" * 80)

        get_settings.cache_clear()
        settings = get_settings()
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine)
        Session = sessionmaker(bind=engine)
        db = Session()

        try:
            # 1. Setup user & profile
            user = User(email="unittest@example.com", hashed_password="pass", full_name="Tester")
            db.add(user)
            db.commit()

            profile = SocialProfile(
                user_id=user.id,
                platform="tiktok",
                profile_name="Story Channel",
                username="story_tester",
                folder_path=f"profiles/unittest_{uuid.uuid4().hex[:8]}",
                status="active",
            )
            db.add(profile)
            db.commit()

            strategy = SocialProfileStrategy(
                user_id=user.id,
                profile_id=profile.id,
                content_topics="Tiên hiệp, Trùng sinh",
                avoid_topics="Sến",
                tone="Kịch tính",
                min_score=60.0,
            )
            db.add(strategy)
            db.commit()

            # 2. Setup Story & Content
            content = ContentItem(
                content_type="STORY",
                canonical_title="Võ Luyện Đỉnh Phong",
                summary="Hành trình tu luyện trở thành vạn giới chí tôn.",
                quality_score=90.0,
            )
            db.add(content)
            db.commit()

            story = Story(
                content_id=content.id,
                canonical_name="Võ Luyện Đỉnh Phong",
                normalized_name="Vo Luyen Dinh Phong",
                total_episodes=10,
            )
            db.add(story)
            db.commit()

            handoff = Module2Handoff(
                user_id=user.id,
                profile_id=profile.id,
                selection_mode="AUTO",
                status="READY",
                eligible_count=1,
            )
            db.add(handoff)
            db.commit()

            # --- RUN 1: NEW MODE ---
            print("\n[Run 1] Creating first PlanningJob (Mode NEW)...")
            job1 = PlanningJob(
                user_id=user.id,
                profile_id=profile.id,
                handoff_id=handoff.id,
                planning_mode="SERIES",
                status="PENDING",
                preferred_part_count=3,
                target_duration_seconds=60,
            )
            db.add(job1)
            db.commit()

            candidate1 = PlanningCandidate(
                planning_job_id=job1.id,
                content_id=content.id,
                story_id=story.id,
                candidate_score=85.0,
                eligible=True,
            )
            db.add(candidate1)
            db.commit()

            pipeline = PlanningPipeline()
            pipeline._run(db, job1)

            db.refresh(job1)
            print(f"-> Job 1 Status: {job1.status}")
            assert job1.status == "WAITING_REVIEW"
            plan1 = job1.plans[0]
            series1 = plan1.series
            print(f"-> Series 1 Created: '{series1.title}' with {series1.total_parts} parts (Version {series1.context_version})")
            assert series1.total_parts == 3
            assert len(series1.parts) == 3

            track = db.query(ProfileSeriesTrack).filter(ProfileSeriesTrack.profile_id == profile.id).first()
            assert track is not None
            print(f"-> Series Track Recorded: '{track.title}' (Total parts: {track.total_parts})")

            # --- RUN 2: CONTINUE MODE ---
            print("\n[Run 2] Creating second PlanningJob for SAME story (Mode CONTINUE)...")
            job2 = PlanningJob(
                user_id=user.id,
                profile_id=profile.id,
                handoff_id=handoff.id,
                planning_mode="SERIES",
                status="PENDING",
                preferred_part_count=2,
                target_duration_seconds=60,
            )
            db.add(job2)
            db.commit()

            candidate2 = PlanningCandidate(
                planning_job_id=job2.id,
                content_id=content.id,
                story_id=story.id,
                candidate_score=85.0,
                eligible=True,
            )
            db.add(candidate2)
            db.commit()

            pipeline._run(db, job2)

            db.refresh(job2)
            print(f"-> Job 2 Status: {job2.status}")
            assert job2.status == "WAITING_REVIEW"
            plan2 = job2.plans[0]
            series2 = plan2.series
            
            # Series2 should be the SAME ContentSeries object (series1)!
            assert series2.id == series1.id
            print(f"-> Successfully CONTINUED existing Series '{series2.title}'!")
            print(f"   Updated Total Parts: {series2.total_parts} (Previous 3 + New 2)")
            print(f"   Context Version: {series2.context_version} (Incremented)")
            assert series2.total_parts == 5
            assert series2.context_version == 2
            assert len(series2.parts) == 5

            print("\n" + "=" * 80)
            print("UNIT TEST PASSED SUCCESSFULLY! BOTH NEW AND CONTINUE MODES VERIFIED!")
            print("=" * 80)

        finally:
            db.close()

    if __name__ == "__main__":
        test_pipeline_new_and_continue_modes()
