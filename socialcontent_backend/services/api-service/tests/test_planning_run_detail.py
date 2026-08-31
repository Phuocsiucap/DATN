from copy import deepcopy
from datetime import datetime, timezone
import json
from types import SimpleNamespace as Row
import unittest
from unittest.mock import MagicMock
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import planning_runs as route
from app.services.planning_run_detail import build_planning_run_detail, compact_planning_run_detail


def query(rows):
    result = MagicMock()
    for method in ("filter", "outerjoin", "order_by"):
        getattr(result, method).return_value = result
    result.all.return_value = rows
    result.first.return_value = rows[0] if rows else None
    return result


class PlanningDetailTests(unittest.TestCase):
    def setUp(self):
        now = datetime.now(timezone.utc)
        self.user = Row(id=uuid.uuid4(), is_system_admin=False)
        self.profile = Row(id=uuid.uuid4(), profile_name="Test profile")
        self.crawl = Row(id=uuid.uuid4(), name="Test crawl")
        self.run = Row(
            id=uuid.uuid4(), user_id=self.user.id, profile_id=self.profile.id,
            crawl_job_id=self.crawl.id, workflow_id=None, status="SUCCEEDED", planning_mode="AUTO",
            input_jsonb={"candidate_count": 999, "strategy_similarity_threshold": 0.35},
            output_jsonb={}, reason_jsonb={"trigger": "crawl_job_completed"},
            metadata_json={"selection_algorithm": "production_gate_compact_draft_v3", "internal": "private"},
            started_at=now, completed_at=now, created_at=now, updated_at=now,
        )
        self.raw = {
            "status": "DRAFT_REVIEW_REQUIRED", "should_create_workflow": True,
            "plan_title": "Draft title", "model": "test-model", "confidence_score": 0,
            "production_gate": {"status": "PRODUCE", "source": "RULE", "confidence_score": 0, "reason_code": "MATCH", "reason": "Matched source", "internal": "private"},
            "quality": {"score": 83, "status": "REVIEW_REQUIRED", "retry_count": 1, "issues": [{"code": "SCENE_REPETITION", "scene_indexes": [4, 5], "details": {"pairs": [[4, 5]]}}]},
            "series_decision": {"action": "CREATE_NEW", "series_title": "Series title", "reusable_followup_angles": ["One", "Two", "Three"]},
            "token_usage": {"input_tokens": 100, "output_tokens": 20, "creative_call_count": 2, "fit_judge_call_count": 0},
        }
        self.topic = {"topic": "Technology", "topic_key": "tech", "description": "Shared topic description. " * 30, "similarity": 0.5, "threshold": 0.35, "matched": True}
        self.candidate = Row(
            id=uuid.uuid4(), content_id=uuid.uuid4(), workflow_id=None, canonical_title="Article", summary="Source summary",
            rank_order=1, score=50, selected=True, eligible=True,
            reason_jsonb={"ai_decision": deepcopy(self.raw), "selection_reasons": ["Matched topic"], "internal": "private"},
            metadata_json={"ai_decision": deepcopy(self.raw), "topic_scores": [deepcopy(self.topic)], "embedding_similarity": 0.5,
                           "quality_score": 95, "similarity_threshold": 0.35, "avoid_similarity_threshold": 0.72},
        )

    def build(self, candidates=None, workflows=None):
        return build_planning_run_detail(self.run, self.profile, self.crawl,
                                         [self.candidate] if candidates is None else candidates,
                                         workflows or []).model_dump(mode="json")

    def compact(self, candidates=None, workflows=None):
        detail = build_planning_run_detail(self.run, self.profile, self.crawl,
            [self.candidate] if candidates is None else candidates, workflows or [])
        return compact_planning_run_detail(detail).model_dump(mode="json", exclude_none=True)

    def workflow(self, **changes):
        values = dict(id=uuid.uuid4(), primary_content_id=self.candidate.content_id, title="Current title",
                      status="EDITING", current_stage="DRAFT_REVIEW_REQUIRED", updated_at=self.run.updated_at,
                      series_id=None, series_title=None, metadata_json={"pending_series_decision": self.raw["series_decision"]})
        return Row(**(values | changes))

    def test_one_decision_and_no_storage_json_or_duplicate_ids(self):
        result = self.build()
        self.assertEqual(result["schema_version"], 2)
        for key in ("input", "output", "metadata", "reason", "workflow"):
            self.assertNotIn(key, result)
        candidate = result["candidates"][0]
        for key in ("metadata", "reason", "ai_decision", "media_workflow_id", "planning_run_id"):
            self.assertNotIn(key, candidate)
        self.assertNotIn("private", json.dumps(result))
        self.assertEqual(candidate["decision"]["draft"]["quality"]["issues"][0]["scene_indexes"], [4, 5])

    def test_builder_does_not_mutate_stored_snapshots(self):
        before = deepcopy((vars(self.run), vars(self.candidate)))
        self.build()
        self.assertEqual(before, (vars(self.run), vars(self.candidate)))

    def test_shared_topic_catalog_keeps_scores_per_candidate(self):
        other = deepcopy(self.candidate)
        other.id = uuid.uuid4()
        other.metadata_json["topic_scores"][0]["similarity"] = 0.2
        other.metadata_json["topic_scores"][0]["matched"] = False
        result = self.build([self.candidate, other])
        self.assertEqual(len(result["topics"]), 1)
        scores = [item["matching"]["topics"][0] for item in result["candidates"]]
        self.assertEqual(scores[0]["topic_id"], scores[1]["topic_id"])
        self.assertEqual([score["similarity"] for score in scores], [0.5, 0.2])
        self.assertFalse(scores[1]["matched"])

    def test_topic_kinds_and_historical_descriptions_are_not_conflated(self):
        self.candidate.metadata_json["avoid_topic_matches"] = [deepcopy(self.topic)]
        other = deepcopy(self.candidate)
        other.metadata_json["topic_scores"][0]["description"] = "A changed historical definition"
        result = self.build([self.candidate, other])
        self.assertEqual(len(result["topics"]), 3)
        self.assertEqual({topic["kind"] for topic in result["topics"]}, {"AVOID", "CONTENT"})

    def test_legacy_breakdown_and_keyword_only_avoid_are_preserved(self):
        self.candidate.metadata_json = {"score_breakdown": {"quality_score": 0, "embedding_similarity": 0,
            "similarity_threshold": 0, "blocked_by_avoid_topics": True, "avoided_topics": ["Forbidden"],
            "require_video": True, "has_required_video": False}}
        result = self.build()
        match = result["candidates"][0]["matching"]
        self.assertEqual(match["source_quality_score"], 0)
        self.assertEqual(match["similarity"], 0)
        self.assertTrue(match["blocked_by_avoid_topics"])
        self.assertTrue(match["avoid_topics"][0]["matched"])
        self.assertIsNone(match["avoid_topics"][0]["similarity"])
        self.assertFalse(match["has_required_video"])

    def test_zero_confidence_and_call_counts_are_not_lost(self):
        decision = self.build()["candidates"][0]["decision"]
        self.assertEqual(decision["production"]["confidence_score"], 0)
        self.assertEqual(decision["draft"]["confidence_score"], 0)
        self.assertEqual(decision["token_usage"]["fit_judge_call_count"], 0)

    def test_extra_legacy_reasoning_is_kept_without_repeating_gate_reason(self):
        self.candidate.reason_jsonb["ai_decision"]["reasoning"] = ["MATCH", "Matched source", "Additional evidence"]
        decision = self.build()["candidates"][0]["decision"]
        self.assertEqual(decision["notes"], ["Additional evidence"])

    def test_missing_usage_and_unrun_draft_are_unknown_not_success(self):
        self.candidate.reason_jsonb = {"ai_decision": {"status": "REVIEW_REQUIRED", "should_create_workflow": False,
            "production_gate": {"status": "REVIEW_REQUIRED", "source": "LLM"}}}
        decision = self.build()["candidates"][0]["decision"]
        self.assertIsNone(decision["token_usage"])
        self.assertIsNone(decision["draft"])
        self.assertIsNone(decision["series"])
        self.assertEqual(decision["status"], "REVIEW_REQUIRED")

    def test_output_fallback_is_matched_to_the_right_candidate(self):
        self.candidate.reason_jsonb = {}
        self.candidate.metadata_json = {}
        self.run.output_jsonb = {"ai_decision": {"candidate_id": str(uuid.uuid4()), "status": "WRONG"},
            "ai_decisions": [{**self.raw, "candidate_id": str(self.candidate.id)}]}
        self.assertEqual(self.build()["candidates"][0]["decision"]["status"], "DRAFT_REVIEW_REQUIRED")

    def test_current_workflow_never_overwrites_historical_quality(self):
        workflow = self.workflow(current_stage="VOICE_READY", metadata_json={"ai_decision": {"quality": {"status": "PASS"}}})
        self.candidate.workflow_id = workflow.id
        result = self.build(workflows=[workflow])
        self.assertEqual(result["candidates"][0]["decision"]["draft"]["quality"]["status"], "REVIEW_REQUIRED")
        self.assertEqual(result["workflows"][0]["current_stage"], "VOICE_READY")

    def test_pending_series_and_applied_series_are_separate(self):
        workflow = self.workflow()
        result = self.build(workflows=[workflow])
        self.assertTrue(result["workflows"][0]["pending_series"])
        self.assertIsNone(result["workflows"][0]["series"])
        self.assertEqual(result["candidates"][0]["decision"]["series"]["title"], "Series title")

    def test_unique_workflow_fallback_for_old_candidate_without_decision(self):
        workflow = self.workflow(metadata_json={"draft_quality": {"status": "PASS"}})
        self.candidate.reason_jsonb = self.candidate.metadata_json = {}
        result = self.build(workflows=[workflow])
        self.assertEqual(result["candidates"][0]["workflow_id"], str(workflow.id))
        self.assertEqual(result["candidates"][0]["decision"]["draft"]["quality"]["status"], "PASS")

    def test_ambiguous_workflow_fallback_does_not_pick_first(self):
        self.candidate.reason_jsonb = self.candidate.metadata_json = {}
        result = self.build(workflows=[self.workflow(), self.workflow()])
        self.assertIsNone(result["candidates"][0]["workflow_id"])
        self.assertIsNone(result["candidates"][0]["decision"])

    def test_deleted_content_and_empty_run_are_supported(self):
        self.candidate.content_id = self.candidate.canonical_title = self.candidate.summary = None
        self.assertIsNone(self.build()["candidates"][0]["content_id"])
        result = self.build([])
        self.assertEqual(result["summary"]["candidate_count"], 0)
        self.assertEqual(result["summary"]["production"], {})

    def test_summary_distinguishes_filter_production_and_draft(self):
        blocked = deepcopy(self.candidate)
        blocked.eligible = blocked.selected = False
        blocked.reason_jsonb = blocked.metadata_json = {}
        result = self.build([self.candidate, blocked])
        summary = result["summary"]
        self.assertEqual(summary["candidate_count"], 2)  # Not stale input_jsonb's 999.
        self.assertEqual(summary["filtered_count"], 1)
        self.assertEqual(summary["selected_count"], 1)
        self.assertEqual(summary["production"], {"PRODUCE": 1})
        self.assertEqual(summary["draft_quality"], {"REVIEW_REQUIRED": 1})

    def test_repeated_27_candidate_payload_is_substantially_smaller(self):
        candidates = [deepcopy(self.candidate) for _ in range(27)]
        for candidate in candidates:
            candidate.id = uuid.uuid4()
            candidate.metadata_json["topic_matches"] = deepcopy(candidate.metadata_json["topic_scores"])
            candidate.metadata_json["score_breakdown"] = deepcopy(candidate.metadata_json)
        old = {"candidates": [vars(candidate) for candidate in candidates], "output": {"ai_decisions": [self.raw] * 27}}
        new = self.build(candidates)
        self.assertLess(len(json.dumps(new)), len(json.dumps(old, default=str)) * 0.5)
        self.assertEqual(len(new["topics"]), 1)
        self.assertEqual(len(new["candidates"]), 27)

    def client(self, db):
        app = FastAPI()  # Do not start the production app's scheduler/bootstrap.
        app.include_router(route.router, prefix="/planning-runs")
        app.dependency_overrides[route.get_current_user] = lambda: self.user
        app.dependency_overrides[route.get_db] = lambda: db
        return TestClient(app)

    def test_http_contract_is_read_only_and_uses_batched_workflow_query(self):
        workflow = self.workflow()
        self.candidate.workflow_id = workflow.id
        db = MagicMock()
        db.get.return_value = self.run
        workflow_query = query([workflow])
        db.query.side_effect = [query([self.profile]), query([self.crawl]), query([self.candidate]), workflow_query]
        response = self.client(db).get(f"/planning-runs/{self.run.id}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["schema_version"], 3)
        self.assertNotIn("topics", response.json())
        self.assertNotIn("matching", response.json()["candidates"][0])
        self.assertNotIn("review", response.json()["candidates"][0])
        self.assertEqual(response.json()["summary"]["workflow_count"], 1)
        self.assertEqual(db.query.call_count, 4)
        filters = workflow_query.filter.call_args.args
        self.assertEqual(filters[1].right.value, self.run.user_id)
        self.assertEqual(filters[2].right.value, self.run.profile_id)
        for method in (db.commit, db.flush, db.add, db.delete):
            method.assert_not_called()

    def test_unauthorized_run_does_not_query_related_data(self):
        db = MagicMock()
        db.get.return_value = deepcopy(self.run)
        db.get.return_value.user_id = uuid.uuid4()
        response = self.client(db).get(f"/planning-runs/{self.run.id}")
        self.assertEqual(response.status_code, 404)
        db.query.assert_not_called()

    def test_missing_run_returns_404(self):
        db = MagicMock()
        db.get.return_value = None
        self.assertEqual(self.client(db).get(f"/planning-runs/{self.run.id}").status_code, 404)
        db.query.assert_not_called()

    def test_compact_keeps_every_candidate_and_summary_without_diagnostic_arrays(self):
        candidates = [deepcopy(self.candidate) for _ in range(26)]
        for index, item in enumerate(candidates):
            item.id = uuid.uuid4()
            item.metadata_json["topic_scores"] = [{**self.topic, "topic": f"Topic {n}"} for n in range(8)]
            if index >= 9:
                item.eligible = item.selected = False
                item.reason_jsonb = {}
                item.metadata_json.pop("ai_decision")
        full, result = self.build(candidates), self.compact(candidates)
        self.assertEqual(result["schema_version"], 3)
        self.assertEqual(len(result["candidates"]), 26)
        self.assertEqual(result["summary"], full["summary"])
        self.assertEqual([item["id"] for item in result["candidates"]], [item["id"] for item in full["candidates"]])
        size = lambda payload: len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())
        self.assertLess(size(result), size(full) * 0.3)
        for item in result["candidates"]:
            for key in ("matching", "decision", "summary", "selected", "review"):
                self.assertNotIn(key, item)

    def test_compact_preserves_source_review_actions_without_a_fake_workflow(self):
        self.candidate.selected = False
        self.candidate.reason_jsonb = {"ai_decision": {"status": "REVIEW_REQUIRED", "should_create_workflow": False,
            "production_gate": {"status": "REVIEW_REQUIRED", "source": "LLM", "reason": "Check relevance", "reason_code": "FIT"}}}
        result = self.compact()["candidates"][0]
        self.assertEqual(result["reason"], "Check relevance")
        self.assertTrue(result["review"]["can_approve"])
        self.assertTrue(result["review"]["can_reject"])
        self.assertFalse(result["review"]["can_retry"])
        self.assertNotIn("workflow_id", result)

    def test_compact_filter_reason_includes_all_known_hard_failures_and_zero_similarity(self):
        self.candidate.eligible = self.candidate.selected = False
        self.candidate.reason_jsonb = {}
        self.candidate.metadata_json = {"blocked_by_avoid_topics": True, "avoided_topics": ["Forbidden"],
            "require_video": True, "has_required_video": False, "embedding_similarity": 0, "similarity_threshold": 0.35}
        result = self.compact()["candidates"][0]
        self.assertEqual(result["status"], "FILTERED")
        self.assertEqual(result["similarity"], 0)
        self.assertIn("Forbidden", result["reason"])
        self.assertIn("video", result["reason"])
        self.assertIn("0.0000", result["reason"])
        self.assertEqual(result["reason_code"], "AVOID_TOPIC+MISSING_REQUIRED_VIDEO+BELOW_SIMILARITY_THRESHOLD")

    def test_compact_does_not_invent_filter_or_confidence_for_old_records(self):
        self.candidate.eligible = self.candidate.selected = False
        self.candidate.reason_jsonb = self.candidate.metadata_json = {}
        result = self.compact()["candidates"][0]
        self.assertEqual(result["reason_code"], "FILTERED")
        self.assertNotIn("similarity", result)
        self.assertNotIn("confidence_score", result)

    def test_compact_keeps_historical_draft_result_separate_from_current_workflow(self):
        workflow = self.workflow(current_stage="VOICE_READY")
        self.candidate.workflow_id = workflow.id
        result = self.compact(workflows=[workflow])
        self.assertEqual(result["candidates"][0]["status"], "DRAFT_REVIEW_REQUIRED")
        self.assertEqual(result["workflows"][0]["current_stage"], "VOICE_READY")
        self.assertNotIn("token_usage", result["candidates"][0])

    def test_compact_bounds_overview_text_but_diagnostics_keep_complete_reason(self):
        long_reason = "Important detail " * 200
        self.candidate.reason_jsonb = {"ai_decision": {"status": "REVIEW_REQUIRED", "production_gate": {"reason": long_reason}}}
        self.assertLessEqual(len(self.compact()["candidates"][0]["reason"]), 400)
        self.assertEqual(self.build()["candidates"][0]["decision"]["production"]["reason"], long_reason)

    def test_compact_projection_does_not_change_storage_and_supports_empty_runs(self):
        before = deepcopy((vars(self.run), vars(self.candidate)))
        self.compact()
        self.assertEqual(before, (vars(self.run), vars(self.candidate)))
        result = self.compact(candidates=[])
        self.assertEqual(result["candidates"], [])
        self.assertEqual(result["summary"]["candidate_count"], 0)

    def test_full_diagnostics_are_explicit_opt_in(self):
        db = MagicMock()
        db.get.return_value = self.run
        db.query.side_effect = [query([self.profile]), query([self.crawl]), query([self.candidate])]
        response = self.client(db).get(f"/planning-runs/{self.run.id}?view=diagnostic")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["schema_version"], 2)
        self.assertEqual(response.json()["candidates"][0]["matching"]["topics"][0]["similarity"], 0.5)
        self.assertEqual(response.json()["topics"][0]["description"], self.topic["description"])

    def test_candidate_diagnostics_only_query_requested_candidate_and_scoped_workflow(self):
        db = MagicMock()
        db.get.return_value = self.run
        workflow = self.workflow()
        self.candidate.workflow_id = workflow.id
        candidate_query, workflow_query = query([self.candidate]), query([workflow])
        db.query.side_effect = [candidate_query, workflow_query]
        response = self.client(db).get(f"/planning-runs/{self.run.id}/candidates/{self.candidate.id}/diagnostics")
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["run_id"], str(self.run.id))
        self.assertEqual(payload["candidate"]["id"], str(self.candidate.id))
        self.assertEqual(payload["workflow"]["id"], str(workflow.id))
        self.assertEqual(payload["candidate"]["matching"]["topics"][0]["topic_id"], payload["topics"][0]["id"])
        filters = candidate_query.filter.call_args.args
        self.assertEqual([clause.right.value for clause in filters], [self.run.id, self.candidate.id])
        self.assertEqual(workflow_query.filter.call_args.args[1].right.value, self.user.id)
        self.assertEqual(workflow_query.filter.call_args.args[2].right.value, self.profile.id)
        for method in (db.commit, db.flush, db.add, db.delete):
            method.assert_not_called()

    def test_candidate_diagnostics_missing_or_other_run_candidate_returns_404(self):
        db = MagicMock()
        db.get.return_value = self.run
        db.query.return_value = query([])
        response = self.client(db).get(f"/planning-runs/{self.run.id}/candidates/{uuid.uuid4()}/diagnostics")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(db.query.call_count, 1)

    def test_candidate_diagnostics_unauthorized_run_is_rejected_before_queries(self):
        db = MagicMock()
        db.get.return_value = deepcopy(self.run)
        db.get.return_value.user_id = uuid.uuid4()
        response = self.client(db).get(f"/planning-runs/{self.run.id}/candidates/{self.candidate.id}/diagnostics")
        self.assertEqual(response.status_code, 404)
        db.query.assert_not_called()


if __name__ == "__main__":
    unittest.main()
