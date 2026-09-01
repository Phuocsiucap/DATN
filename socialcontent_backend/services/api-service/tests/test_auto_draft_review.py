from __future__ import annotations

from copy import deepcopy
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from app.api.routes import generate_video as route
from app.api.routes import media_workflows
from app.services.generate_video import public_story_payload
from app.services.social_profiles import SocialProfileService
from common.planning.auto_draft_policy import auto_production_allowed, draft_script_signature


class AutoDraftApiTests(unittest.TestCase):
    def setUp(self):
        self.user = SimpleNamespace(id=uuid.uuid4(), is_system_admin=False, roles=[])
        self.story = {
            "meta": {"source_facts": [{"id": "F1", "text": "Một nội dung có nguồn."}]},
            "timeline": {"text": [{"id": "text-1", "text": "Người dùng cần kiểm tra kết quả.", "voice_text": "Người dùng cần kiểm tra kết quả.", "role": "CONTEXT", "evidence_ids": ["F1"], "start": 0, "end": 8}], "video": [], "audio": []},
            "compact_scenes": [{"role": "CONTEXT", "voice_text": "Người dùng cần kiểm tra kết quả.", "evidence_ids": ["F1"]}],
        }
        self.project = SimpleNamespace(id=uuid.uuid4(), profile_id=uuid.uuid4(), user_id=self.user.id, primary_content_id=uuid.uuid4(), series_id=None, planning_mode="SINGLE", metadata_json={"selection_mode": "AUTO", "draft_quality": {"status": "REVIEW_REQUIRED"}}, draft_json=deepcopy(self.story), artifacts_jsonb=[], status="EDITING", current_stage="DRAFT_REVIEW_REQUIRED", progress_percent=80)
        self.db = MagicMock()
        self.db.query.return_value.filter.return_value.first.return_value = None
        self.db.get.return_value = SimpleNamespace(strategy=SimpleNamespace(video_render_mode="manual"))

    def test_api_fallback_retains_compact_evidence(self):
        result = public_story_payload(self.story)
        self.assertEqual(result["compact_scenes"][0]["evidence_ids"], ["F1"])

    def test_save_linked_v2_preserves_both_tracks_and_does_not_restore_legacy_citations(self):
        linked = {
            "meta": {"draft_generation_mode": "compact-v2"}, "video": {"fps": 30},
            "compact_scenes": [],
            "timeline": {"video": [
                {"id": "a", "type": "image", "src": "a.jpg", "start": 0, "end": 8, "text_ids": ["first", "second"]},
                {"id": "b", "type": "video", "src": "b.mp4", "start": 8, "end": 10, "text_ids": ["third"]},
                {"id": "c", "type": "image", "src": "c.jpg", "start": 10, "end": 12, "text_ids": ["third"]},
            ], "text": [
                {"id": "first", "text": "Đoạn đầu.", "start": 0, "end": 4, "video_ids": ["a"]},
                {"id": "second", "text": "Đoạn thứ hai.", "start": 4, "end": 8, "video_ids": ["a"]},
                {"id": "third", "text": "Lời xuyên hai media.", "start": 8, "end": 12, "video_ids": ["b", "c"]},
            ], "audio": []},
        }
        self.project.draft_json = deepcopy(linked)
        self.project.metadata_json.update(draft_quality={"status": "PASS"}, quality_script_signature=draft_script_signature(linked))
        route._persist_project_story(self.db, self.project, linked, status="EDITING")
        saved = self.project.draft_json
        self.assertEqual(saved["meta"]["draft_generation_mode"], "compact-v2")
        self.assertEqual([v["text_ids"] for v in saved["timeline"]["video"]], [["first", "second"], ["third"], ["third"]])
        self.assertEqual(saved["timeline"]["text"][2]["video_ids"], ["b", "c"])
        self.assertEqual(len(saved["timeline"]["text"]), 3)
        self.assertEqual(saved["compact_scenes"][2]["text_id"], "third")
        self.assertNotIn("evidence_ids", saved["compact_scenes"][2])
        self.assertTrue(auto_production_allowed(self.project.metadata_json, saved))

    def test_save_unchanged_does_not_revoke_quality_approval(self):
        self.project.metadata_json.update(draft_quality={"status": "PASS"}, quality_script_signature=draft_script_signature(self.story))
        route._persist_project_story(self.db, self.project, deepcopy(self.story), status="EDITING")
        self.assertTrue(auto_production_allowed(self.project.metadata_json, self.project.draft_json))

    def test_save_changed_revokes_approval_and_old_audio(self):
        self.project.metadata_json.update(draft_review_approved=True, approved_script_signature=draft_script_signature(self.story))
        changed = deepcopy(self.story)
        changed["timeline"]["text"][0]["voice_text"] = "Đây là lời thoại khác sau khi duyệt."
        changed["audio"] = {"voice": "old.mp3"}
        route._persist_project_story(self.db, self.project, changed, status="EDITING")
        self.assertFalse(auto_production_allowed(self.project.metadata_json, self.project.draft_json))
        self.assertFalse(self.project.metadata_json["draft_review_approved"])
        self.assertNotIn("voice", self.project.draft_json["audio"])
        self.assertEqual(self.project.current_stage, "DRAFT_REVIEW_REQUIRED")

    def test_review_draft_blocks_both_voice_and_render_before_db_writes(self):
        for call in (
            lambda: route._enqueue_project_voice_job(self.db, self.project, trigger="test"),
            lambda: route._enqueue_project_render_job(self.db, self.project, self.story, trigger="test", mode="auto"),
        ):
            with self.assertRaises(HTTPException) as raised:
                call()
            self.assertEqual(raised.exception.status_code, 409)
        self.db.commit.assert_not_called()

    def test_approval_requires_exact_saved_version(self):
        with patch.object(route, "_get_owned_project", return_value=self.project):
            with self.assertRaises(HTTPException) as raised:
                route.approve_project_draft(self.project.id, route.ApproveDraftRequest(script_signature="stale"), self.user, self.db)
        self.assertEqual(raised.exception.status_code, 409)
        self.db.commit.assert_not_called()

    def test_approval_records_signature_without_falsifying_quality(self):
        with patch.object(route, "_get_owned_project", return_value=self.project):
            result = route.approve_project_draft(self.project.id, route.ApproveDraftRequest(script_signature=draft_script_signature(self.story)), self.user, self.db)
        self.assertTrue(auto_production_allowed(self.project.metadata_json, self.project.draft_json))
        self.assertEqual(self.project.metadata_json["draft_quality"]["status"], "REVIEW_REQUIRED")
        self.assertEqual(self.project.metadata_json["draft_review"]["reviewed_by"], str(self.user.id))
        self.assertEqual(result["current_stage"], "DRAFT_READY")
        self.assertIsNone(result["job"])

    def test_approval_enqueues_voice_for_auto_profile(self):
        self.db.get.return_value = SimpleNamespace(strategy=SimpleNamespace(video_render_mode="auto"))
        with patch.object(route, "_get_owned_project", return_value=self.project), patch.object(route, "_enqueue_project_voice_job", return_value=MagicMock()) as enqueue, patch.object(route, "_serialize_workflow_run", return_value={"id": "job"}):
            result = route.approve_project_draft(self.project.id, route.ApproveDraftRequest(script_signature=draft_script_signature(self.story)), self.user, self.db)
        enqueue.assert_called_once()
        self.assertEqual(result["job"]["id"], "job")

    def test_pending_series_applied_after_capacity_check(self):
        series = SimpleNamespace(id=uuid.uuid4(), title="Công nghệ", description="Chuỗi tin", series_type="NEWS", status="ACTIVE", current_part=0, total_parts=5)
        self.project.metadata_json["pending_series_decision"] = {"action": "USE_EXISTING", "target_series_id": str(series.id)}
        with patch.object(route, "lock_active_series", return_value=series) as lock, patch.object(route, "sync_series_current_part") as sync:
            result = route._apply_pending_series_decision(self.db, self.project, self.story)
        self.assertEqual(result.id, series.id)
        self.assertEqual(self.project.series_id, series.id)
        self.assertNotIn("pending_series_decision", self.project.metadata_json)
        lock.assert_called_once()
        sync.assert_called_once()

    def test_full_pending_series_is_not_assigned_or_created_again(self):
        series_id = uuid.uuid4()
        self.project.metadata_json["pending_series_decision"] = {"action": "USE_EXISTING", "target_series_id": str(series_id)}
        with patch.object(route, "lock_active_series", return_value=None):
            self.assertIsNone(route._apply_pending_series_decision(self.db, self.project, self.story))
        self.assertIsNone(self.project.series_id)
        self.assertEqual(self.project.metadata_json["series_decision_error"], "SERIES_UNAVAILABLE_OR_FULL")

    def test_standalone_pending_decision_does_not_report_series_failure(self):
        self.project.metadata_json["pending_series_decision"] = {"action": "NONE"}
        self.project.metadata_json["series_decision_error"] = "OLD_ERROR"
        self.assertIsNone(route._apply_pending_series_decision(self.db, self.project, self.story))
        self.assertNotIn("series_decision_error", self.project.metadata_json)
        self.assertNotIn("pending_series_decision", self.project.metadata_json)

    def test_pending_create_reuses_normalized_existing_series(self):
        series = SimpleNamespace(id=uuid.uuid4(), title="AI trong công việc", description="", series_type="NEWS", status="ACTIVE", current_part=0, total_parts=5)
        self.project.metadata_json["pending_series_decision"] = {"action": "CREATE_NEW", "series_title": "AI TRONG CÔNG VIỆC"}
        with patch.object(route, "lock_profile_series_scope") as scope, patch.object(route, "find_active_series_by_title", return_value=series), patch.object(route, "lock_active_series", return_value=series), patch.object(route, "sync_series_current_part"):
            result = route._apply_pending_series_decision(self.db, self.project, self.story)
        self.assertEqual(result.id, series.id)
        scope.assert_called_once()
        self.db.add.assert_not_called()

    def test_active_render_blocks_save_and_approval(self):
        self.db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(id=uuid.uuid4())
        with patch.object(route, "_get_owned_project", return_value=self.project):
            with self.assertRaises(HTTPException):
                route.save_story(route.StoryRequest(workflow_id=self.project.id, story=self.story), self.user, self.db)
            with self.assertRaises(HTTPException):
                route.approve_project_draft(self.project.id, route.ApproveDraftRequest(script_signature=draft_script_signature(self.story)), self.user, self.db)
        self.db.commit.assert_not_called()

    def test_stale_render_artifact_is_not_offered_as_final_video(self):
        self.assertIsNone(media_workflows._final_video_uri([{"artifact_type": "FINAL_VIDEO", "uri": "old.mp4", "status": "STALE"}]))

    def test_rejected_workflow_cannot_be_reopened_by_draft_save_or_approval(self):
        self.project.status = "REJECTED"
        with patch.object(route, "_get_owned_project", return_value=self.project):
            with self.assertRaises(HTTPException) as saved:
                route.save_story(route.StoryRequest(workflow_id=self.project.id, story=self.story), self.user, self.db)
            with self.assertRaises(HTTPException) as approved:
                route.approve_project_draft(self.project.id, route.ApproveDraftRequest(script_signature=draft_script_signature(self.story)), self.user, self.db)
        self.assertEqual(saved.exception.status_code, 409)
        self.assertEqual(approved.exception.status_code, 409)
        self.db.commit.assert_not_called()

    def test_reopening_rejected_workflow_checks_series_capacity(self):
        self.project.status = "REJECTED"
        self.project.series_id = uuid.uuid4()
        self.db.query.return_value.filter.return_value.with_for_update.return_value.first.return_value = self.project
        with patch.object(media_workflows, "lock_active_series", return_value=None) as lock:
            with self.assertRaises(HTTPException) as raised:
                media_workflows.approve_media_workflow(self.project.id, {}, self.user, self.db)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.project.status, "REJECTED")
        lock.assert_called_once_with(self.db, self.project.series_id, profile_id=self.project.profile_id, workflow_id=self.project.id)
        self.db.commit.assert_not_called()

    def test_reopening_rejected_workflow_restores_series_count_but_not_draft_approval(self):
        self.project.status = "REJECTED"
        self.project.series_id = uuid.uuid4()
        self.db.query.return_value.filter.return_value.with_for_update.return_value.first.return_value = self.project
        series = SimpleNamespace(id=self.project.series_id)
        with patch.object(media_workflows, "lock_active_series", return_value=series), patch.object(media_workflows, "sync_series_current_part") as sync, patch.object(media_workflows, "serialize_workflow", return_value={}):
            media_workflows.approve_media_workflow(self.project.id, {}, self.user, self.db)
        self.assertEqual(self.project.status, "APPROVED")
        self.assertEqual(self.project.current_stage, "DRAFT_REVIEW_REQUIRED")
        self.assertFalse(auto_production_allowed(self.project.metadata_json, self.project.draft_json))
        sync.assert_called_once_with(self.db, series)

    def test_active_worker_blocks_rejection_before_it_can_lose_series_slot(self):
        self.db.query.return_value.filter.return_value.with_for_update.return_value.first.return_value = self.project
        self.db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(id=uuid.uuid4())
        with self.assertRaises(HTTPException) as raised:
            media_workflows.reject_media_workflow(self.project.id, {}, self.user, self.db)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertNotEqual(self.project.status, "REJECTED")
        self.db.commit.assert_not_called()

    def test_review_gate_cannot_be_bypassed_by_old_video_approval_or_queue(self):
        self.story["video_artifacts"] = {"final": "old.mp4"}
        self.project.draft_json = deepcopy(self.story)
        with patch.object(route, "_get_owned_project", return_value=self.project):
            with self.assertRaises(HTTPException) as approved:
                route.approve_project_video(self.project.id, self.user, self.db)
        with self.assertRaises(HTTPException) as queued:
            route._queue_project_video(self.db, self.project, SimpleNamespace(id=self.project.profile_id), self.story, {}, requested_status="approved", reason="test")
        self.assertEqual(approved.exception.status_code, 409)
        self.assertEqual(queued.exception.status_code, 409)
        self.db.commit.assert_not_called()

    def test_raw_workflow_draft_patch_preserves_evidence_and_invalidates_media(self):
        self.project.updated_at = None
        self.project.title = "Test"
        self.db.query.return_value.filter.return_value.with_for_update.return_value.first.return_value = self.project
        updated = deepcopy(self.story)
        updated.pop("compact_scenes")
        updated["timeline"]["text"][0]["voice_text"] = "Đây là lời thoại đã được chỉnh sửa."
        updated["audio"] = {"voice": "old.mp3"}
        self.project.metadata_json.update(draft_review_approved=True, approved_script_signature=draft_script_signature(self.story))
        media_workflows.update_media_workflow(self.project.id, media_workflows.MediaWorkflowUpdateRequest(draft_json=updated), self.user, self.db)
        self.assertEqual(self.project.draft_json["compact_scenes"][0]["evidence_ids"], ["F1"])
        self.assertTrue(self.project.draft_json["compact_scenes"][0]["evidence_needs_review"])
        self.assertNotIn("voice", self.project.draft_json["audio"])
        self.assertFalse(auto_production_allowed(self.project.metadata_json, self.project.draft_json))

    def test_existing_queued_video_is_blocked_after_draft_changes(self):
        service = SocialProfileService()
        item = SimpleNamespace(id=uuid.uuid4(), article_link="old.mp4")
        with patch.object(service, "find_workflow_for_queue_item", return_value=self.project):
            with self.assertRaises(HTTPException) as raised:
                service.require_queue_draft_ready(self.db, item, self.user)
        self.assertEqual(raised.exception.status_code, 409)

    def test_approved_draft_still_requires_a_current_render_in_queue(self):
        service = SocialProfileService()
        item = SimpleNamespace(id=uuid.uuid4(), article_link="old.mp4")
        self.project.metadata_json.update(draft_review_approved=True, approved_script_signature=draft_script_signature(self.story))
        self.project.artifacts_jsonb = [{"artifact_type": "FINAL_VIDEO", "uri": "old.mp4", "status": "STALE"}]
        with patch.object(service, "find_workflow_for_queue_item", return_value=self.project):
            with self.assertRaises(HTTPException):
                service.require_queue_draft_ready(self.db, item, self.user)
            self.project.artifacts_jsonb.append({"artifact_type": "FINAL_VIDEO", "uri": "new.mp4", "status": "READY"})
            with self.assertRaises(HTTPException):
                service.require_queue_draft_ready(self.db, item, self.user)
            item.article_link = "new.mp4"
            service.require_queue_draft_ready(self.db, item, self.user)

    def test_queue_approval_and_schedule_check_draft_before_writing(self):
        service = SocialProfileService()
        item = SimpleNamespace(id=uuid.uuid4(), article_link="old.mp4")
        with patch.object(service, "get_owned_queue_item", return_value=item), patch.object(service, "find_workflow_for_queue_item", return_value=self.project):
            with self.assertRaises(HTTPException):
                service.approve_and_publish_queue_item_now(self.db, item.id, self.user)
            with self.assertRaises(HTTPException):
                service.approve_and_schedule_queue_item(self.db, item.id, self.user)
        self.db.commit.assert_not_called()

    def test_scheduler_publish_checks_draft_before_resolving_or_uploading_video(self):
        service = SocialProfileService()
        item = SimpleNamespace(id=uuid.uuid4(), status="approved", profile=SimpleNamespace(user_id=self.user.id), article_link="old.mp4")
        self.db.query.return_value.join.return_value.filter.return_value.first.return_value = item
        with patch.object(service, "find_workflow_for_queue_item", return_value=self.project), patch.object(service, "ensure_tiktok_profile"), patch.object(service, "resolve_tiktok_publish_mode", return_value="direct"), patch.object(service, "resolve_rendered_video_path") as resolve:
            with self.assertRaises(HTTPException) as raised:
                service.publish_queue_item_to_tiktok(self.db, item.id, self.user, source="scheduler", mode="direct")
        self.assertEqual(raised.exception.status_code, 409)
        resolve.assert_not_called()
        self.db.commit.assert_not_called()

    def test_approvals_intake_preserves_video_approval_without_assigning_a_schedule(self):
        service = SocialProfileService()
        self.project.status = "VIDEO_APPROVED"
        self.project.title = "Video đã duyệt"
        self.project.metadata_json.update(video_approved=True, draft_review_approved=True, approved_script_signature=draft_script_signature(self.story))
        self.project.artifacts_jsonb = [{"artifact_type": "FINAL_VIDEO", "uri": "new.mp4", "status": "READY"}]
        self.db.query.return_value.filter.return_value.filter.return_value.all.return_value = [self.project]
        self.db.get.side_effect = [SimpleNamespace(platform="tiktok"), SimpleNamespace(canonical_title="Article")]
        service.sync_rendered_workflows_to_queue(self.db, self.user)
        item = self.db.add.call_args_list[0].args[0]
        self.assertEqual(item.status, "approved")
        self.assertIsNone(item.scheduled_at)

    def test_legacy_queue_sync_uses_current_render_not_source_article_url(self):
        service = SocialProfileService()
        self.project.status = "RENDERED"
        self.project.title = "Video test"
        self.project.metadata_json.update(draft_review_approved=True, approved_script_signature=draft_script_signature(self.story))
        self.project.artifacts_jsonb = [{"artifact_type": "FINAL_VIDEO", "uri": "new.mp4", "status": "READY"}]
        self.db.query.return_value.filter.return_value.filter.return_value.all.return_value = [self.project]
        self.db.get.side_effect = [SimpleNamespace(platform="tiktok"), SimpleNamespace(canonical_url="https://article.test", canonical_title="Article")]
        service.sync_rendered_workflows_to_queue(self.db, self.user)
        item = self.db.add.call_args_list[0].args[0]
        self.assertEqual(item.article_link, "new.mp4")
        self.assertEqual(item.status, "needs_approval")

    def test_old_intake_recovers_approval_only_for_untouched_unscheduled_records(self):
        service = SocialProfileService()
        self.project.status = "VIDEO_APPROVED"
        self.project.metadata_json.update(video_approved=True, draft_review_approved=True, approved_script_signature=draft_script_signature(self.story), queued_post_id=str(uuid.uuid4()))
        self.db.query.return_value.filter.return_value.filter.return_value.all.return_value = [self.project]
        old_reason = "Được chuyển tự động từ Video đã hoàn thành render"
        for item_status, scheduled_at, reason, expected in [
            ("needs_approval", None, old_reason, "approved"),
            ("needs_approval", "2099-01-01", old_reason, "needs_approval"),
            ("needs_approval", None, "Reviewer cần xem lại", "needs_approval"),
            ("changes_requested", None, old_reason, "changes_requested"),
        ]:
            with self.subTest(status=item_status, scheduled_at=scheduled_at, reason=reason):
                item = SimpleNamespace(user_id=self.project.user_id, profile_id=self.project.profile_id, status=item_status, scheduled_at=scheduled_at, ai_reason=reason)
                self.db.get.return_value = item
                service.sync_rendered_workflows_to_queue(self.db, self.user)
                self.assertEqual(item.status, expected)
                self.assertEqual(item.scheduled_at, scheduled_at)

    def test_legacy_queue_sync_skips_auto_drafts_waiting_review(self):
        service = SocialProfileService()
        self.db.query.return_value.filter.return_value.filter.return_value.all.return_value = [self.project]
        service.sync_rendered_workflows_to_queue(self.db, self.user)
        self.db.add.assert_not_called()
        self.db.commit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
