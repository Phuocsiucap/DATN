from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.routes import generate_video as video_route
from app.api.routes import social_profiles as profile_route
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
        self.workflow = SimpleNamespace(status="RENDERED", current_stage="WAITING_HUMAN_REVIEW", metadata_json={})
        self.enterContext(patch.object(self.service, "find_workflow_for_queue_item", return_value=self.workflow))
        self.enterContext(patch.object(self.service, "get_owned_queue_item", return_value=self.item))
        self.enterContext(patch.object(self.service, "require_queue_draft_ready"))
        self.choose = self.enterContext(patch.object(social_profiles, "choose_publish_schedule", return_value=PublishScheduleDecision(self.future, "Đã kiểm tra giờ và hàng đợi", "deepseek")))

    def test_omitted_request_timezone_does_not_override_profile(self):
        self.assertIsNone(QueueApproveScheduleRequest().timezone)
        result = self.service.approve_and_schedule_queue_item(self.db, self.item.id, self.user, schedule_mode="ai")
        self.assertEqual(result.scheduled_at, self.future)
        self.assertEqual(result.status, "approved")
        self.assertIn("Đã kiểm tra giờ và hàng đợi", result.ai_reason)
        self.assertEqual(self.choose.call_args.kwargs["timezone_name"], "America/New_York")
        self.assertIs(self.choose.call_args.args[2], self.item)
        self.db.commit.assert_called_once()

    def test_no_slots_returns_client_error_without_committing(self):
        self.choose.side_effect = ValueError("Không còn khung giờ trống")
        with self.assertRaises(HTTPException) as raised:
            self.service.approve_and_schedule_queue_item(self.db, self.item.id, self.user, schedule_mode="ai")
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(self.item.status, "needs_approval")
        self.db.commit.assert_not_called()

    def test_manual_schedule_does_not_call_deepseek(self):
        result = self.service.approve_and_schedule_queue_item(
            self.db, self.item.id, self.user, schedule_mode="manual", scheduled_at=self.future,
        )
        self.assertEqual(result.scheduled_at, self.future)
        self.assertEqual(self.workflow.status, "QUEUED_FOR_PUBLISHING")
        self.assertTrue(self.workflow.metadata_json["video_approved"])
        self.choose.assert_not_called()

    def test_plain_approval_clears_legacy_schedule_and_never_calls_planner_or_publisher(self):
        self.item.scheduled_at = self.future
        self.profile.strategy.auto_queue_enabled = True
        self.profile.strategy.auto_publish_enabled = True
        with patch.object(self.service, "publish_queue_item_to_tiktok") as publish:
            result = self.service.approve_queue_item(self.db, self.item.id, self.user)
        self.assertEqual(result.status, "approved")
        self.assertIsNone(result.scheduled_at)
        self.assertIsNone(result.error)
        self.assertEqual(self.workflow.status, "VIDEO_APPROVED")
        self.assertEqual(self.workflow.metadata_json["queued_post_id"], str(self.item.id))
        self.assertIsNone(self.workflow.metadata_json["module4_queue"]["scheduled_at"])
        self.choose.assert_not_called()
        publish.assert_not_called()
        self.db.commit.assert_called_once()

    def test_scheduling_auto_approved_video_preserves_original_approval(self):
        self.item.status = "approved"
        review = {"decision": "approved", "mode": "auto", "reason": "Strategy auto approval"}
        self.workflow.metadata_json = {"video_approved": True, "video_approved_at": "2026-08-31T00:00:00Z", "module4_review": review}
        result = self.service.approve_and_schedule_queue_item(self.db, self.item.id, self.user, scheduled_at=self.future)
        self.assertEqual(result.scheduled_at, self.future)
        self.assertEqual(self.workflow.metadata_json["module4_review"], review)
        self.assertEqual(self.workflow.metadata_json["video_approved_at"], "2026-08-31T00:00:00Z")
        self.assertNotIn("video_approved_by", self.workflow.metadata_json)
        self.assertEqual(self.workflow.status, "QUEUED_FOR_PUBLISHING")
        self.choose.assert_not_called()

    def test_approval_response_exposes_strategy_without_inventing_a_schedule(self):
        self.item.content_id = None
        self.item.article_link = "video.mp4"
        self.profile.username = "test"
        self.profile.avatar_url = None
        self.profile.user = None
        self.profile.strategy.approval_mode = "auto"
        self.profile.strategy.auto_queue_enabled = False
        self.profile.strategy.auto_publish_enabled = False
        data = dict.fromkeys(["id", "profile_id", "profile_name", "profile_scopes", "content_id", "article_title", "generated_content", "ai_reason", "scheduled_at", "published_at", "created_at", "updated_at", "error"])
        data.update(status="approved", platform="tiktok")
        result = profile_route._serialize_approval_queue_item(self.db, self.item, data, ZoneInfo("Asia/Bangkok"))
        self.assertEqual(result["profile_strategy"], {"approval_mode": "auto", "auto_queue_enabled": False, "auto_publish_enabled": False})
        self.assertEqual(result["status"], "approved")
        self.assertIsNone(result["scheduled_at"])
        self.assertIsNone(result["scheduled_at_local"])

    def test_generic_approve_status_also_cannot_activate_an_old_schedule(self):
        self.item.scheduled_at = self.future
        result = self.service.update_queue_status(self.db, self.item.id, self.user, "approved")
        self.assertEqual(result.status, "approved")
        self.assertIsNone(result.scheduled_at)
        self.choose.assert_not_called()

    def test_plain_approval_checks_draft_and_preserves_state_on_failure(self):
        self.item.scheduled_at = self.future
        with patch.object(self.service, "require_queue_draft_ready", side_effect=HTTPException(409, "Draft cần duyệt lại")):
            with self.assertRaises(HTTPException):
                self.service.approve_queue_item(self.db, self.item.id, self.user)
        self.assertEqual(self.item.status, "needs_approval")
        self.assertEqual(self.item.scheduled_at, self.future)
        self.db.commit.assert_not_called()

    def test_plain_approval_and_scheduling_cannot_change_inflight_or_finished_posts(self):
        for item_status in ("publishing", "published", "skipped", "rejected"):
            self.item.status = item_status
            for method in (self.service.approve_queue_item, self.service.approve_and_schedule_queue_item):
                with self.subTest(item_status=item_status, method=method.__name__):
                    with self.assertRaises(HTTPException):
                        method(self.db, self.item.id, self.user)
                    self.assertEqual(self.item.status, item_status)
        self.choose.assert_not_called()
        self.db.commit.assert_not_called()

    def test_missing_schedule_mode_defaults_to_manual_and_requires_a_time(self):
        self.assertEqual(QueueApproveScheduleRequest().schedule_mode, "manual")
        with self.assertRaises(HTTPException) as raised:
            self.service.approve_and_schedule_queue_item(self.db, self.item.id, self.user)
        self.assertIn("scheduled_at", raised.exception.detail)
        self.choose.assert_not_called()
        self.db.commit.assert_not_called()

    def test_manual_schedule_keeps_exact_offset_and_rejects_past_time(self):
        chosen = datetime(2099, 1, 2, 20, 15, tzinfo=timezone(timedelta(hours=7)))
        result = self.service.approve_and_schedule_queue_item(self.db, self.item.id, self.user, scheduled_at=chosen)
        self.assertEqual(result.scheduled_at, datetime(2099, 1, 2, 13, 15, tzinfo=timezone.utc))
        self.choose.assert_not_called()
        self.db.commit.reset_mock()
        with self.assertRaises(HTTPException):
            self.service.approve_and_schedule_queue_item(self.db, self.item.id, self.user, scheduled_at=datetime(2000, 1, 1, tzinfo=timezone.utc))
        self.assertEqual(self.item.scheduled_at, datetime(2099, 1, 2, 13, 15, tzinfo=timezone.utc))
        self.db.commit.assert_not_called()

    def test_http_approval_and_manual_schedule_are_separate_actions(self):
        app = FastAPI()
        app.include_router(profile_route.router, prefix="/social-profiles")
        app.dependency_overrides[profile_route.get_db] = lambda: self.db
        app.dependency_overrides[profile_route.get_current_user] = lambda: self.user
        def serialize(db, service, item, view, tzinfo):
            return {"id": str(item.id), "status": item.status, "scheduled_at": item.scheduled_at}
        with patch.object(profile_route, "SocialProfileService", return_value=self.service), patch.object(profile_route, "_serialize_queue_response_item", side_effect=serialize), TestClient(app) as client:
            self.item.scheduled_at = self.future
            response = client.post(f"/social-profiles/queue/items/{self.item.id}/approve")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "approved")
            self.assertIsNone(response.json()["scheduled_at"])
            response = client.post(f"/social-profiles/queue/items/{self.item.id}/approve-schedule", json={})
            self.assertEqual(response.status_code, 400)
            self.assertIsNone(self.item.scheduled_at)
            response = client.post(f"/social-profiles/queue/items/{self.item.id}/approve-schedule", json={
                "schedule_mode": "manual", "scheduled_at": "2099-01-02T20:15:00+07:00", "timezone": "Asia/Bangkok",
            })
            self.assertEqual(response.status_code, 200)
            self.assertEqual(datetime.fromisoformat(response.json()["scheduled_at"]), datetime(2099, 1, 2, 13, 15, tzinfo=timezone.utc))
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
