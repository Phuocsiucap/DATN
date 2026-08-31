from __future__ import annotations

from copy import deepcopy
import json
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from common.core.llm import ChatCompletionResult
from app.planning.services.auto_draft_compact import (
    draft_quality_constraints,
    evaluate_compact_draft,
    normalize_compact_draft,
)
from app.planning.services.auto_draft_prompts import SOURCE_DATA_POLICY, compact_draft_rules
from app.planning.services.auto_workflow_planner import AutoWorkflowPlanner, PROMPT_VERSION


class PromptContractTests(unittest.TestCase):
    def setUp(self):
        self.planner = AutoWorkflowPlanner()
        self.profile = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4(), platform="tiktok")
        self.strategy = SimpleNamespace(
            tone="Tự nhiên", target_audience="Người đọc tin", content_topics="Hạ tầng",
            avoid_topics="", risk_level="medium", require_video=False, min_similarity=.35,
        )
        self.content = SimpleNamespace(
            id=uuid.uuid4(), canonical_title="Hạ tầng địa phương", normalized_title="ha tang",
            summary="", quality_score=90, status="READY", media_jsonb=[],
        )
        self.facts = [
            {"id": f"F{index}", "text": f"Dữ kiện nguồn thứ {index} nói về hạ tầng địa phương."}
            for index in range(1, 6)
        ] + [{"id": "F6", "text": "Quảng Trị có 10 công trình được khảo sát."}]
        self.document = {"coverage": "FULL_TEXT", "sections": self.facts}
        self.current = normalize_compact_draft({
            "confidence_score": 90,
            "plan": {"title": "Hạ tầng địa phương", "format": "EXPLAINER", "duration_seconds": 40},
            "scenes": [{
                "role": "CONTEXT", "voice_text": "Quảng Trị có 10 công trình được khảo sát.",
                "evidence_ids": [f"F{index}" for index in range(1, 6)],
            }],
        })

    def create_payload(self, fixed=None):
        return self.planner.compact_prompt_payload(
            profile=self.profile, strategy=self.strategy, content=self.content,
            candidate_metadata={}, source_document=self.document,
            series_candidates=[{"id": "series-a"}], fixed_series_decision=fixed,
            available_media_count=2,
        )

    def repair_payload(self, fixed=None, current=None):
        return self.planner.repair_prompt_payload(
            profile=self.profile, strategy=self.strategy, source_document=self.document,
            current_draft=self.current if current is None else current,
            quality_issues=[issue.to_dict() for issue in evaluate_compact_draft(self.current, self.facts).issues],
            series_candidates=[{"id": "series-a"}], fixed_series_decision=fixed,
            available_media_count=2,
        )

    def test_creation_and_repair_share_contract_limits_and_rules(self):
        initial = self.create_payload()
        repair = self.repair_payload()
        for key in ("required_output", "draft_constraints", "format_catalog", "available_media_count"):
            self.assertEqual(initial[key], repair[key], key)
        self.assertEqual(initial["rules"], compact_draft_rules())
        self.assertEqual(repair["rules"][:len(initial["rules"])], initial["rules"])

    def test_linked_prompt_has_no_fixed_duration_or_citation_requirement(self):
        constraints = self.create_payload()["draft_constraints"]
        self.assertNotIn("duration_limits", constraints)
        self.assertNotIn("citation_optional_roles", constraints)
        self.assertNotIn("max_voice_text_chars_per_scene", constraints)
        self.assertIn("once", constraints["word_counting"])

    def test_repair_keeps_uncited_fact_even_when_five_other_facts_are_cited(self):
        before = deepcopy((self.facts, self.current))
        payload = self.repair_payload()
        self.assertEqual(payload["source_document"], self.document)
        self.assertIn("F6", [fact["id"] for fact in payload["source_document"]["sections"]])
        self.assertEqual((self.facts, self.current), before)

    def test_repair_of_empty_json_receives_complete_output_shape(self):
        output = self.repair_payload(current={})["required_output"]
        self.assertEqual(set(output), {"version", "confidence_score", "risk_flags", "plan", "series_decision", "timeline"})
        self.assertEqual(output["version"], "compact-v2")
        self.assertNotIn("evidence_ids", output["timeline"]["text"][0])
        self.assertNotIn("duration_seconds", output["plan"])
        self.assertIn("text_ids", output["timeline"]["video"][0])

    def test_fixed_series_is_preserved_and_alternatives_are_not_sent(self):
        fixed = {"action": "USE_EXISTING", "target_series_id": "series-a"}
        initial, repair = self.create_payload(fixed), self.repair_payload(fixed)
        self.assertEqual(initial["fixed_series_decision"], fixed)
        self.assertEqual(repair["fixed_series_decision"], fixed)
        self.assertEqual(initial["series_candidates"], [])
        self.assertEqual(repair["allowed_series_candidates"], [])

    def test_risk_policy_is_identical_in_both_prompts_for_low_tolerance(self):
        self.strategy.risk_level = " low "
        for payload in (self.create_payload(), self.repair_payload()):
            policy = payload["draft_constraints"]["review_policy"]
            self.assertEqual(policy["minimum_confidence"], 60)
            self.assertTrue(policy["medium_risk_requires_review"])
            self.assertEqual(policy["blocking_risk_severities"], ["HIGH", "CRITICAL"])
        self.assertFalse(draft_quality_constraints(risk_tolerance="medium")["review_policy"]["medium_risk_requires_review"])

    def test_actual_repair_call_receives_shared_contract_and_source_data_policy(self):
        # Mock only external IO; exercise the actual normalize/check/retry path.
        repaired = {**self.current, "version": "compact-v2", "timeline": {
            "video": [{"id": "v1", "type": "image", "text_ids": ["t1"]}],
            "text": [{"id": "t1", "text": self.current["scenes"][0]["voice_text"]}],
        }}
        completions = [ChatCompletionResult(
            provider="openai", model="test", content=json.dumps(output), raw_response={}, latency_ms=0,
        ) for output in ({}, repaired)]
        with (
            patch.object(self.planner, "script_source", return_value={"title": "Hạ tầng", "source_content": {}}),
            patch("app.planning.services.auto_workflow_planner.extract_source_facts", return_value=self.facts),
            patch("app.planning.services.auto_workflow_planner.get_settings", return_value=SimpleNamespace(openai_api_key="test", deepseek_api_key="", openai_model="test")),
            patch("app.planning.services.auto_workflow_planner.log_prompt_run"),
            patch.object(self.planner, "rank_series_candidates", return_value=[]),
            patch.object(self.planner, "call_llm", side_effect=completions) as call,
        ):
            decision = self.planner.decide_and_build_draft(
                MagicMock(), profile=self.profile, strategy=self.strategy, content=self.content,
                candidate_metadata={"embedding_similarity": .9, "similarity_threshold": .35},
            )
        self.assertEqual(call.call_count, 2)
        initial, repair = (item.args[2] for item in call.call_args_list)
        self.assertEqual(initial["draft_constraints"], repair["draft_constraints"])
        self.assertEqual(initial["required_output"], repair["required_output"])
        self.assertEqual(initial["content"]["source_document"], repair["source_document"])
        self.assertEqual(repair["source_document"]["coverage"], "EXCERPT_ONLY")
        self.assertEqual(repair["available_media_count"], 0)
        for item in call.call_args_list:
            self.assertIn(SOURCE_DATA_POLICY, item.kwargs["system_prompt"])
        self.assertEqual(decision.metadata["quality"]["status"], "PASS")
        self.assertEqual(decision.metadata["quality"]["retry_count"], 1)
        self.assertEqual(decision.metadata["prompt_version"], PROMPT_VERSION)


class ValidatorContractTests(unittest.TestCase):
    def make_draft(self, duration, word_count=60, scene_count=1):
        return normalize_compact_draft({
            "confidence_score": 90,
            "plan": {"title": "Kiểm tra", "format": "EXPLAINER", "duration_seconds": duration},
            "scenes": [{"role": "CONTEXT", "voice_text": " ".join(["tin"] * word_count), "evidence_ids": ["F1"]} for _ in range(scene_count)],
        })

    def test_word_boundaries_in_prompt_match_validator_for_every_duration(self):
        for limit in draft_quality_constraints()["duration_limits"]:
            for count, expected in (
                (limit["min_words"] - 1, "NARRATION_TOO_SHORT"),
                (limit["min_words"], None),
                (limit["max_words"], None),
                (limit["max_words"] + 1, "NARRATION_TOO_LONG"),
            ):
                with self.subTest(duration=limit["duration_seconds"], count=count):
                    # Split across scenes to stay below the normalizer's per-scene char cap.
                    compact = self.make_draft(limit["duration_seconds"], word_count=1, scene_count=limit["min_scenes"])
                    sizes = [count // len(compact["scenes"])] * len(compact["scenes"])
                    sizes[0] += count % len(compact["scenes"])
                    for scene, size in zip(compact["scenes"], sizes):
                        scene["voice_text"] = " ".join(["tin"] * size)
                    quality = evaluate_compact_draft(compact, [{"id": "F1", "text": "tin"}])
                    codes = {issue.code for issue in quality.issues} & {"NARRATION_TOO_SHORT", "NARRATION_TOO_LONG"}
                    self.assertEqual(quality.word_count, count)
                    self.assertEqual(codes, {expected} if expected else set())

    def test_scene_boundaries_in_prompt_match_validator_for_every_duration(self):
        for limit in draft_quality_constraints()["duration_limits"]:
            for count, expected in (
                (limit["min_scenes"] - 1, "TOO_FEW_SCENES"), (limit["min_scenes"], None),
                (limit["max_scenes"], None), (limit["max_scenes"] + 1, "TOO_MANY_SCENES"),
            ):
                with self.subTest(duration=limit["duration_seconds"], count=count):
                    quality = evaluate_compact_draft(self.make_draft(limit["duration_seconds"], 10, count), [{"id": "F1", "text": "tin"}])
                    codes = {issue.code for issue in quality.issues} & {"TOO_FEW_SCENES", "TOO_MANY_SCENES"}
                    self.assertEqual(codes, {expected} if expected else set())

    def test_shared_limits_cannot_drift_when_scene_configuration_changes(self):
        with patch.dict("app.planning.services.auto_draft_compact._MIN_SCENES", {25: 7}):
            limit = draft_quality_constraints()["duration_limits"][0]
            self.assertEqual(limit["min_scenes"], 7)
            quality = evaluate_compact_draft(self.make_draft(25, 10, 6), [{"id": "F1", "text": "tin"}])
            issue = next(issue for issue in quality.issues if issue.code == "TOO_FEW_SCENES")
            self.assertEqual(issue.details["minimum"], limit["min_scenes"])

    def test_missing_citations_follow_role_rules_in_prompt(self):
        optional = draft_quality_constraints()["citation_optional_roles"]
        for role in [*optional, "CONTEXT", "CAUSE", "IMPACT"]:
            compact = self.make_draft(25)
            compact["scenes"][0].update(role=role, evidence_ids=[])
            codes = {issue.code for issue in evaluate_compact_draft(compact, []).issues}
            self.assertEqual("MISSING_EVIDENCE" in codes, role not in optional)

    def test_evidence_errors_identify_exact_scene_name_number_and_citations(self):
        facts = [
            {"id": "F1", "text": "Các công trình đang được khảo sát."},
            {"id": "F2", "text": "Quảng Trị có 10 công trình được khảo sát."},
        ]
        compact = self.make_draft(25)
        compact["scenes"][0].update(voice_text="Quảng Trị có 10 công trình được khảo sát.", evidence_ids=["F1"])
        issues = {issue.code: issue for issue in evaluate_compact_draft(compact, facts).issues}
        entity = issues["UNSUPPORTED_ENTITY"].to_dict()
        number = issues["UNSUPPORTED_NUMBER"].to_dict()
        self.assertEqual(entity["severity"], "CRITICAL")
        self.assertEqual(entity["scene_indexes"], [0])
        self.assertIn("Quảng Trị", entity["details"]["scenes"][0]["unsupported_entities"])
        self.assertEqual(entity["details"]["scenes"][0]["evidence_ids"], ["F1"])
        self.assertEqual(number["details"]["scenes"][0]["unsupported_numbers"], ["10"])
        compact["scenes"][0]["evidence_ids"] = ["F2"]
        codes = {issue.code for issue in evaluate_compact_draft(compact, facts).issues}
        self.assertNotIn("UNSUPPORTED_ENTITY", codes)
        self.assertNotIn("UNSUPPORTED_NUMBER", codes)


if __name__ == "__main__":
    unittest.main()
