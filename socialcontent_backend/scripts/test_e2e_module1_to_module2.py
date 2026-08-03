from __future__ import annotations

import os
from pathlib import Path
import sys

# Add services and backend to sys.path
backend_dir = Path(__file__).resolve().parents[1]
services_dir = backend_dir / "services"
api_service_dir = services_dir / "api-service"
planning_orchestrator_dir = services_dir / "planning-orchestrator"

sys.path.insert(0, str(api_service_dir))
sys.path.insert(0, str(planning_orchestrator_dir))
sys.path.insert(0, str(services_dir))
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv

# Load root environment variables (.env) before any config import
root_env = Path(__file__).resolve().parents[2] / ".env"
if root_env.exists():
    load_dotenv(root_env, override=True)

os.environ["DATABASE_URL"] = "sqlite:///./e2e_test.db"

from datetime import datetime
import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from common.core.config import get_settings
from common.db.models import (
    Base,
    ContentItem,
    ContentSource,
    CrawlJob,
    Episode,
    Module2Handoff,
    Module3Handoff,
    PlanningJob,
    ProcessingRun,
    ProfileContentLink,
    SocialProfile,
    SocialProfileStrategy,
    Story,
    User,
)
import importlib

from app.schemas.planning import Module2AutoHandoffRequest, Module3HandoffCreateRequest
from app.services.planning import PlanningService
from app.services.pipeline import PlanningPipeline


def run_e2e_test():
    print("=" * 80)
    print("STARTING END-TO-END MODULE 1 -> MODULE 2 INTEGRATION VERIFICATION")
    print("=" * 80)

    get_settings.cache_clear()
    settings = get_settings()
    engine = create_engine(settings.database_url)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        # 1. Setup Test User and Social Profile
        print("\n[Step 1] Setting up Test User & Social Profile Strategy...")
        user = db.query(User).filter(User.email == "e2e_test@example.com").first()
        if not user:
            user = User(
                email="e2e_test@example.com",
                hashed_password="hashed_test_pass",
                full_name="E2E Tester",
                is_active=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        profile = db.query(SocialProfile).filter(SocialProfile.user_id == user.id).first()
        if not profile:
            profile = SocialProfile(
                user_id=user.id,
                platform="tiktok",
                profile_name="TikTok Storytelling Channel",
                username="story_tester",
                folder_path=f"profiles/test_{uuid.uuid4().hex[:8]}",
                status="active",
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)

        strategy = db.query(SocialProfileStrategy).filter(SocialProfileStrategy.profile_id == profile.id).first()
        if not strategy:
            strategy = SocialProfileStrategy(
                user_id=user.id,
                profile_id=profile.id,
                content_topics="Tiên hiệp, Huyền huyễn, Trọng sinh, Trận chiến kịch tính",
                avoid_topics="Ngôn tình sến cẩm, Hài nhảm",
                tone="Kịch tính, Hấp dẫn, Cuốn hút, Bí ẩn",
                target_audience="Khán giả 18-35 tuổi thích truyện ngắn TikTok",
                min_score=60.0,
                risk_level="medium",
                approval_mode="manual",
            )
            db.add(strategy)
            db.commit()

        print(f"-> User ID: {user.id}")
        print(f"-> Profile ID: {profile.id}")

        # 2. Simulate Module 1 Crawl Completion & Content Normalization
        print("\n[Step 2] Simulating Module 1 Crawl Job & Normalized Story Content...")
        crawl_job = CrawlJob(
            name="VNExpress / Story Scraper Job",
            crawl_mode="ONE_TIME",
            status="SUCCEEDED",
            current_stage="COMPLETED",
            requested_by=user.id,
            total_discovered=5,
            total_crawled=5,
            total_normalized=5,
            progress_percent=100.0,
        )
        db.add(crawl_job)
        db.commit()
        db.refresh(crawl_job)

        # Create Primary Content & Story
        content_item = ContentItem(
            content_type="STORY",
            canonical_title="Đại La Thiên Tôn: Trọng Sinh Đô Thị",
            normalized_title="Dai La Thien Ton Trong Sinh Do Thi",
            summary="Đại La Thiên Tôn bị phản bội tại tiên giới, trùng sinh về thời thiếu niên ở đô thị. Bắt đầu hành trình vả mặt kẻ thù và lấy lại đỉnh cao.",
            language="vi",
            status="NORMALIZED",
            quality_score=88.5,
        )
        db.add(content_item)
        db.commit()
        db.refresh(content_item)

        proc_run = ProcessingRun(
            job_id=crawl_job.id,
            content_id=content_item.id,
            processing_type="NORMALIZATION",
            status="SUCCEEDED",
        )
        db.add(proc_run)

        content_source = ContentSource(
            content_id=content_item.id,
            source_type="BILIBILI_STORY",
            source_external_id=f"story_{uuid.uuid4().hex[:8]}",
            source_title=content_item.canonical_title,
            is_primary=True,
        )
        db.add(content_source)

        story = Story(
            content_id=content_item.id,
            canonical_name=content_item.canonical_title,
            normalized_name=content_item.normalized_title,
            description=content_item.summary,
            total_episodes=3,
            completion_status="ONGOING",
            grouping_confidence=95.0,
        )
        db.add(story)
        db.commit()
        db.refresh(story)

        episodes = []
        for i in range(1, 4):
            ep = Episode(
                content_id=content_item.id,
                story_id=story.id,
                episode_number=i,
                episode_title=f"Tập {i}: {content_item.canonical_title} - Phần {i}",
                duration_seconds=180,
            )
            db.add(ep)
            episodes.append(ep)
        db.commit()

        print(f"-> CrawlJob ID: {crawl_job.id}")
        print(f"-> Primary Content Item ID: {content_item.id} ('{content_item.canonical_title}')")
        print(f"-> Story ID: {story.id} with {len(episodes)} Episodes")

        # 3. Trigger Auto Handoff (Module 1 -> Module 2 Boundary)
        print("\n[Step 3] Triggering Auto-Handoff from Crawl (Module 1 -> Module 2)...")
        auto_handoff_req = Module2AutoHandoffRequest(
            profile_id=profile.id,
            crawl_job_id=crawl_job.id,
            candidate_limit=10,
            max_related_items_per_primary=3,
            create_planning_job=True,
            planning_mode="SERIES",
            target_duration_seconds=60,
            preferred_part_count=3,
        )

        planning_service = PlanningService()
        handoff, planning_job = planning_service.create_auto_handoff_from_crawl(db, auto_handoff_req, user)

        print(f"-> Created Handoff ID: {handoff.id}")
        print(f"   Status: {handoff.status}")
        print(f"   Eligible Items: {handoff.eligible_count}, Rejected Items: {handoff.rejected_count}")
        print(f"-> Created PlanningJob ID: {planning_job.id if planning_job else None}")

        # Check Profile Content Links
        links = db.query(ProfileContentLink).filter(ProfileContentLink.profile_id == profile.id).all()
        print(f"-> Profile Content Memory updated: {len(links)} links recorded")

        # 4. Execute Planning Pipeline (Module 2 Orchestration)
        print("\n[Step 4] Running PlanningPipeline Orchestrator...")
        pipeline = PlanningPipeline()
        pipeline._run(db, planning_job)

        db.refresh(planning_job)
        print(f"-> PlanningJob Final Status: {planning_job.status}")
        print(f"   Stage: {planning_job.current_stage}")
        print(f"   Progress: {planning_job.progress_percent}%")

        # Verify Created Plan, Series & Parts
        plan = planning_job.plans[0] if planning_job.plans else None
        assert plan is not None, "ContentPlan was not created!"
        print(f"\n[Step 5] Content Plan Generated:")
        print(f"   Plan Title: {plan.title}")
        print(f"   Angle: {plan.content_angle}")
        print(f"   Tone: {plan.tone}")
        print(f"   Status: {plan.status}")
        print(f"   Format: {plan.format}")
        print(f"   Planning Mode: {plan.planning_mode}")

        series = plan.series
        assert series is not None, "ContentSeries was not created!"
        print(f"\n[Step 6] Content Series Generated:")
        print(f"   Series Title: {series.title}")
        print(f"   Total Parts: {series.total_parts}")
        print(f"   Status: {series.status}")

        for part in series.parts:
            print(f"   - Part {part.part_number} ({part.part_type}): {part.title}")
            print(f"     Hook (3s): {part.hook_direction}")
            print(f"     Main Beats: {len(part.main_beats)} beats")

        # Verify Context Created
        assert len(series.contexts) > 0, "ContentContext record was not created!"
        print(f"\n[Step 7] Content Context Created:")
        print(f"   Context ID: {series.contexts[0].id}")
        print(f"   Mongo Reference ID: {series.contexts[0].mongo_document_id}")

        # 5. Verify Handoff Readiness & Module 3 Handoff
        print("\n[Step 8] Testing Handoff from Module 2 to Module 3...")
        plan.status = "APPROVED"
        series.status = "APPROVED"
        db.commit()

        mod3_req = Module3HandoffCreateRequest(
            profile_id=profile.id,
            content_plan_id=plan.id,
            content_series_id=series.id,
            handoff_note="E2E test handoff to video production engine",
        )

        mod3_handoff = Module3Handoff(
            user_id=user.id,
            profile_id=profile.id,
            content_plan_id=plan.id,
            content_series_id=series.id,
            status="READY",
            handoff_note=mod3_req.handoff_note,
            payload={
                "plan_title": plan.title,
                "total_parts": series.total_parts,
            },
        )
        db.add(mod3_handoff)
        db.commit()
        db.refresh(mod3_handoff)

        print(f"-> Created Module 3 Handoff ID: {mod3_handoff.id}")
        print(f"   Status: {mod3_handoff.status}")

        print("\n" + "=" * 80)
        print("SUCCESS! END-TO-END MODULE 1 -> MODULE 2 INTEGRATION VERIFIED OK!")
        print("=" * 80)

    finally:
        db.close()


if __name__ == "__main__":
    run_e2e_test()
