from __future__ import annotations

import json
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from common.core.llm import ChatCompletionResult
from app.planning.services.auto_draft_compact import (
    build_timeline_from_compact_scenes,
    evaluate_compact_draft,
    extract_source_facts,
    normalize_compact_draft,
)
from app.planning.services.auto_workflow_planner import AutoWorkflowPlanner


class CompactDraftTests(unittest.TestCase):
    def setUp(self) -> None:
        self.facts = [
            {"id": "F1", "text": "Trí tuệ nhân tạo đang được ứng dụng để hỗ trợ nhân viên xử lý tài liệu."},
            {"id": "F2", "text": "Người dùng vẫn cần kiểm tra kết quả trước khi đưa vào công việc thực tế."},
            {"id": "F3", "text": "Doanh nghiệp ưu tiên các tác vụ lặp lại khi triển khai công cụ tự động hóa."},
        ]

    def test_extract_source_facts_deduplicates_and_caps_context(self) -> None:
        facts = extract_source_facts(
            title="AI hỗ trợ công việc văn phòng",
            summary="AI hỗ trợ công việc văn phòng. Người dùng cần kiểm tra kết quả.",
            full_text="Người dùng cần kiểm tra kết quả. Doanh nghiệp bắt đầu từ tác vụ lặp lại.",
        )

        self.assertGreaterEqual(len(facts), 3)
        self.assertEqual([item["id"] for item in facts], [f"F{index}" for index in range(1, len(facts) + 1)])
        self.assertEqual(len({item["text"].lower() for item in facts}), len(facts))

    def test_quality_gate_passes_grounded_compact_draft(self) -> None:
        compact = normalize_compact_draft(
            {
                "confidence_score": 91,
                "plan": {
                    "title": "AI hỗ trợ công việc nhưng không thay thế kiểm tra",
                    "angle": "Cách dùng AI có kiểm soát",
                    "format": "EXPLAINER",
                    "duration_seconds": 25,
                    "hook_type": "CONTRARIAN",
                    "cta_mode": "SOFT_QUESTION",
                },
                "series_decision": {"action": "NONE"},
                "scenes": [
                    {"role": "HOOK", "voice_text": "AI có thể làm nhanh, nhưng chưa thể tự chịu trách nhiệm cho kết quả.", "evidence_ids": ["F1"]},
                    {"role": "CONTEXT", "voice_text": "Công cụ này đang hỗ trợ nhân viên xử lý tài liệu và việc lặp lại.", "evidence_ids": ["F1", "F3"]},
                    {"role": "CAUSE", "voice_text": "Tự động hóa phù hợp nhất khi quy trình đã rõ và dễ kiểm soát.", "evidence_ids": ["F3"]},
                    {"role": "IMPACT", "voice_text": "Con người vẫn phải kiểm tra nội dung trước khi dùng trong công việc thật.", "evidence_ids": ["F2"]},
                    {"role": "SUMMARY", "voice_text": "Giá trị nằm ở cách phối hợp tốc độ của AI với sự kiểm chứng của con người.", "evidence_ids": ["F1", "F2"]},
                ],
            }
        )

        quality = evaluate_compact_draft(compact, self.facts)

        self.assertTrue(quality.passed, quality.to_dict())
        self.assertGreaterEqual(quality.score, 85)

    def test_quality_gate_requests_repair_for_invalid_evidence_and_repetition(self) -> None:
        compact = normalize_compact_draft(
            {
                "plan": {"title": "Draft lỗi", "format": "EXPLAINER", "duration_seconds": 25},
                "scenes": [
                    {"role": "CONTEXT", "voice_text": "Cùng một câu bị lặp lại trong hai cảnh của video này.", "evidence_ids": ["F99"]},
                    {"role": "CAUSE", "voice_text": "Cùng một câu bị lặp lại trong hai cảnh của video này.", "evidence_ids": ["F99"]},
                ],
            }
        )

        quality = evaluate_compact_draft(compact, self.facts)
        codes = {issue.code for issue in quality.issues}

        self.assertFalse(quality.passed)
        self.assertIn("INVALID_EVIDENCE_ID", codes)
        self.assertIn("SCENE_REPETITION", codes)
        self.assertIn("TOO_FEW_SCENES", codes)

    def test_timeline_is_built_deterministically_from_compact_scenes(self) -> None:
        compact = normalize_compact_draft(
            {
                "plan": {"title": "Timeline", "format": "QA", "duration_seconds": 25},
                "scenes": [
                    {"role": "QUESTION", "voice_text": "AI có thể hỗ trợ phần nào trong công việc?", "evidence_ids": ["F1"]},
                    {"role": "SHORT_ANSWER", "voice_text": "AI hỗ trợ tài liệu và các tác vụ lặp lại.", "evidence_ids": ["F1", "F3"]},
                    {"role": "CONCLUSION", "voice_text": "Người dùng vẫn cần kiểm tra kết quả cuối cùng.", "evidence_ids": ["F2"]},
                ],
            }
        )

        timeline = build_timeline_from_compact_scenes(compact, ["image-a.jpg", "image-b.jpg"])

        self.assertEqual(timeline["duration"], 25.0)
        self.assertEqual(len(timeline["text"]), 3)
        self.assertEqual(len(timeline["video"]), 3)
        self.assertEqual(timeline["text"][0]["start"], 0.0)
        self.assertEqual(timeline["text"][-1]["end"], 25.0)
        self.assertEqual(timeline["video"][2]["src"], "image-a.jpg")


class ProductionAndSeriesDecisionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.planner = AutoWorkflowPlanner()
        self.content = SimpleNamespace(quality_score=80, status="READY")
        self.strategy = SimpleNamespace(require_video=False, min_similarity=0.62)

    def test_production_gate_runs_before_series_and_auto_accepts_clear_match(self) -> None:
        gate = self.planner.deterministic_production_gate(
            content=self.content,
            strategy=self.strategy,
            candidate_metadata={
                "passed_similarity_gate": True,
                "blocked_by_avoid_topics": False,
                "embedding_similarity": 0.76,
                "similarity_threshold": 0.62,
            },
            source_fact_count=5,
        )

        self.assertEqual(gate.status, "PRODUCE")
        self.assertEqual(gate.reason_code, "HIGH_CONFIDENCE_MATCH")

    def test_production_gate_hard_rejects_avoid_topic(self) -> None:
        gate = self.planner.deterministic_production_gate(
            content=self.content,
            strategy=self.strategy,
            candidate_metadata={
                "passed_similarity_gate": True,
                "blocked_by_avoid_topics": True,
                "avoided_topics": ["tin đồn"],
            },
            source_fact_count=5,
        )

        self.assertEqual(gate.status, "SKIP")
        self.assertEqual(gate.reason_code, "AVOID_TOPIC")

    def test_clear_series_match_requires_score_and_margin(self) -> None:
        decision = self.planner.resolve_clear_series_match(
            [
                {"id": "series-a", "title": "A", "description": "", "series_type": "NEWS", "total_parts": 0, "score": 0.82, "recent_vector_count": 3},
                {"id": "series-b", "title": "B", "description": "", "series_type": "NEWS", "total_parts": 0, "score": 0.68, "recent_vector_count": 3},
            ]
        )

        self.assertIsNotNone(decision)
        self.assertEqual(decision["action"], "USE_EXISTING")
        self.assertEqual(decision["target_series_id"], "series-a")

    def test_invalid_llm_series_id_is_downgraded_to_none(self) -> None:
        decision = self.planner.validate_series_decision(
            fixed=None,
            value={"action": "USE_EXISTING", "target_series_id": "unknown"},
            candidates=[{"id": "series-a", "title": "A"}],
            content_title="Một bài độc lập",
        )

        self.assertEqual(decision["action"], "NONE")
        self.assertIsNone(decision["target_series_id"])

    def test_new_series_requires_three_reusable_followup_angles(self) -> None:
        decision = self.planner.validate_series_decision(
            fixed=None,
            value={
                "action": "CREATE_NEW",
                "series_title": "AI trong công việc",
                "reusable_followup_angles": ["Một góc tiếp theo", "Góc thứ hai"],
            },
            candidates=[],
            content_title="AI hỗ trợ xử lý tài liệu",
        )

        self.assertEqual(decision["action"], "NONE")


class CompactPlannerFlowTests(unittest.TestCase):
    def test_clear_candidate_uses_one_compact_call_and_builds_review_safe_story(self) -> None:
        planner = AutoWorkflowPlanner()
        content = SimpleNamespace(
            id=uuid.uuid4(),
            canonical_title="AI hỗ trợ xử lý tài liệu",
            normalized_title="ai ho tro xu ly tai lieu",
            summary=(
                "AI đang hỗ trợ nhân viên xử lý tài liệu. "
                "Người dùng vẫn cần kiểm tra kết quả cuối cùng. "
                "Doanh nghiệp thường bắt đầu từ những tác vụ lặp lại."
            ),
            media_jsonb=[],
            mongo_normalized_id=None,
            crawl_job_id=uuid.uuid4(),
            content_type="ARTICLE",
            quality_score=82,
            sources_jsonb=[],
            language="vi",
            status="READY",
            canonical_url=None,
            published_at=None,
            created_at=None,
            updated_at=None,
        )
        profile = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4(), platform="tiktok")
        strategy = SimpleNamespace(
            tone="Casual & Approachable",
            target_audience="Nhân viên văn phòng trẻ",
            risk_level="medium",
            content_topics="AI, công nghệ",
            avoid_topics="tin đồn",
            require_video=False,
            min_similarity=0.62,
        )
        candidate_metadata = {
            "passed_similarity_gate": True,
            "blocked_by_avoid_topics": False,
            "embedding_similarity": 0.78,
            "similarity_threshold": 0.62,
            "matched_topics": ["AI"],
        }
        compact_payload = {
            "version": "compact-v1",
            "confidence_score": 92,
            "plan": {
                "title": "Dùng AI nhanh hơn nhưng vẫn phải kiểm tra",
                "angle": "Phối hợp tốc độ và kiểm chứng",
                "format": "EXPLAINER",
                "duration_seconds": 25,
                "hook_type": "CONTRARIAN",
                "cta_mode": "SOFT_QUESTION",
            },
            "series_decision": {"action": "NONE"},
            "scenes": [
                {"role": "HOOK", "voice_text": "AI xử lý tài liệu nhanh, nhưng chưa thể tự chịu trách nhiệm cho kết quả.", "evidence_ids": ["F1"]},
                {"role": "CONTEXT", "voice_text": "Nhân viên đang dùng công cụ này để giảm thời gian cho phần việc lặp lại.", "evidence_ids": ["F1", "F3"]},
                {"role": "CAUSE", "voice_text": "Quy trình rõ ràng giúp doanh nghiệp kiểm soát tự động hóa dễ dàng hơn.", "evidence_ids": ["F3"]},
                {"role": "IMPACT", "voice_text": "Kết quả cuối cùng vẫn cần được người sử dụng kiểm tra trước khi áp dụng.", "evidence_ids": ["F2"]},
                {"role": "SUMMARY", "voice_text": "Cách dùng hiệu quả là kết hợp tốc độ của AI với khả năng kiểm chứng của con người.", "evidence_ids": ["F1", "F2"]},
            ],
        }
        compact_payload["version"] = "compact-v2"
        compact_payload["plan"].pop("duration_seconds")
        compact_payload["timeline"] = {
            "video": [{"id": "v1", "type": "image", "text_ids": [f"t{i}" for i in range(len(compact_payload["scenes"]))]}],
            "text": [{"id": f"t{i}", "text": scene["voice_text"], "role": scene["role"]} for i, scene in enumerate(compact_payload.pop("scenes"))],
        }
        completion = ChatCompletionResult(
            provider="openai",
            model="test-model",
            content=json.dumps(compact_payload, ensure_ascii=False),
            raw_response={"usage": {"prompt_tokens": 600, "completion_tokens": 300}},
            latency_ms=10,
        )
        settings = SimpleNamespace(openai_api_key="test", deepseek_api_key="", openai_model="test-model")

        with (
            patch("app.planning.services.auto_workflow_planner.get_settings", return_value=settings),
            patch("app.planning.services.auto_workflow_planner.log_prompt_run"),
            patch.object(planner, "rank_series_candidates", return_value=[]),
            patch.object(planner, "call_llm", return_value=completion) as call_llm,
        ):
            decision = planner.decide_and_build_draft(
                SimpleNamespace(),
                profile=profile,
                strategy=strategy,
                content=content,
                candidate_metadata=candidate_metadata,
            )

        self.assertTrue(decision.should_create_workflow, decision.error_message)
        self.assertEqual(decision.metadata["quality"]["status"], "PASS")
        self.assertEqual(decision.metadata["token_usage"]["creative_call_count"], 1)
        self.assertEqual(decision.story["meta"]["draft_generation_mode"], "compact-v2")
        self.assertNotIn("target_duration_seconds", decision.story["meta"])
        self.assertGreater(decision.timeline["duration"], 0)
        self.assertEqual(len(decision.timeline["video"]), 1)
        call_llm.assert_called_once()


if __name__ == "__main__":
    unittest.main()
