from copy import deepcopy
from types import SimpleNamespace as Row
from unittest.mock import MagicMock, patch
import unittest
import uuid

from fastapi import HTTPException
from pydantic import ValidationError
from common.db.models import ContentItem, KafkaTask, PlanningCandidate, PlanningRun, SocialProfile, ProfileContentLink
from common.planning.candidate_review import candidate_decision, review_state
from app.api.routes import planning_runs as route
from app.services.planning_candidate_review import review_candidate, owned_candidate
import test_planning_run_detail as detail_tests


class CandidateReviewApiTests(unittest.TestCase):
    def setUp(self):
        self.user = Row(id=uuid.uuid4(), is_system_admin=False)
        self.profile = Row(id=uuid.uuid4(), user_id=self.user.id, status="active", strategy=Row())
        self.content = Row(id=uuid.uuid4(), content_scope="GLOBAL", owner_user_id=None, status="READY",
                           mongo_normalized_id="mongo-test", canonical_title="Bài nguồn", summary="Mô tả", canonical_url="https://example.test")
        self.run = Row(id=uuid.uuid4(), user_id=self.user.id, profile_id=self.profile.id, planning_mode="AUTO", output_jsonb={})
        self.original = {"status": "REVIEW_REQUIRED", "should_create_workflow": False,
                         "production_gate": {"status": "REVIEW_REQUIRED", "source": "LLM", "reason_code": "TOPIC_RELEVANCE"}}
        self.candidate = Row(id=uuid.uuid4(), planning_run_id=self.run.id, content_id=self.content.id,
                             workflow_id=None, selected=False, eligible=True,
                             reason_jsonb={"ai_decision": deepcopy(self.original)}, metadata_json={})
        self.task = None
        self.db = MagicMock()
        rows = {PlanningRun: self.run, SocialProfile: self.profile, ContentItem: self.content}
        self.db.get.side_effect = lambda model, key: rows.get(model)
        self.candidate_query = MagicMock()
        for method in ("filter", "with_for_update"):
            getattr(self.candidate_query, method).return_value = self.candidate_query
        self.candidate_query.first.side_effect = lambda: self.candidate
        self.task_query = MagicMock()
        self.task_query.filter.return_value = self.task_query
        self.task_query.first.side_effect = lambda: self.task
        self.link_query = MagicMock()
        self.link_query.filter.return_value = self.link_query
        self.link_query.first.return_value = None
        self.db.query.side_effect = lambda model: {PlanningCandidate: self.candidate_query, KafkaTask: self.task_query, ProfileContentLink: self.link_query}[model]
        def add(row):
            if isinstance(row, KafkaTask):
                self.task = row
        self.db.add.side_effect = add

    def act(self, action="APPROVE", reason="Đã kiểm tra nguồn"):
        return review_candidate(self.db, self.user, self.run.id, self.candidate.id, action, reason)

    def test_approve_creates_durable_job_not_workflow_and_keeps_ai_history(self):
        result = self.act()
        self.assertEqual(self.task.status, "PENDING")
        self.assertEqual(self.task.reference_id, self.candidate.id)
        self.assertEqual(result["review"]["status"], "QUEUED")
        self.assertEqual(result["review"]["reviewed_by"], str(self.user.id))
        self.assertFalse(result["review"]["can_approve"])
        self.assertIsNone(self.candidate.workflow_id)
        self.assertEqual(candidate_decision(self.candidate), self.original)
        self.candidate_query.with_for_update.assert_called_once()
        self.db.commit.assert_called_once()

    def test_double_approve_is_idempotent(self):
        first = self.act()
        self.db.add.reset_mock()
        second = self.act()
        self.assertEqual(first["review"]["task_id"], second["review"]["task_id"])
        self.db.add.assert_not_called()

    def test_reject_is_terminal_and_never_creates_job(self):
        result = self.act("REJECT", "Không phù hợp")
        self.assertEqual(result["review"]["status"], "REJECTED")
        self.assertIsNone(self.task)
        self.assertEqual(self.act("REJECT")["review"], result["review"])
        with self.assertRaises(HTTPException) as error:
            self.act("APPROVE")
        self.assertEqual(error.exception.status_code, 409)

    def test_cannot_reject_or_create_another_job_while_queued(self):
        self.act()
        with self.assertRaises(HTTPException):
            self.act("REJECT")
        task_id = self.task.id
        self.act("RETRY")
        self.assertEqual(self.task.id, task_id)

    def test_failure_requires_explicit_retry_and_reuses_job(self):
        self.act()
        task_id = self.task.id
        self.task.status = "FAILED"
        self.candidate.metadata_json["production_review"].update(status="FAILED", error_message="Model timeout")
        self.assertEqual(self.act()["review"]["status"], "FAILED")
        self.assertEqual(self.task.status, "FAILED")
        retried = self.act("RETRY", "Thử lại sau khi sửa cấu hình")
        self.assertEqual(retried["review"]["status"], "QUEUED")
        self.assertEqual(self.task.id, task_id)
        self.assertIsNone(self.task.error_message)
        self.assertEqual(len(self.candidate.metadata_json["production_review_history"]), 1)

    def test_can_reject_after_failed_generation(self):
        self.act()
        self.task.status = "FAILED"
        self.candidate.metadata_json["production_review"]["status"] = "FAILED"
        self.assertEqual(self.act("REJECT")["review"]["status"], "REJECTED")

    def test_other_owner_cannot_read_or_mutate_candidate(self):
        self.run.user_id = uuid.uuid4()
        for lock in (False, True):
            with self.assertRaises(HTTPException) as error:
                owned_candidate(self.db, self.user, self.run.id, self.candidate.id, lock=lock)
            self.assertEqual(error.exception.status_code, 404)
        self.db.query.assert_not_called()

    def test_candidate_lookup_is_scoped_to_the_run(self):
        owned_candidate(self.db, self.user, self.run.id, self.candidate.id)
        filters = self.candidate_query.filter.call_args.args
        self.assertEqual(filters[0].right.value, self.candidate.id)
        self.assertEqual(filters[1].right.value, self.run.id)

    def test_missing_candidate_returns_404(self):
        self.candidate_query.first.side_effect = lambda: None
        with self.assertRaises(HTTPException) as error:
            self.act()
        self.assertEqual(error.exception.status_code, 404)

    def test_cannot_use_another_users_private_source(self):
        self.content.content_scope, self.content.owner_user_id = "PRIVATE", uuid.uuid4()
        with self.assertRaises(HTTPException) as error:
            self.act()
        self.assertEqual(error.exception.status_code, 404)
        self.db.commit.assert_not_called()

    def test_draft_review_is_not_production_review(self):
        self.candidate.reason_jsonb["ai_decision"].update(status="DRAFT_REVIEW_REQUIRED", should_create_workflow=True, quality={"status": "REVIEW_REQUIRED"})
        with self.assertRaises(HTTPException):
            self.act()
        self.assertIsNone(self.task)

    def test_only_auto_pending_eligible_unproduced_candidates_can_be_reviewed(self):
        changes = [(self.run, "planning_mode", "MANUAL"), (self.candidate, "selected", True),
                   (self.candidate, "eligible", False), (self.candidate, "workflow_id", uuid.uuid4()),
                   (self.content, "status", "DELETED"), (self.profile, "status", "inactive")]
        for row, field, value in changes:
            original = getattr(row, field)
            setattr(row, field, value)
            with self.subTest(field=field), self.assertRaises(HTTPException):
                self.act()
            setattr(row, field, original)
        self.assertIsNone(self.task)

    def test_source_is_lazy_and_does_not_create_jobs_or_mutate_database(self):
        with patch.object(route, "_load_content_full_text", return_value="Toàn văn bài nguồn") as load:
            result = route.get_candidate_source(self.run.id, self.candidate.id, self.user, self.db)
        self.assertEqual(result["full_text"], "Toàn văn bài nguồn")
        load.assert_called_once_with("mongo-test")
        self.db.commit.assert_not_called()
        self.db.add.assert_not_called()

    def test_source_permission_is_checked_before_mongo_load(self):
        self.content.content_scope, self.content.owner_user_id = "PRIVATE", uuid.uuid4()
        with patch.object(route, "_load_content_full_text") as load, self.assertRaises(HTTPException):
            route.get_candidate_source(self.run.id, self.candidate.id, self.user, self.db)
        load.assert_not_called()

    def test_action_and_note_are_validated(self):
        for payload in ({"action": "BYPASS"}, {"action": "APPROVE", "reason": "x" * 1001}):
            with self.assertRaises(ValidationError):
                route.CandidateReviewRequest(**payload)

    def test_deleted_source_can_be_rejected_but_not_approved(self):
        self.candidate.content_id = None
        state = review_state(self.candidate, self.original)
        self.assertFalse(state["can_approve"])
        self.assertTrue(state["can_reject"])
        self.assertEqual(self.act("REJECT")["review"]["status"], "REJECTED")
        self.assertIsNone(self.task)

    def test_detail_exposes_actions_and_preserves_original_decision_after_review(self):
        fixture = detail_tests.PlanningDetailTests()
        fixture.setUp()
        fixture.candidate.selected = False
        fixture.candidate.reason_jsonb["ai_decision"] = deepcopy(self.original)
        before = fixture.build()["candidates"][0]
        self.assertTrue(before["review"]["can_approve"])
        self.assertIsNone(before["decision"]["draft"])
        fixture.candidate.metadata_json["production_review"] = {"status": "REJECTED", "action": "REJECT", "reason": "Sai đối tượng"}
        after = fixture.build()["candidates"][0]
        self.assertEqual(after["decision"]["production"]["source"], "HUMAN")
        self.assertEqual(after["review"]["original_production"]["source"], "LLM")
        self.assertFalse(after["review"]["can_approve"])
        self.assertEqual(fixture.candidate.reason_jsonb["ai_decision"], self.original)

    def test_completed_approval_is_idempotent_even_after_workflow_created(self):
        self.act()
        self.candidate.workflow_id = uuid.uuid4()
        self.candidate.selected = True
        self.candidate.metadata_json["production_review"]["status"] = "COMPLETED"
        self.task.status = "COMPLETED"
        self.db.add.reset_mock()
        self.assertEqual(self.act()["workflow_id"], str(self.candidate.workflow_id))
        self.db.add.assert_not_called()


if __name__ == "__main__":
    unittest.main()
