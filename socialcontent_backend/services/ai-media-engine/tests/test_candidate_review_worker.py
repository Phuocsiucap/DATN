from types import SimpleNamespace as Row
import unittest
from unittest.mock import MagicMock, patch
import uuid
import json

from app.planning.consumers import candidate_review as worker
from app.planning.services.auto_workflow_planner import AutoWorkflowPlanner, AutoWorkflowDecision
from common.core.llm import ChatCompletionResult
from common.db.models import ContentItem, KafkaTask, MediaWorkflow, PlanningCandidate, PlanningRun, SocialProfile
from common.planning.candidate_review import REVIEW_TASK_TYPE
from test_auto_draft_links import draft, FACTS, CATALOG


class CandidateReviewWorkerTests(unittest.TestCase):
    def setUp(self):
        owner = uuid.uuid4()
        self.profile = Row(id=uuid.uuid4(), user_id=owner, status="active", strategy=Row())
        self.run = Row(id=uuid.uuid4(), user_id=owner, profile_id=self.profile.id, crawl_job_id=uuid.uuid4(), planning_mode="AUTO", workflow_id=None)
        self.content = Row(id=uuid.uuid4(), content_scope="GLOBAL", owner_user_id=None)
        self.candidate = Row(id=uuid.uuid4(), planning_run_id=self.run.id, content_id=self.content.id, workflow_id=None, selected=False, metadata_json={})
        self.task = Row(id=uuid.uuid4(), task_type=REVIEW_TASK_TYPE, status="PENDING", current_stage="QUEUED_DRAFT",
                        reference_id=self.candidate.id, profile_id=self.profile.id, attempt_count=0,
                        payload_jsonb={"planning_run_id": str(self.run.id)}, result_jsonb={})
        self.review = {"action": "APPROVE", "status": "QUEUED", "reviewed_by": str(owner), "task_id": str(self.task.id)}
        self.candidate.metadata_json["production_review"] = self.review
        self.workflow = Row(id=uuid.uuid4(), user_id=owner, profile_id=self.profile.id, primary_content_id=self.content.id,
                            title="Draft", current_stage="DRAFT_READY", metadata_json={"draft_quality": {"status": "PASS"}}, draft_json={})
        self.rows = {PlanningRun: self.run, SocialProfile: self.profile, ContentItem: self.content, PlanningCandidate: self.candidate, MediaWorkflow: self.workflow}
        self.db = MagicMock()
        self.db.get.side_effect = lambda model, key: self.rows.get(model)
        self.queries = {}
        def query(model):
            if model not in self.queries:
                value = MagicMock()
                for method in ("filter", "order_by", "with_for_update"):
                    getattr(value, method).return_value = value
                value.first.side_effect = lambda: (self.task if self.task.status == "PENDING" else None) if model == KafkaTask else self.rows.get(model)
                self.queries[model] = value
            return self.queries[model]
        self.db.query.side_effect = query
        self.score = Row(eligible=True, metadata={})
        self.decision = AutoWorkflowDecision(should_create_workflow=True, reason="Đã sinh", metadata={"quality": {"status": "PASS"}})
        self.patches = [
            patch.object(worker.StrategyEmbeddingMatcher, "score_candidate", return_value=self.score),
            patch.object(worker.AutoWorkflowPlanner, "decide_and_build_draft", return_value=self.decision),
            patch.object(worker, "_existing_auto_workflow", return_value=None),
            patch.object(worker, "lock_profile_series_scope"),
            patch.object(worker, "_create_auto_workflow_from_decision", return_value=self.workflow),
            patch.object(worker, "_mark_existing_auto_workflow_link", return_value=Row(metadata_json={})),
            patch.object(worker, "_maybe_enqueue_auto_voice_or_render"),
            patch.object(worker.logger, "exception"),
        ]
        self.score_call, self.planner, self.existing, self.lock_profile, self.create, self.link, self.enqueue, _ = [p.start() for p in self.patches]
        self.addCleanup(lambda: [p.stop() for p in reversed(self.patches)])

    def test_generation_is_locked_and_saved_before_durable_continuation(self):
        self.assertTrue(worker.process_next_candidate_review(self.db))
        self.queries[KafkaTask].with_for_update.assert_called_once_with(skip_locked=True)
        self.assertEqual(self.task.current_stage, "DRAFT_SAVED")
        self.assertEqual(self.task.status, "PENDING")
        self.assertEqual(self.candidate.workflow_id, self.workflow.id)
        self.assertTrue(self.candidate.selected)
        self.assertEqual(self.candidate.metadata_json["production_review"]["status"], "COMPLETED")
        self.assertEqual(self.task.result_jsonb["workflow_id"], str(self.workflow.id))
        self.enqueue.assert_not_called()
        self.assertEqual(self.planner.call_args.kwargs["production_review"]["action"], "APPROVE")
        self.db.begin_nested.assert_called_once()

    def test_continuation_and_repeated_poll_do_not_generate_twice(self):
        worker.process_next_candidate_review(self.db)
        worker.process_next_candidate_review(self.db)
        self.assertEqual(self.task.status, "COMPLETED")
        self.enqueue.assert_called_once()
        self.assertFalse(worker.process_next_candidate_review(self.db))
        self.planner.assert_called_once()
        self.create.assert_called_once()

    def test_quality_review_draft_never_enqueues_voice_or_render(self):
        self.workflow.metadata_json["draft_quality"] = {"status": "REVIEW_REQUIRED"}
        self.workflow.current_stage = "DRAFT_REVIEW_REQUIRED"
        worker.process_next_candidate_review(self.db)
        worker.process_next_candidate_review(self.db)
        self.assertEqual(self.task.status, "COMPLETED")
        self.enqueue.assert_not_called()

    def test_generation_error_requires_explicit_retry(self):
        self.planner.return_value = AutoWorkflowDecision(False, "Thiếu cấu hình AI")
        worker.process_next_candidate_review(self.db)
        self.assertEqual(self.task.status, "FAILED")
        self.assertEqual(self.candidate.metadata_json["production_review"]["status"], "FAILED")
        self.assertIn("Thiếu cấu hình", self.task.error_message)
        self.assertFalse(worker.process_next_candidate_review(self.db))
        self.create.assert_not_called()

    def test_rechecks_current_source_access_before_ai(self):
        self.content.content_scope, self.content.owner_user_id = "PRIVATE", uuid.uuid4()
        worker.process_next_candidate_review(self.db)
        self.assertEqual(self.task.status, "FAILED")
        self.planner.assert_not_called()
        self.score_call.assert_not_called()

    def test_rechecks_current_hard_gates_before_ai(self):
        self.score.eligible = False
        worker.process_next_candidate_review(self.db)
        self.assertEqual(self.task.status, "FAILED")
        self.planner.assert_not_called()

    def test_mismatched_review_job_cannot_bypass_fit(self):
        self.review["task_id"] = str(uuid.uuid4())
        worker.process_next_candidate_review(self.db)
        self.assertEqual(self.task.status, "FAILED")
        self.planner.assert_not_called()

    def test_mismatched_profile_job_is_rejected(self):
        self.task.profile_id = uuid.uuid4()
        worker.process_next_candidate_review(self.db)
        self.assertEqual(self.task.status, "FAILED")
        self.planner.assert_not_called()

    def test_existing_workflow_is_reused_without_paid_call(self):
        self.existing.return_value = self.workflow
        worker.process_next_candidate_review(self.db)
        self.assertEqual(self.candidate.workflow_id, self.workflow.id)
        self.planner.assert_not_called()
        self.create.assert_not_called()

    def test_recheck_existing_workflow_after_generation_avoids_duplicate(self):
        self.existing.side_effect = [None, self.workflow]
        worker.process_next_candidate_review(self.db)
        self.assertEqual(self.candidate.workflow_id, self.workflow.id)
        self.planner.assert_called_once()
        self.create.assert_not_called()

    def test_missing_candidate_fails_job(self):
        self.rows[PlanningCandidate] = None
        worker.process_next_candidate_review(self.db)
        self.assertEqual(self.task.status, "FAILED")
        self.planner.assert_not_called()


class HumanProductionGateTests(unittest.TestCase):
    def run_draft(self, *, approval=True, blocked=False, draft_risk=False):
        planner = AutoWorkflowPlanner()
        profile = Row(id=uuid.uuid4(), user_id=uuid.uuid4(), platform="tiktok")
        strategy = Row(tone="Tự nhiên", target_audience="Người dân", content_topics="Thủ tục", avoid_topics="", risk_level="MEDIUM", require_video=False, min_similarity=.35)
        content = Row(id=uuid.uuid4(), canonical_title="Thủ tục", normalized_title="thu tuc", summary="", quality_score=90, status="READY",
                      media_jsonb=[{"media_type": i["type"], "source_url": i["src"]} for i in CATALOG])
        value = draft()
        if draft_risk:
            value["risk_flags"] = [{"type": "FACTUAL", "severity": "HIGH"}]
        completion = ChatCompletionResult(provider="openai", model="test", content=json.dumps(value), raw_response={}, latency_ms=0)
        with (patch.object(planner, "script_source", return_value={"title": "Thủ tục", "source_content": {"full_text": FACTS[0]["text"]}}),
              patch("app.planning.services.auto_workflow_planner.get_settings", return_value=Row(openai_api_key="test", deepseek_api_key="", openai_model="test")),
              patch("app.planning.services.auto_workflow_planner.log_prompt_run"),
              patch.object(planner, "rank_series_candidates", return_value=[]),
              patch.object(planner, "run_fit_judge") as fit,
              patch.object(planner, "call_llm", return_value=completion) as call):
            result = planner.decide_and_build_draft(MagicMock(), profile=profile, strategy=strategy, content=content,
                candidate_metadata={"embedding_similarity": .39, "similarity_threshold": .35, "blocked_by_avoid_topics": blocked},
                production_review={"action": "APPROVE", "reviewed_by": str(profile.user_id)} if approval else None)
        return result, fit, call

    def test_human_review_resolves_short_source_gate_without_another_fit_call(self):
        result, fit, call = self.run_draft()
        self.assertTrue(result.should_create_workflow, result.error_message)
        self.assertEqual(result.metadata["production_gate"]["source"], "HUMAN")
        self.assertEqual(result.metadata["quality"]["status"], "PASS")
        fit.assert_not_called()
        self.assertEqual(call.call_count, 1)

    def test_human_review_does_not_override_avoid_gate(self):
        result, fit, call = self.run_draft(blocked=True)
        self.assertFalse(result.should_create_workflow)
        self.assertEqual(result.metadata["production_gate"]["reason_code"], "AVOID_TOPIC")
        call.assert_not_called()

    def test_human_review_does_not_approve_high_risk_draft(self):
        result, fit, call = self.run_draft(draft_risk=True)
        self.assertTrue(result.should_create_workflow)
        self.assertEqual(result.metadata["quality"]["status"], "REVIEW_REQUIRED")
        self.assertIn("HIGH_RISK_FLAG", [issue["code"] for issue in result.metadata["quality"]["issues"]])


if __name__ == "__main__":
    unittest.main()
