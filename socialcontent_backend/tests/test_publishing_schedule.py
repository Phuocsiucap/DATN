from __future__ import annotations

import json
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from common.planning import publishing_schedule as scheduling


TZ = ZoneInfo("Asia/Bangkok")


def local(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=TZ)


def strategy(**kwargs):
    return SimpleNamespace(**{
        "schedule_days": "0,1,2,3,4,5,6", "schedule_times": "08:30,20:30",
        "schedule_timezone": TZ.key, "post_frequency_per_day": 2,
        "active_hours": "08:00-11:00,19:00-22:00", "target_audience": "Người xem Việt Nam",
        **kwargs,
    })


def queued(at=None, status="approved", **kwargs):
    return SimpleNamespace(**{
        "id": uuid.uuid4(), "article_title": "Video đã có trong hàng đợi", "generated_content": "Nội dung video",
        "status": status, "scheduled_at": at, "published_at": None,
        **kwargs,
    })


def profile(**kwargs):
    return SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4(), platform="tiktok", strategy=strategy(**kwargs))


class ScheduleSlotTests(unittest.TestCase):
    def slots(self, *, now="2026-08-31T07:00:00", rows=None, exclude=None, **kwargs):
        return scheduling.available_schedule_slots(
            strategy(**kwargs), now=local(now), tzinfo=TZ, queue_items=rows or [], exclude_item_id=exclude,
        )

    def test_uses_profile_local_time_and_returns_aware_utc(self):
        first = self.slots()[0]
        self.assertEqual(first, datetime(2026, 8, 31, 1, 30, tzinfo=timezone.utc))
        self.assertEqual(first.tzinfo, timezone.utc)

    def test_sorts_and_deduplicates_unsorted_hours(self):
        self.assertEqual(self.slots(schedule_times="20:30,08:30,08:30")[0], local("2026-08-31T08:30:00"))

    def test_skips_past_hours_and_rolls_over_to_next_day(self):
        self.assertEqual(self.slots(now="2026-08-31T21:00:00")[0], local("2026-09-01T08:30:00"))

    def test_respects_five_minute_lead_boundary(self):
        self.assertEqual(self.slots(now="2026-08-31T20:25:00")[0], local("2026-09-01T08:30:00"))

    def test_all_active_queue_states_reserve_their_slots(self):
        for status in scheduling.RESERVED_STATUSES:
            with self.subTest(status=status):
                self.assertEqual(self.slots(rows=[queued(local("2026-08-31T08:30:00"), status)])[0], local("2026-08-31T20:30:00"))

    def test_skipped_failed_and_changes_requested_do_not_reserve_slots(self):
        for status in ("skipped", "failed", "changes_requested"):
            self.assertEqual(self.slots(rows=[queued(local("2026-08-31T08:30:00"), status)])[0], local("2026-08-31T08:30:00"))

    def test_rescheduling_excludes_the_current_item(self):
        item = queued(local("2026-08-31T08:30:00"))
        self.assertEqual(self.slots(rows=[item], exclude=item.id)[0], item.scheduled_at)

    def test_avoids_nearby_manual_reservations(self):
        self.assertEqual(self.slots(rows=[queued(local("2026-08-31T08:45:00"))])[0], local("2026-08-31T20:30:00"))

    def test_local_day_capacity_includes_published_posts(self):
        rows = [queued(status="published", published_at=local("2026-08-31T00:15:00")), queued(local("2026-08-31T08:30:00"))]
        self.assertEqual(self.slots(rows=rows)[0], local("2026-09-01T08:30:00"))

    def test_overdue_executable_posts_count_against_today(self):
        rows = [queued(local("2026-08-30T08:30:00")), queued(local("2026-08-30T20:30:00"))]
        self.assertEqual(self.slots(rows=rows)[0], local("2026-09-01T08:30:00"))

    def test_unscheduled_review_draft_does_not_reserve_capacity(self):
        self.assertEqual(self.slots(rows=[queued(status="needs_approval")])[0], local("2026-08-31T08:30:00"))

    def test_respects_local_weekdays_around_utc_date_boundary(self):
        first = self.slots(now="2026-08-31T00:01:00", schedule_times="00:30", schedule_days="0")[0]
        self.assertEqual(first, datetime(2026, 8, 30, 17, 30, tzinfo=timezone.utc))

    def test_skips_invalid_clock_values_without_crashing(self):
        self.assertEqual(self.slots(schedule_times="99:99,-1:30,oops,08:30,12:00:00")[0], local("2026-08-31T08:30:00"))

    def test_without_configured_times_still_respects_days_capacity_and_queue(self):
        rows = [queued(local("2026-08-31T09:00:00"))]
        first = self.slots(rows=rows, schedule_times="", post_frequency_per_day=1, schedule_days="0")[0]
        self.assertEqual(first.astimezone(TZ).date().isoformat(), "2026-09-07")

    def test_missing_strategy_produces_future_slot(self):
        now = local("2026-08-31T07:15:00")
        first = scheduling.available_schedule_slots(None, now=now, tzinfo=TZ, queue_items=[])[0]
        self.assertGreater(first, now + timedelta(hours=1))

    def test_searches_beyond_the_old_eight_day_window(self):
        rows = [queued(local("2026-08-31T08:30:00") + timedelta(days=index)) for index in range(9)]
        self.assertEqual(self.slots(rows=rows, post_frequency_per_day=1)[0], local("2026-09-09T08:30:00"))

    def test_full_horizon_does_not_invent_an_off_schedule_fallback(self):
        rows = [queued(local("2026-08-31T08:30:00") + timedelta(days=index)) for index in range(90)]
        self.assertEqual(self.slots(rows=rows, post_frequency_per_day=1), [])

    def test_naive_legacy_timestamps_are_interpreted_as_utc(self):
        rows = [queued(datetime(2026, 8, 31, 1, 30))]
        self.assertEqual(self.slots(rows=rows)[0], local("2026-08-31T20:30:00"))

    def test_nonexistent_dst_hour_is_skipped(self):
        tz = ZoneInfo("Europe/Paris")
        slots = scheduling.available_schedule_slots(
            strategy(schedule_times="02:30,04:00"), now=datetime(2026, 3, 29, 0, 0, tzinfo=timezone.utc),
            tzinfo=tz, queue_items=[],
        )
        self.assertEqual(slots[0].astimezone(tz).strftime("%Y-%m-%d %H:%M"), "2026-03-29 04:00")

    def test_invalid_timezone_falls_back_to_bangkok(self):
        self.assertEqual(scheduling.schedule_timezone("Not/AZone").key, "Asia/Bangkok")


class DeepSeekScheduleTests(unittest.TestCase):
    def setUp(self):
        self.profile, self.item = profile(), queued(status="needs_approval")
        self.now = local("2026-08-31T07:00:00").astimezone(timezone.utc)
        self.rows = [queued(local("2026-08-31T08:30:00"))]
        self.db, self.query = MagicMock(), MagicMock()
        self.db.query.return_value = self.query
        for name in ("filter", "order_by", "populate_existing", "with_for_update"):
            getattr(self.query, name).return_value = self.query
        self.query.all.return_value = self.rows
        self.clock = self.enterContext(patch.object(scheduling, "datetime", wraps=datetime))
        self.clock.now.return_value = self.now
        self.settings = self.enterContext(patch.object(scheduling, "get_settings"))
        self.settings.return_value = SimpleNamespace(deepseek_api_key="test-key", deepseek_base_url="https://api.deepseek.com", openai_api_key="unused")
        self.llm = self.enterContext(patch.object(scheduling, "deepseek_chat_completion"))
        self.llm.return_value.parsed_json.return_value = {"slot_id": "slot_1", "reason": "Tránh dồn nội dung cùng chủ đề."}
        self.log = self.enterContext(patch.object(scheduling, "log_prompt_run"))

    def choose(self, **kwargs):
        return scheduling.choose_publish_schedule(self.db, self.profile, self.item, **kwargs)

    def test_prompt_has_real_clock_timezone_current_post_and_existing_queue(self):
        decision = self.choose()
        request = self.llm.call_args.kwargs
        context = json.loads(request["messages"][1]["content"])
        self.assertEqual(context["current_time_local"], "2026-08-31T07:00:00+07:00")
        self.assertEqual(context["current_time_utc"], "2026-08-31T00:00:00+00:00")
        self.assertEqual(context["timezone"], TZ.key)
        self.assertEqual(context["current_post"]["id"], str(self.item.id))
        self.assertEqual(context["queue"][0]["id"], str(self.rows[0].id))
        self.assertEqual(context["queue"][0]["title"], self.rows[0].article_title)
        self.assertEqual(context["candidate_slots"][0]["local"], "2026-08-31T20:30:00+07:00")
        self.assertEqual(request["api_key"], "test-key")
        self.assertEqual(request["model"], "deepseek-v4-flash")
        self.assertEqual(decision.provider, "deepseek")
        self.assertEqual(decision.scheduled_at, datetime.fromisoformat(context["candidate_slots"][1]["utc"]))
        self.query.with_for_update.assert_called_once()
        self.db.commit.assert_not_called()
        self.log.assert_called_once()

    def test_query_is_scoped_to_profile_and_excludes_current_item(self):
        self.choose()
        expressions = [expression for call in self.query.filter.call_args_list for expression in call.args]
        params = [value for expression in expressions for value in expression.compile().params.values()]
        self.assertIn(self.profile.id, params)
        self.assertIn(self.item.id, params)
        self.query.populate_existing.assert_called_once()

    def test_no_deepseek_key_uses_rules_even_if_openai_is_configured(self):
        self.settings.return_value.deepseek_api_key = ""
        decision = self.choose()
        self.llm.assert_not_called()
        self.assertEqual(decision.provider, "rules")
        self.assertIn("Chưa cấu hình API DeepSeek", decision.reason)
        self.assertEqual(decision.scheduled_at, local("2026-08-31T20:30:00"))

    def test_rule_only_mode_does_not_call_ai(self):
        self.assertEqual(self.choose(use_ai=False).provider, "rules")
        self.llm.assert_not_called()

    def test_invalid_model_output_cannot_bypass_slot_validation(self):
        for answer in ({"slot_id": "yesterday"}, {"slot_id": []}, [], {"scheduled_at": "2020-01-01T00:00:00Z"}):
            with self.subTest(answer=answer):
                self.llm.return_value.parsed_json.return_value = answer
                decision = self.choose()
                self.assertEqual(decision.provider, "rules")
                self.assertEqual(decision.scheduled_at, local("2026-08-31T20:30:00"))

    def test_deepseek_timeout_falls_back_to_safe_slot(self):
        self.llm.side_effect = TimeoutError("No response")
        self.assertEqual(self.choose().scheduled_at, local("2026-08-31T20:30:00"))

    def test_rechecks_clock_after_model_response(self):
        self.rows.clear()
        self.clock.now.side_effect = [local("2026-08-31T08:24:55"), local("2026-08-31T08:25:10")]
        self.llm.return_value.parsed_json.return_value = {"slot_id": "slot_0"}
        decision = self.choose()
        self.assertEqual(decision.scheduled_at, local("2026-08-31T20:30:00"))
        self.assertEqual(decision.provider, "rules")

    def test_context_truncation_does_not_truncate_reservations(self):
        self.rows[:] = [queued(status="needs_approval") for _ in range(101)] + [queued(local("2026-08-31T08:30:00"))]
        self.choose()
        context = json.loads(self.llm.call_args.kwargs["messages"][1]["content"])
        self.assertEqual(context["queue_total"], 102)
        self.assertTrue(context["queue_truncated"])
        self.assertEqual(len(context["queue"]), 100)
        self.assertEqual(context["candidate_slots"][0]["local"], "2026-08-31T20:30:00+07:00")

    def test_no_valid_slot_stops_before_calling_ai(self):
        self.profile.strategy.post_frequency_per_day = 1
        self.rows[:] = [queued(local("2026-08-31T08:30:00") + timedelta(days=index)) for index in range(90)]
        with self.assertRaisesRegex(ValueError, "90 ngày"):
            self.choose()
        self.llm.assert_not_called()


if __name__ == "__main__":
    unittest.main()
