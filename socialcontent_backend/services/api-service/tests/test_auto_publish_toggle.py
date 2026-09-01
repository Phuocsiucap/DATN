from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from pydantic import ValidationError

from app.schemas.social_profiles import SocialProfileStrategyRequest, SocialProfileStrategyResponse
from app.services import publish_scheduler
from app.services.social_profiles import SocialProfileService
from common.db.models import SocialProfileStrategy


class AutoPublishStrategyTests(unittest.TestCase):
    def setUp(self):
        defaults = {
            column.name: column.default.arg
            for column in SocialProfileStrategy.__table__.columns
            if column.default is not None and column.default.is_scalar
        }
        self.strategy = SocialProfileStrategy(
            **defaults,
            id=uuid.uuid4(),
            content_topic_descriptions={},
            avoid_topic_descriptions={},
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.profile = SimpleNamespace(strategy=self.strategy)
        self.db = MagicMock()
        self.service = SocialProfileService()

    def test_one_toggle_can_enable_and_disable_without_changing_schedule(self):
        self.assertFalse(self.strategy.auto_publish_enabled)
        original_schedule = (self.strategy.schedule_days, self.strategy.schedule_times, self.strategy.schedule_timezone)
        for enabled in (True, False):
            with self.subTest(enabled=enabled):
                request = SocialProfileStrategyRequest(auto_publish_enabled=enabled)
                result = self.service.update_strategy(self.db, self.profile, request)
                response = SocialProfileStrategyResponse.model_validate(self.service.serialize_strategy(result))
                self.assertEqual(response.auto_publish_enabled, enabled)
                self.assertNotIn("schedule_enabled", response.model_dump())
                self.assertEqual((result.schedule_days, result.schedule_times, result.schedule_timezone), original_schedule)
        self.assertEqual(self.db.commit.call_count, 2)

    def test_unrelated_partial_update_preserves_publish_opt_in(self):
        self.strategy.auto_publish_enabled = True
        request = SocialProfileStrategyRequest(tone="Casual")
        self.assertNotIn("auto_publish_enabled", request.model_dump(exclude_unset=True))
        self.service.update_strategy(self.db, self.profile, request)
        self.assertTrue(self.strategy.auto_publish_enabled)

    def test_legacy_requests_are_rejected_instead_of_ignoring_old_disable_gate(self):
        for old_enabled in (True, False):
            for publish_enabled in (None, True, False):
                with self.subTest(old_enabled=old_enabled, publish_enabled=publish_enabled):
                    payload = {"schedule_enabled": old_enabled}
                    if publish_enabled is not None:
                        payload["auto_publish_enabled"] = publish_enabled
                    with self.assertRaisesRegex(ValidationError, "auto_publish_enabled"):
                        SocialProfileStrategyRequest.model_validate(payload)

    def test_null_toggle_is_rejected_before_database_write(self):
        with self.assertRaises(ValidationError):
            SocialProfileStrategyRequest(auto_publish_enabled=None)

    def test_contract_and_model_have_only_one_publish_toggle(self):
        for schema in (SocialProfileStrategyRequest, SocialProfileStrategyResponse):
            self.assertNotIn("schedule_enabled", schema.model_json_schema()["properties"])
        self.assertNotIn("schedule_enabled", SocialProfileStrategy.__table__.columns)


class AutoPublishSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        session = self.enterContext(patch.object(publish_scheduler, "SessionLocal"))
        session.return_value.__enter__.return_value = self.db
        service_class = self.enterContext(patch.object(publish_scheduler, "SocialProfileService"))
        self.service = service_class.return_value
        self.service.finalize_tiktok_publish_statuses.return_value = {"completed": 0, "failed": 0, "pending": 0}
        self.due_query = self.db.query.return_value.join.return_value.filter.return_value.order_by.return_value.limit.return_value

    def test_scheduler_uses_single_toggle_and_still_requires_approval(self):
        for enabled in (True, False):
            for approval_mode in ("manual", "auto"):
                for status in ("queued", "approved"):
                    with self.subTest(enabled=enabled, approval_mode=approval_mode, status=status):
                        # There is deliberately no legacy schedule_enabled attribute.
                        strategy = SimpleNamespace(auto_publish_enabled=enabled, approval_mode=approval_mode)
                        user = SimpleNamespace(id=uuid.uuid4())
                        item = SimpleNamespace(id=uuid.uuid4(), status=status, profile=SimpleNamespace(strategy=strategy, user=user))
                        self.due_query.all.return_value = [item]
                        self.service.publish_queue_item_to_tiktok.reset_mock()
                        result = publish_scheduler.run_publish_queue_once()
                        should_publish = enabled and (status == "approved" or approval_mode == "auto")
                        self.assertEqual(result["published"], int(should_publish))
                        self.assertEqual(result["skipped"], int(not should_publish))
                        if should_publish:
                            self.service.publish_queue_item_to_tiktok.assert_called_once_with(self.db, item.id, user, source="scheduler", mode="direct")
                        else:
                            self.service.publish_queue_item_to_tiktok.assert_not_called()

    def test_profile_without_strategy_does_not_publish(self):
        self.due_query.all.return_value = [SimpleNamespace(profile=SimpleNamespace(strategy=None))]
        result = publish_scheduler.run_publish_queue_once()
        self.assertEqual(result["skipped"], 1)
        self.service.publish_queue_item_to_tiktok.assert_not_called()


if __name__ == "__main__":
    unittest.main()
