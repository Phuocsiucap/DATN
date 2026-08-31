from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.api.routes import generate_video as video_route
from app.schemas.social_profiles import QueueApproveScheduleRequest
from app.services import social_profiles
from common.planning.publishing_schedule import PublishScheduleDecision


class PublishingScheduleApiTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.profile = SimpleNamespace(id=uuid.uuid4(), platform="tiktok", strategy=SimpleNamespace(schedule_timezone="America/New_York"))
        self.user = SimpleNamespace(id=uuid.uuid4())
        self.item = SimpleNamespace(
            id=uuid.uuid4(), profile_id=self.profile.id, profile=self.profile, platform="tiktok",
            status="needs_approval", scheduled_at=None, error="old", ai_reason="Video đã duyệt",
            generated_content=None,
        )
        self.future = datetime.now(timezone.utc) + timedelta(days=2)
        self.service = social_profiles.SocialProfileService()
        self.enterContext(patch.object(self.service, "get_owned_queue_item", return_value=self.item))
        self.enterContext(patch.object(self.service, "require_queue_draft_ready"))
        self.choose = self.enterContext(patch.object(social_profiles, "choose_publish_schedule", return_value=PublishScheduleDecision(self.future, "Đã kiểm tra giờ và hàng đợi", "deepseek")))

    def test_omitted_request_timezone_does_not_override_profile(self):
        self.assertIsNone(QueueApproveScheduleRequest().timezone)
        result = self.service.approve_and_schedule_queue_item(self.db, self.item.id, self.user)
        self.assertEqual(result.scheduled_at, self.future)
        self.assertEqual(result.status, "approved")
        self.assertIn("Đã kiểm tra giờ và hàng đợi", result.ai_reason)
        self.assertEqual(self.choose.call_args.kwargs["timezone_name"], "America/New_York")
        self.assertIs(self.choose.call_args.args[2], self.item)
        self.db.commit.assert_called_once()

    def test_no_slots_returns_client_error_without_committing(self):
        self.choose.side_effect = ValueError("Không còn khung giờ trống")
        with self.assertRaises(HTTPException) as raised:
            self.service.approve_and_schedule_queue_item(self.db, self.item.id, self.user)
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(self.item.status, "needs_approval")
        self.db.commit.assert_not_called()

    def test_manual_schedule_does_not_call_deepseek(self):
        result = self.service.approve_and_schedule_queue_item(
            self.db, self.item.id, self.user, schedule_mode="manual", scheduled_at=self.future,
        )
        self.assertEqual(result.scheduled_at, self.future)
        self.choose.assert_not_called()

    def test_video_queue_uses_same_planner_and_saves_reason(self):
        project = SimpleNamespace(id=uuid.uuid4(), user_id=self.user.id, primary_content_id=None, title="Video mới", metadata_json={})
        decision = PublishScheduleDecision(self.future, "Lịch trống theo giờ tài khoản", "deepseek")
        with patch.object(video_route, "_require_auto_draft_production_ready"), patch.object(video_route, "_rendered_video_uri", return_value="video.mp4"), patch.object(video_route, "choose_publish_schedule", return_value=decision) as choose:
            item = video_route._queue_project_video(self.db, project, self.profile, {}, {}, requested_status="approved", reason="Đã duyệt")
        self.assertEqual(item.scheduled_at, self.future)
        self.assertIn(decision.reason, item.ai_reason)
        self.assertIn(decision.reason, project.metadata_json["module4_queue"]["reason"])
        self.assertIs(choose.call_args.args[2], item)
        self.db.commit.assert_not_called()

    def test_existing_video_reservation_is_kept_without_extra_model_call(self):
        self.item.scheduled_at = self.future
        self.db.get.return_value = self.item
        project = SimpleNamespace(id=uuid.uuid4(), user_id=self.user.id, primary_content_id=None, title="Video mới", metadata_json={})
        with patch.object(video_route, "_require_auto_draft_production_ready"), patch.object(video_route, "_rendered_video_uri", return_value="video.mp4"), patch.object(video_route, "choose_publish_schedule") as choose:
            item = video_route._queue_project_video(self.db, project, self.profile, {}, {"queued_post_id": str(self.item.id)}, requested_status="approved", reason="Đã duyệt")
        self.assertEqual(item.scheduled_at, self.future)
        choose.assert_not_called()

    def test_video_queue_replaces_stale_time_via_shared_planner(self):
        self.item.scheduled_at = datetime.now(timezone.utc) - timedelta(days=1)
        self.db.get.return_value = self.item
        project = SimpleNamespace(id=uuid.uuid4(), user_id=self.user.id, primary_content_id=None, title="Video mới", metadata_json={})
        with patch.object(video_route, "_require_auto_draft_production_ready"), patch.object(video_route, "_rendered_video_uri", return_value="video.mp4"), patch.object(video_route, "choose_publish_schedule", return_value=PublishScheduleDecision(self.future, "Đã chọn giờ mới", "rules")) as choose:
            item = video_route._queue_project_video(self.db, project, self.profile, {}, {"queued_post_id": str(self.item.id)}, requested_status="approved", reason="Đã duyệt")
        self.assertEqual(item.scheduled_at, self.future)
        choose.assert_called_once()


if __name__ == "__main__":
    unittest.main()
