from __future__ import annotations

from copy import deepcopy
import json
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from common.core.llm import ChatCompletionResult
from common.db.media_workflows import _load_content_full_text
from app.planning.services.auto_draft_compact import build_draft_source_document, evaluate_compact_draft
from app.planning.services.auto_workflow_planner import AutoWorkflowPlanner


class FullTextDocumentTests(unittest.TestCase):
    def document(self, full_text, title="Tiêu đề", description=""):
        return build_draft_source_document(
            title=title, description=description, full_text=full_text,
            fallback_facts=[{"id": "F1", "text": "Chỉ có sapo từ nguồn crawl."}],
        )

    def test_whole_body_and_order_survive_beyond_ten_sections_and_3500_chars(self):
        paragraphs = [(f"Đoạn {index}. " + "Thông tin của bài viết cần được giữ nguyên. " * 12).strip() for index in range(15)]
        paragraphs.append("Cuối bài: Quảng Trị chưa phê duyệt dự án vào năm 2030.")
        doc = self.document("\n\n".join(paragraphs))
        body = [section["text"] for section in doc["sections"] if section["kind"] == "BODY"]
        self.assertEqual(doc["coverage"], "FULL_TEXT")
        self.assertEqual(body, paragraphs)
        self.assertGreater(sum(map(len, body)), 3500)
        self.assertGreater(len(body), 10)
        self.assertEqual([section["id"] for section in doc["sections"]], [f"F{index}" for index in range(1, len(doc["sections"]) + 1)])

    def test_single_long_paragraph_is_not_cut_at_600_characters(self):
        body = "Nội dung chi tiết. " * 300 + "Phần kết luận không được cắt bỏ."
        self.assertEqual(self.document(body)["sections"][-1]["text"], body)

    def test_headings_paragraphs_and_list_items_keep_source_order(self):
        doc = self.document("<h2>Bối cảnh</h2><p>Đoạn đầu &amp; ghi chú.</p><h3>Kết quả</h3><ul><li>Mục một.</li><li>Mục hai.</li></ul><script>ignore()</script>")
        self.assertEqual([s["text"] for s in doc["sections"] if s["kind"] == "BODY"], [
            "Bối cảnh", "Đoạn đầu & ghi chú.", "Kết quả", "Mục một.", "Mục hai.",
        ])

    def test_description_is_a_lead_not_an_ai_summary_and_not_duplicated(self):
        lead = "Đây là sapo có sẵn từ nguồn."
        separate = self.document("Phần thân bài.", description=lead)
        self.assertEqual(separate["sections"][1], {"id": "F2", "kind": "LEAD", "text": lead})
        included = self.document(lead + "\nPhần thân bài.", description=lead)
        self.assertFalse(any(s["kind"] == "LEAD" for s in included["sections"]))
        self.assertEqual(json.dumps(included, ensure_ascii=False).count(lead), 1)

    def test_duplicate_body_paragraphs_are_not_removed_or_reordered(self):
        doc = self.document("Một câu trích dẫn.\nĐoạn giải thích.\nMột câu trích dẫn.")
        self.assertEqual([s["text"] for s in doc["sections"] if s["kind"] == "BODY"], [
            "Một câu trích dẫn.", "Đoạn giải thích.", "Một câu trích dẫn.",
        ])

    def test_missing_or_empty_body_is_explicitly_excerpt_only(self):
        for body in (None, "", "  \n ", "<p> </p>"):
            with self.subTest(body=body):
                doc = self.document(body)
                self.assertEqual(doc["coverage"], "EXCERPT_ONLY")
                self.assertEqual(doc["sections"], [{"id": "F1", "text": "Chỉ có sapo từ nguồn crawl."}])


class FullTextLoaderTests(unittest.TestCase):
    def test_strict_loader_does_not_mislabel_description_as_full_text(self):
        collection = MagicMock()
        collection.find_one.return_value = {"normalized": {"description": "Chỉ có description."}}
        with patch("common.db.mongo.processed_documents", return_value=collection):
            self.assertIsNone(_load_content_full_text("507f1f77bcf86cd799439011", allow_description_fallback=False))
            # Existing non-AUTO callers retain their previous fallback behavior.
            self.assertEqual(_load_content_full_text("507f1f77bcf86cd799439011"), "Chỉ có description.")

    def test_strict_loader_returns_whole_normalized_content(self):
        body = "Toàn văn. " * 800 + "Kết luận ở cuối bài."
        collection = MagicMock()
        collection.find_one.return_value = {"normalized": {"content": body, "description": "Sapo."}}
        with patch("common.db.mongo.processed_documents", return_value=collection):
            self.assertEqual(_load_content_full_text("507f1f77bcf86cd799439011", allow_description_fallback=False), body)

    def test_auto_source_requests_strict_body_without_a_second_fallback_fetch(self):
        planner = AutoWorkflowPlanner()
        content = SimpleNamespace(
            id=uuid.uuid4(), media_jsonb=[], sources_jsonb=[], canonical_title="Tiêu đề", normalized_title="tieu de",
            summary="Sapo.", crawl_job_id=None, content_type="ARTICLE", quality_score=90,
        )
        with patch("app.planning.services.auto_workflow_planner._serialize_source_content", return_value={"full_text": None}) as serialize:
            source = planner.script_source(
                MagicMock(), profile=SimpleNamespace(user_id=uuid.uuid4()),
                strategy=SimpleNamespace(target_audience="", tone="", risk_level="medium"),
                content=content, candidate_metadata={},
            )
        serialize.assert_called_once_with(content, allow_description_fallback=False)
        self.assertIsNone(source["full_text"])
        self.assertEqual(source["summary"], "Sapo.")


class FullTextPlannerTests(unittest.TestCase):
    def setUp(self):
        self.planner = AutoWorkflowPlanner()
        self.profile = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4(), platform="tiktok")
        self.strategy = SimpleNamespace(tone="Tự nhiên", target_audience="Người đọc tin", risk_level="medium", content_topics="Hạ tầng", avoid_topics="", require_video=False, min_similarity=.35)
        self.content = SimpleNamespace(id=uuid.uuid4(), canonical_title="Bản tin", normalized_title="ban tin", summary="Sapo riêng.", quality_score=90, status="READY", media_jsonb=[])
        first = [
            "Công cụ tự động hỗ trợ nhân viên xử lý tài liệu.",
            "Người dùng cần kiểm tra kết quả trước khi áp dụng.",
            "Doanh nghiệp bắt đầu từ những tác vụ lặp lại.",
        ]
        middle = [f"Phần bối cảnh thứ {index}. " + "Nội dung bối cảnh được giữ đầy đủ. " * 15 for index in range(12)]
        self.tail = "Quảng Trị ghi nhận 10 công trình được khảo sát."
        self.body = "\n\n".join([*first, *middle, self.tail])
        self.gate_facts = [{"id": f"F{index}", "text": text} for index, text in enumerate(first, 1)]
        self.document = build_draft_source_document(title="Bản tin", description="Sapo riêng.", full_text=self.body, fallback_facts=self.gate_facts)
        ids = {section["text"]: section["id"] for section in self.document["sections"]}
        self.good = {
            "confidence_score": 90, "risk_flags": [],
            "plan": {"title": "Bản tin", "format": "EXPLAINER", "duration_seconds": 25},
            "series_decision": {"action": "NONE"},
            "scenes": [
                {"role": "HOOK", "voice_text": "Công cụ xử lý tài liệu vẫn cần con người kiểm tra.", "evidence_ids": [ids[first[0]], ids[first[1]]]},
                {"role": "CONTEXT", "voice_text": "Nhân viên dùng công cụ tự động để hỗ trợ công việc.", "evidence_ids": [ids[first[0]]]},
                {"role": "CAUSE", "voice_text": "Những tác vụ lặp lại là nơi doanh nghiệp bắt đầu.", "evidence_ids": [ids[first[2]]]},
                {"role": "IMPACT", "voice_text": "Người dùng kiểm tra kết quả trước khi đưa vào thực tế.", "evidence_ids": [ids[first[1]]]},
                {"role": "SUMMARY", "voice_text": self.tail, "evidence_ids": [ids[self.tail]]},
            ],
        }

        self.good["version"] = "compact-v2"
        self.good["plan"].pop("duration_seconds")
        self.good["timeline"] = {
            "video": [{"id": "v1", "type": "image", "text_ids": [f"t{i}" for i in range(len(self.good["scenes"]))]}],
            "text": [{"id": f"t{i}", "text": scene["voice_text"], "role": scene["role"]} for i, scene in enumerate(self.good.pop("scenes"))],
        }

    def decide(self, outputs, similarity=.9):
        completions = [ChatCompletionResult(provider="openai", model="test", content=json.dumps(output, ensure_ascii=False), raw_response={}, latency_ms=0) for output in outputs]
        with (
            patch.object(self.planner, "script_source", return_value={"title": "Bản tin", "summary": "Sapo riêng.", "full_text": self.body, "source_content": {"full_text": self.body}}),
            patch("app.planning.services.auto_workflow_planner.extract_source_facts", return_value=self.gate_facts),
            patch("app.planning.services.auto_workflow_planner.get_settings", return_value=SimpleNamespace(openai_api_key="test", deepseek_api_key="", openai_model="test")),
            patch("app.planning.services.auto_workflow_planner.log_prompt_run"),
            patch.object(self.planner, "rank_series_candidates", return_value=[]),
            patch.object(self.planner, "call_llm", side_effect=completions) as call,
            patch("app.planning.services.auto_workflow_planner.evaluate_compact_draft", wraps=evaluate_compact_draft) as validate,
        ):
            decision = self.planner.decide_and_build_draft(
                MagicMock(), profile=self.profile, strategy=self.strategy, content=self.content,
                candidate_metadata={"embedding_similarity": similarity, "similarity_threshold": .35},
            )
        return decision, call.call_args_list, validate.call_args_list

    def test_first_call_sees_end_of_article_once_and_validator_accepts_its_claim(self):
        decision, calls, checks = self.decide([self.good])
        self.assertEqual(len(calls), 1)
        self.assertEqual(decision.metadata["quality"]["status"], "PASS", decision.metadata)
        payload = calls[0].args[2]
        self.assertEqual(payload["content"]["source_document"], self.document)
        self.assertNotIn("summary", payload["content"])
        self.assertNotIn("source_facts", payload["content"])
        self.assertEqual(json.dumps(payload, ensure_ascii=False).count(self.tail), 1)
        self.assertEqual(checks[0].args[1], self.document["sections"])
        self.assertEqual(decision.story["meta"]["source_facts"], self.document["sections"])
        self.assertEqual(decision.story["meta"]["source_coverage"], "FULL_TEXT")

    def test_fit_stays_compact_while_draft_and_repair_share_the_full_document(self):
        fit = {"decision": "PRODUCE", "confidence_score": 90, "risk": "LOW", "reason_code": "TOPIC_MATCH"}
        before = deepcopy(self.document)
        decision, calls, checks = self.decide([fit, {}, self.good], similarity=.4)
        self.assertEqual(len(calls), 3)
        fit_payload, initial, repair = (call.args[2] for call in calls)
        self.assertEqual(fit_payload["content"]["facts"], self.gate_facts)
        self.assertNotIn(self.tail, json.dumps(fit_payload, ensure_ascii=False))
        self.assertEqual(initial["content"]["source_document"], repair["source_document"])
        self.assertEqual(repair["source_document"], before)
        self.assertEqual(len(checks), 2)
        self.assertTrue(all(check.args[1] == before["sections"] for check in checks))
        self.assertEqual(decision.metadata["quality"]["status"], "PASS", decision.metadata)
        self.assertEqual(decision.metadata["quality"]["retry_count"], 1)
        self.assertEqual(decision.metadata["source_coverage"], "FULL_TEXT")


if __name__ == "__main__":
    unittest.main()
