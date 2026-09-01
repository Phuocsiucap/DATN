from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.video.services import generate_video_jobs as jobs
from common.planning import publishing_schedule as scheduling


class RenderQueueScheduleTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.profile = SimpleNamespace(id=uuid.uuid4(), platform="tiktok", strategy=SimpleNamespace(approval_mode="auto", auto_queue_enabled=True, auto_publish_enabled=True))
        self.project = SimpleNamespace(id=uuid.uuid4(), profile_id=self.profile.id, user_id=uuid.uuid4(), primary_content_id=None, title="Video mới", metadata_json={})
        self.db.get.return_value = self.profile
        self.enterContext(patch.object(jobs, "auto_production_allowed", return_value=True))
        self.future = datetime.now(timezone.utc) + timedelta(days=1)
        self.choose = self.enterContext(patch.object(scheduling, "choose_publish_schedule", return_value=scheduling.PublishScheduleDecision(self.future, "Lịch trống đã được kiểm tra", "deepseek")))

    def test_auto_render_uses_shared_planner(self):
        jobs._apply_module4_policy_after_render(self.db, self.project, "video.mp4", {})
        item = self.db.add.call_args.args[0]
        self.assertEqual(item.scheduled_at, self.future)
        self.assertEqual(item.status, "approved")
        self.assertIn("Lịch trống đã được kiểm tra", item.ai_reason)
        self.assertEqual(self.project.metadata_json["module4_queue"]["scheduled_at"], self.future.isoformat())
        self.assertIs(self.choose.call_args.args[2], item)

    def test_auto_review_without_auto_schedule_stays_approved_without_a_publish_job(self):
        self.profile.strategy.auto_queue_enabled = False
        jobs._apply_module4_policy_after_render(self.db, self.project, "video.mp4", {})
        self.assertTrue(self.project.metadata_json["video_approved"])
        self.assertEqual(self.project.status, "VIDEO_APPROVED")
        self.choose.assert_not_called()
        self.db.add.assert_not_called()

    def test_full_calendar_keeps_approval_and_waits_for_schedule_without_failing_render(self):
        self.choose.side_effect = ValueError("Không còn khung giờ trống")
        jobs._apply_module4_policy_after_render(self.db, self.project, "video.mp4", {})
        item = self.db.add.call_args.args[0]
        self.assertIsNone(item.scheduled_at)
        self.assertEqual(item.status, "approved")
        self.assertIn("Cần chọn lịch", item.ai_reason)
        self.assertEqual(self.project.status, "VIDEO_APPROVED")
        self.assertTrue(self.project.metadata_json["video_approved"])

    def test_manual_review_does_not_schedule_or_call_ai(self):
        self.profile.strategy.approval_mode = "manual"
        jobs._apply_module4_policy_after_render(self.db, self.project, "video.mp4", {})
        self.choose.assert_not_called()
        self.assertEqual(self.project.current_stage, "WAITING_HUMAN_REVIEW")


if __name__ == "__main__":
    unittest.main()
