from __future__ import annotations

from copy import deepcopy
import json
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from common.core.llm import ChatCompletionResult, chat_completion
from common.db.content_series import lock_active_series, normalized_series_title
from common.planning.auto_draft_policy import auto_production_allowed, draft_script_signature, invalidate_draft_media, sync_compact_scenes
from app.planning.services.auto_draft_compact import evaluate_compact_draft, normalize_compact_draft
from app.planning.services.auto_workflow_planner import AutoWorkflowPlanner
from app.video.services.generate_video_jobs import (
    _cancel_blocked_auto_production,
    _mark_video_task_failed,
    _maybe_enqueue_auto_voice_or_render,
    _maybe_enqueue_auto_generate_video_voice,
    _maybe_enqueue_auto_generate_video_render,
)
from app.video.services.generate_video_timeline import public_story_payload


def fixture_story() -> dict:
    return {
        "meta": {},
        "video": {"fps": 30},
        "timeline": {
            "text": [{"id": "text-1", "start": 0, "end": 10, "text": "Người dùng cần kiểm tra kết quả.", "voice_text": "Người dùng cần kiểm tra kết quả.", "role": "CONTEXT", "evidence_ids": ["F1"]}],
            "video": [{"id": "video-1", "start": 0, "end": 10, "src": "image.jpg", "type": "image"}],
            "audio": [],
        },
        "compact_scenes": [{"role": "CONTEXT", "voice_text": "Người dùng cần kiểm tra kết quả.", "evidence_ids": ["F1"]}],
    }


class ProductionPolicyTests(unittest.TestCase):
    def setUp(self):
        self.story = fixture_story()
        self.metadata = {"selection_mode": "AUTO", "draft_quality": {"status": "PASS"}, "quality_script_signature": draft_script_signature(self.story)}

    def test_only_current_quality_checked_script_can_produce(self):
        self.assertTrue(auto_production_allowed(self.metadata, self.story))
        self.story["timeline"]["text"][0]["voice_text"] = "Đây là nội dung khác không có trong nguồn."
        self.assertFalse(auto_production_allowed(self.metadata, self.story))

    def test_caption_changes_cannot_hide_behind_stale_voice_or_compact(self):
        self.story["timeline"]["text"][0]["text"] = "Google đã mua một công ty khác."
        self.assertFalse(auto_production_allowed(self.metadata, self.story))

    def test_timing_audio_and_emotion_tags_do_not_invalidate_script(self):
        changed = deepcopy(self.story)
        changed["timeline"]["text"][0].update(start=1, end=12, voice_text="[calm] Người dùng cần kiểm tra kết quả...")
        changed["audio"] = {"voice": "voice.mp3"}
        self.assertTrue(auto_production_allowed(self.metadata, changed))

    def test_high_risk_and_missing_signature_fail_closed(self):
        self.metadata["risk_flags"] = [{"severity": "HIGH"}]
        self.assertFalse(auto_production_allowed(self.metadata, self.story))
        self.metadata.pop("risk_flags")
        self.metadata.pop("quality_script_signature")
        self.assertFalse(auto_production_allowed(self.metadata, self.story))

    def test_human_approval_is_bound_to_current_script(self):
        self.metadata.update(draft_quality={"status": "REVIEW_REQUIRED"}, risk_flags=[{"severity": "HIGH"}], draft_review_approved=True, approved_script_signature=draft_script_signature(self.story))
        self.assertTrue(auto_production_allowed(self.metadata, self.story))
        self.story["timeline"]["text"].append({"text": "Một cảnh mới"})
        self.assertFalse(auto_production_allowed(self.metadata, self.story))

    def test_explicit_re_review_blocks_even_previously_passed_script(self):
        self.metadata["draft_review"] = {"status": "REVIEW_REQUIRED"}
        self.assertFalse(auto_production_allowed(self.metadata, self.story))

    def test_manual_workflow_behavior_is_unchanged(self):
        self.assertTrue(auto_production_allowed({"selection_mode": "MANUAL"}, self.story))

    def test_public_payload_preserves_evidence_and_compact_scenes(self):
        payload = public_story_payload(self.story)
        self.assertEqual(payload["compact_scenes"][0]["evidence_ids"], ["F1"])
        self.assertEqual(payload["timeline"]["text"][0]["role"], "CONTEXT")
        self.assertEqual(payload["timeline"]["text"][0]["evidence_ids"], ["F1"])
        self.assertIn("story_data", payload)
        self.assertEqual(draft_script_signature(self.story), draft_script_signature(payload))

    def test_failed_video_task_preserves_actionable_stage(self):
        class DB:
            def __init__(self):
                self.added = []
                self.commits = 0

            def add(self, item):
                self.added.append(item)

            def commit(self):
                self.commits += 1

        db = DB()
        task = SimpleNamespace(
            status="RUNNING",
            current_stage="RENDERING_VIDEO",
            error_message=None,
            completed_at=None,
        )
        project = SimpleNamespace(status="RENDERING", current_stage="RENDERING_VIDEO")

        _mark_video_task_failed(db, task, project, RuntimeError("render crashed"))

        self.assertEqual(task.status, "FAILED")
        self.assertEqual(project.status, "FAILED")
        self.assertEqual(task.current_stage, "RENDERING_VIDEO")
        self.assertEqual(project.current_stage, "RENDERING_VIDEO")
        self.assertEqual(task.error_message, "render crashed")
        self.assertEqual(db.commits, 1)

    def test_evidence_follows_text_id_when_scene_order_changes(self):
        self.story["compact_scenes"].append({"text_id": "text-2", "voice_text": "Nội dung thứ hai.", "role": "IMPACT", "evidence_ids": ["F2"]})
        self.story["timeline"]["text"] = [{"id": "text-2", "text": "Nội dung thứ hai."}]
        sync_compact_scenes(self.story)
        self.assertEqual(len(self.story["compact_scenes"]), 1)
        self.assertEqual(self.story["compact_scenes"][0]["evidence_ids"], ["F2"])

    def test_empty_timeline_cannot_produce_even_if_compact_copy_is_stale(self):
        self.story["timeline"]["text"] = []
        self.metadata.update(draft_review_approved=True, approved_script_signature=draft_script_signature(self.story))
        self.assertFalse(auto_production_allowed(self.metadata, self.story))

    def test_script_change_detaches_old_voice_but_keeps_music_and_files(self):
        project = SimpleNamespace(metadata_json={**self.metadata, "video_approved": True, "rendered_video": "old.mp4"}, artifacts_jsonb=[{"artifact_type": "FINAL_VIDEO", "uri": "old.mp4", "status": "READY"}])
        self.story["audio"] = {"voice": "old.mp3", "music": "music.mp3", "tracks": [{"type": "voice", "src": "old.mp3"}, {"type": "music", "src": "music.mp3"}]}
        self.story["timeline"]["audio"] = [{"type": "voice", "src": "old.mp3"}, {"type": "music", "src": "music.mp3"}]
        self.story["video_artifacts"] = {"final": "old.mp4"}
        invalidate_draft_media(project, self.story)
        self.assertNotIn("voice", self.story["audio"])
        self.assertEqual(self.story["audio"]["music"], "music.mp3")
        self.assertEqual(project.artifacts_jsonb[0]["status"], "STALE")
        self.assertEqual(project.artifacts_jsonb[0]["uri"], "old.mp4")
        self.assertNotIn("video_approved", project.metadata_json)

    def test_auto_enqueuers_cannot_bypass_review(self):
        project = SimpleNamespace(id=uuid.uuid4(), profile_id=uuid.uuid4(), metadata_json={"selection_mode": "AUTO", "draft_quality": {"status": "REVIEW_REQUIRED"}}, draft_json=self.story)
        db = MagicMock()
        db.get.return_value = SimpleNamespace(strategy=SimpleNamespace(video_render_mode="auto"))
        _maybe_enqueue_auto_voice_or_render(db, project, self.story, trigger="test")
        _maybe_enqueue_auto_generate_video_voice(db, project, trigger="test")
        _maybe_enqueue_auto_generate_video_render(db, project, self.story, trigger="test")
        db.add_all.assert_not_called()
        db.commit.assert_not_called()

    def test_already_queued_worker_task_is_cancelled_not_produced(self):
        task = SimpleNamespace(status="PENDING")
        project = SimpleNamespace(metadata_json={"selection_mode": "AUTO"}, draft_json=self.story)
        db = MagicMock()
        self.assertTrue(_cancel_blocked_auto_production(db, task, project))
        self.assertEqual(task.status, "CANCELLED")
        self.assertEqual(project.current_stage, "DRAFT_REVIEW_REQUIRED")
        db.commit.assert_called_once()


class QualityAndFitRegressionTests(unittest.TestCase):
    def setUp(self):
        self.facts = [{"id": "F1", "text": "Nhân viên kiểm tra kết quả trước khi sử dụng công cụ vào công việc."}]
        self.compact = normalize_compact_draft({"confidence_score": 90, "plan": {"title": "Kiểm tra kết quả", "format": "EXPLAINER", "duration_seconds": 25}, "scenes": [{"role": "HOOK", "voice_text": "Người dùng kiểm tra kết quả trước khi áp dụng vào công việc mỗi ngày.", "evidence_ids": ["F1"]}]})

    def codes(self):
        return {issue.code for issue in evaluate_compact_draft(self.compact, self.facts).issues}

    def test_high_risk_is_critical_even_with_valid_ids_and_no_numbers(self):
        self.compact["risk_flags"] = [{"severity": "HIGH", "type": "FACTUAL"}]
        result = evaluate_compact_draft(self.compact, self.facts)
        self.assertFalse(result.passed)
        self.assertIn("HIGH_RISK_FLAG", {issue.code for issue in result.issues if issue.severity == "CRITICAL"})

    def test_unsupported_names_in_hook_are_checked(self):
        self.compact["scenes"][0]["voice_text"] = "OpenAI vừa mua Google và thay đổi thị trường công nghệ."
        self.assertIn("UNSUPPORTED_ENTITY", self.codes())

    def test_single_missing_factual_citation_and_invalid_role_are_checked(self):
        self.compact["scenes"][0].update(role="WRONG", evidence_ids=[])
        self.assertTrue({"MISSING_EVIDENCE", "INVALID_SCENE_ROLE"}.issubset(self.codes()))

    def test_low_confidence_is_not_automatically_produced(self):
        self.compact["confidence_score"] = 20
        self.assertIn("LOW_MODEL_CONFIDENCE", self.codes())

    def test_number_must_be_in_cited_fact_not_unrelated_fact(self):
        self.facts.append({"id": "F2", "text": "Một bài viết khác đề cập tới 99 người."})
        self.compact["scenes"][0]["voice_text"] = "Có 99 người kiểm tra kết quả."
        self.assertIn("UNSUPPORTED_NUMBER", self.codes())

    def test_vietnamese_filler_is_detected_after_normalization(self):
        self.compact["scenes"][0]["voice_text"] = "Điều đáng chú ý là người dùng cần kiểm tra kết quả."
        self.assertIn("GENERIC_FILLER", self.codes())

    def test_sensitive_or_low_tolerance_source_uses_fit_judge(self):
        planner = AutoWorkflowPlanner()
        for title, risk in [("Công nghệ máy tính", "low"), ("Công cụ điều trị sức khỏe", "medium")]:
            gate = planner.deterministic_production_gate(content=SimpleNamespace(status="READY", quality_score=90, canonical_title=title), strategy=SimpleNamespace(risk_level=risk, require_video=False), candidate_metadata={"embedding_similarity": .98, "similarity_threshold": .62}, source_fact_count=5)
            self.assertEqual(gate.status, "BORDERLINE")

    def test_fit_judge_high_risk_overrides_produce_decision(self):
        planner = AutoWorkflowPlanner()
        response = ChatCompletionResult(provider="openai", model="test", content=json.dumps({"decision": "PRODUCE", "risk": "HIGH", "confidence_score": 99}), raw_response={}, latency_ms=0)
        with patch.object(planner, "call_llm", return_value=response), patch("app.planning.services.auto_workflow_planner.log_prompt_run"):
            gate, _ = planner.run_fit_judge(MagicMock(), settings=SimpleNamespace(), provider="openai", profile=SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4(), platform="tiktok"), strategy=SimpleNamespace(content_topics="AI", avoid_topics="", target_audience="", risk_level="medium"), content=SimpleNamespace(id=uuid.uuid4(), canonical_title="AI", summary="", quality_score=90), candidate_metadata={}, source_facts=self.facts)
        self.assertEqual(gate.status, "REVIEW_REQUIRED")


class SeriesAndTokenTests(unittest.TestCase):
    def test_series_ranking_uses_centroid_not_best_matching_article(self):
        planner = AutoWorkflowPlanner()
        series_id = uuid.uuid4()
        series = SimpleNamespace(id=series_id, title="Chủ đề khác", description="", series_type="NEWS", status="ACTIVE", current_part=3, total_parts=0, metadata_json={}, context_json={})
        content_ids = [uuid.uuid4() for _ in range(3)]
        workflows = [SimpleNamespace(id=uuid.uuid4(), series_id=series_id, primary_content_id=content_id, title="Bài gần đây", status="EDITING") for content_id in content_ids]
        vectors = [[1., 0.], [0., 1.], [0., 1.]]
        embeddings = [SimpleNamespace(content_id=content_id, embedding=vector) for content_id, vector in zip(content_ids, vectors)]
        queries = [MagicMock() for _ in range(4)]
        queries[0].filter.return_value.order_by.return_value.all.return_value = [series]
        queries[1].filter.return_value.filter.return_value.subquery.return_value.c.series_rank.__le__.return_value = True
        queries[2].join.return_value.filter.return_value.order_by.return_value.all.return_value = workflows
        queries[3].filter.return_value.filter.return_value.order_by.return_value.all.return_value = embeddings
        db = MagicMock()
        db.query.side_effect = queries
        db.get.return_value = SimpleNamespace(summary="Nội dung gần đây")
        with patch.object(planner, "content_embedding", return_value=SimpleNamespace(embedding=[1., 0.], model_name="actual-model")), patch("app.planning.services.auto_workflow_planner.series_part_count", return_value=3):
            result = planner.rank_series_candidates(db, profile_id=uuid.uuid4(), content=SimpleNamespace(id=uuid.uuid4(), canonical_title="Ứng dụng", summary=""), candidate_metadata={"embedding_model": "missing-model"})
        self.assertEqual(len(result), 1)
        self.assertAlmostEqual(result[0]["semantic_score"], 1 / (5 ** .5), places=4)
        self.assertEqual(result[0]["recent_vector_count"], 3)
        self.assertEqual(result[0]["match_source"], "recent_content_centroid")

    def test_capacity_rechecks_actual_count_under_row_lock(self):
        series = SimpleNamespace(id=uuid.uuid4(), current_part=0, total_parts=2)
        db = MagicMock()
        db.query.return_value.filter.return_value.with_for_update.return_value.first.return_value = series
        with patch("common.db.content_series.series_part_count", return_value=2):
            self.assertIsNone(lock_active_series(db, series.id, profile_id=uuid.uuid4()))
        db.query.return_value.filter.return_value.with_for_update.assert_called_once()
        self.assertEqual(series.current_part, 2)

    def test_series_title_dedup_normalizes_case_and_spaces(self):
        self.assertEqual(normalized_series_title("  TRÍ   TUỆ nhân tạo "), normalized_series_title("Trí tuệ nhân tạo"))

    def test_clear_match_needs_at_least_three_source_vectors(self):
        self.assertIsNone(AutoWorkflowPlanner().resolve_clear_series_match([{"id": "a", "score": .99, "recent_vector_count": 2}]))

    def test_provider_specific_token_ceiling_is_sent(self):
        for provider, key in [("openai", "max_completion_tokens"), ("deepseek", "max_tokens")]:
            with patch("common.core.llm.post_json", return_value={"choices": [{"message": {"content": "{}"}}]}) as post:
                chat_completion(provider=provider, base_url="https://example.invalid", api_key="test", model="test", messages=[], max_tokens=300)
            self.assertEqual(post.call_args.args[1][key], 300)


class CompactCallBudgetTests(unittest.TestCase):
    def setUp(self):
        self.planner = AutoWorkflowPlanner()
        self.content = SimpleNamespace(id=uuid.uuid4(), canonical_title="AI hỗ trợ công việc", normalized_title="ai", summary="", quality_score=90, status="READY", media_jsonb=[])
        self.profile = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4(), platform="tiktok")
        self.strategy = SimpleNamespace(tone="Tự nhiên", target_audience="Nhân viên", risk_level="medium", content_topics="AI", avoid_topics="", require_video=False, min_similarity=.62)
        self.facts = [
            {"id": "F1", "text": "Trí tuệ nhân tạo đang được ứng dụng để hỗ trợ nhân viên xử lý tài liệu."},
            {"id": "F2", "text": "Người dùng vẫn cần kiểm tra kết quả trước khi đưa vào công việc thực tế."},
            {"id": "F3", "text": "Doanh nghiệp ưu tiên các tác vụ lặp lại khi triển khai công cụ tự động hóa."},
        ]
        self.good = {
            "confidence_score": 91,
            "plan": {"title": "AI hỗ trợ công việc", "format": "EXPLAINER", "duration_seconds": 25},
            "series_decision": {"action": "NONE"},
            "scenes": [
                {"role": "HOOK", "voice_text": "AI có thể làm nhanh, nhưng chưa thể tự chịu trách nhiệm cho kết quả.", "evidence_ids": ["F1"]},
                {"role": "CONTEXT", "voice_text": "Công cụ này đang hỗ trợ nhân viên xử lý tài liệu và việc lặp lại.", "evidence_ids": ["F1", "F3"]},
                {"role": "CAUSE", "voice_text": "Tự động hóa phù hợp nhất khi quy trình đã rõ và dễ kiểm soát.", "evidence_ids": ["F3"]},
                {"role": "IMPACT", "voice_text": "Con người vẫn phải kiểm tra nội dung trước khi dùng trong công việc thật.", "evidence_ids": ["F2"]},
                {"role": "SUMMARY", "voice_text": "Giá trị nằm ở cách phối hợp tốc độ của AI với sự kiểm chứng của con người.", "evidence_ids": ["F1", "F2"]},
            ],
        }

        self.good["version"] = "compact-v2"
        self.good["plan"].pop("duration_seconds")
        self.good["timeline"] = {
            "video": [{"id": "v1", "type": "image", "text_ids": [f"t{i}" for i in range(len(self.good["scenes"]))]}],
            "text": [{"id": f"t{i}", "text": scene["voice_text"], "role": scene["role"]} for i, scene in enumerate(self.good.pop("scenes"))],
        }

    def decide(self, outputs):
        completions = [ChatCompletionResult(provider="openai", model="test", content=json.dumps(value, ensure_ascii=False), raw_response={}, latency_ms=0) for value in outputs]
        with patch.object(self.planner, "script_source", return_value={"title": "AI", "summary": "", "source_content": {}}), patch("app.planning.services.auto_workflow_planner.extract_source_facts", return_value=self.facts), patch("app.planning.services.auto_workflow_planner.get_settings", return_value=SimpleNamespace(openai_api_key="test", deepseek_api_key="", openai_model="test")), patch("app.planning.services.auto_workflow_planner.log_prompt_run"), patch.object(self.planner, "rank_series_candidates", return_value=[]) as rank, patch.object(self.planner, "call_llm", side_effect=completions) as call:
            decision = self.planner.decide_and_build_draft(MagicMock(), profile=self.profile, strategy=self.strategy, content=self.content, candidate_metadata={"embedding_similarity": .9, "similarity_threshold": .62})
        return decision, call.call_count, rank.call_count

    def test_repair_is_one_call_and_success_can_pass(self):
        decision, calls, _ = self.decide([{}, self.good])
        self.assertTrue(decision.should_create_workflow, decision.error_message)
        self.assertEqual(calls, 2)
        self.assertEqual(decision.metadata["quality"]["status"], "PASS")
        self.assertEqual(decision.metadata["quality"]["retry_count"], 1)

    def test_failed_repair_never_causes_a_third_call(self):
        decision, calls, _ = self.decide([{}, {}])
        self.assertFalse(decision.should_create_workflow)
        self.assertEqual(calls, 2)

    def test_human_only_risk_does_not_spend_a_repair_call(self):
        risky = deepcopy(self.good)
        risky["risk_flags"] = [{"severity": "HIGH", "type": "SENSITIVE"}]
        decision, calls, _ = self.decide([risky])
        self.assertEqual(calls, 1)
        self.assertEqual(decision.metadata["quality"]["status"], "REVIEW_REQUIRED")

    def test_repair_cannot_silently_remove_reported_risk(self):
        risky = deepcopy(self.good)
        risky["risk_flags"] = [{"severity": "HIGH", "type": "FACTUAL"}]
        risky["timeline"]["text"][0]["text"] = "OpenAI vừa mua Google và thay đổi thị trường công nghệ."
        decision, calls, _ = self.decide([risky, self.good])
        self.assertEqual(calls, 2)
        self.assertEqual(decision.metadata["quality"]["status"], "REVIEW_REQUIRED")
        self.assertEqual(decision.metadata["risk_flags"][0]["severity"], "HIGH")

    def test_production_stop_never_runs_series_or_compact_call(self):
        self.facts = self.facts[:1]
        decision, calls, rankings = self.decide([])
        self.assertFalse(decision.should_create_workflow)
        self.assertEqual(calls, 0)
        self.assertEqual(rankings, 0)


if __name__ == "__main__":
    unittest.main()
