from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import MagicMock, patch

from common.core.llm import ChatCompletionResult
from common.planning.auto_draft_policy import sync_compact_scenes
from app.planning.services.auto_draft_compact import (
    build_timeline_from_compact_scenes, evaluate_compact_draft, normalize_compact_draft,
)
from app.planning.services.auto_draft_links import linked_draft_issues, media_prompt_catalog, source_media_catalog
from app.planning.services.auto_workflow_planner import AutoWorkflowPlanner
from app.video.services.generate_video_alignment import fit_frames_with_whisper
from app.video.services.generate_video_jobs import _recheck_auto_compact_quality
from app.video.services.generate_video_timeline import normalize_story_for_project, public_story_payload
from app.video.services.generate_video_voice import build_voice_text
from app.video.services.generate_video_scripting import edit_story_with_ai, review_story_with_ai


FACTS = [{"id": "F1", "text": "người dân đăng ký hồ sơ. cán bộ hướng dẫn thủ tục. kết quả được trả tại địa phương."}]
CATALOG = [
    {"index": 0, "type": "image", "src": "https://example.test/a.jpg"},
    {"index": 1, "type": "video", "src": "https://example.test/b.mp4"},
    {"index": 2, "type": "image", "src": "https://example.test/c.jpg"},
]


def draft():
    return {"version": "compact-v2", "confidence_score": 90, "risk_flags": [],
            "plan": {"title": "Thủ tục hành chính", "format": "EXPLAINER"},
            "series_decision": {"action": "NONE"},
            "timeline": {"video": [
                {"id": "a", "type": "image", "source_media_index": 0, "text_ids": ["first", "second"]},
                {"id": "b", "type": "video", "source_media_index": 1, "text_ids": ["third"]},
                {"id": "c", "type": "image", "source_media_index": 2, "text_ids": ["third"]},
            ], "text": [
                {"id": "first", "role": "CONTEXT", "text": "người dân đăng ký hồ sơ."},
                {"id": "second", "role": "ACTION", "text": "cán bộ hướng dẫn thủ tục."},
                {"id": "third", "role": "RESULT", "text": "kết quả được trả tại địa phương."},
            ]}}


def story(value=None):
    compact = normalize_compact_draft(value or draft())
    return normalize_story_for_project({
        "meta": {"draft_generation_mode": "compact-v2", "creative_plan": compact["plan"], "source_facts": FACTS},
        "video": {"fps": 30}, "timeline": build_timeline_from_compact_scenes(compact, available_media=CATALOG),
        "compact_scenes": compact["scenes"],
    })


class LinkedDraftTests(unittest.TestCase):
    def test_independent_tracks_pass_without_evidence_or_duration(self):
        compact = normalize_compact_draft(draft())
        quality = evaluate_compact_draft(compact, FACTS, available_media=CATALOG)
        self.assertTrue(quality.passed, quality.to_dict())
        self.assertEqual(quality.scene_count, 3)
        self.assertNotIn("duration_seconds", compact["plan"])

    def test_both_relationships_preserve_ids_assets_and_single_narration(self):
        result = story()
        videos, texts = result["timeline"]["video"], result["timeline"]["text"]
        self.assertEqual([v["id"] for v in videos], ["a", "b", "c"])
        self.assertEqual(videos[0]["text_ids"], ["first", "second"])
        self.assertEqual(texts[2]["video_ids"], ["b", "c"])
        self.assertEqual(videos[1]["type"], "video")
        self.assertEqual(videos[1]["src"], CATALOG[1]["src"])
        self.assertEqual(videos[0]["end"], texts[1]["end"])
        self.assertEqual(videos[1]["end"], videos[2]["start"])
        self.assertEqual(videos[2]["end"], texts[2]["end"])
        narration = build_voice_text(result)
        for text in draft()["timeline"]["text"]:
            self.assertEqual(narration.count(text["text"]), 1)
        self.assertEqual(narration, "\n\n".join(t["text"] for t in draft()["timeline"]["text"]))

    def test_mixed_many_to_many_is_stable_across_repeated_normalization(self):
        value = draft()
        value["timeline"]["video"] = value["timeline"]["video"][:2]
        value["timeline"]["video"][1]["text_ids"] = ["second", "third"]
        result = story(value)
        for _ in range(5):
            updated = normalize_story_for_project(result)
            self.assertEqual(updated["timeline"], result["timeline"])
            result = updated
        a, b = result["timeline"]["video"]
        first, second, third = result["timeline"]["text"]
        self.assertEqual(a["end"], b["start"])
        self.assertGreater(a["end"], first["end"])
        self.assertLess(a["end"], second["end"])
        self.assertEqual(b["end"], third["end"])

    def test_text_side_only_links_do_not_get_zipped_by_scene_index(self):
        value = draft()
        for text, ids in zip(value["timeline"]["text"], [["a"], ["a"], ["b", "c"]]):
            text["video_ids"] = ids
        for video in value["timeline"]["video"]:
            video.pop("text_ids")
        self.assertEqual(linked_draft_issues(value["timeline"], CATALOG), [])
        result = story(value)
        # Also exercise the generic normalizer with only reverse links supplied.
        for video in result["timeline"]["video"]:
            video.pop("text_ids")
            video.pop("text_id")
        result = normalize_story_for_project(result)
        self.assertEqual([v["text_ids"] for v in result["timeline"]["video"]], [["first", "second"], ["third"], ["third"]])
        self.assertEqual(result["timeline"]["text"][1]["video_ids"], ["a"])

    def test_no_truncation_or_hidden_sixty_second_cap(self):
        value = draft()
        long_text = " ".join(["nội dung đầy đủ"] * 150)
        value["timeline"] = {"video": [{"id": "a", "type": "image", "text_ids": ["long"]}],
                             "text": [{"id": "long", "text": long_text}]}
        value["plan"]["duration_seconds"] = 25  # Stale model value must not reintroduce a target.
        compact = normalize_compact_draft(value)
        self.assertEqual(compact["scenes"][0]["voice_text"], long_text)
        quality = evaluate_compact_draft(compact, [{"id": "F1", "text": long_text}], available_media=[])
        self.assertTrue(quality.passed, quality.to_dict())
        self.assertGreater(build_timeline_from_compact_scenes(compact)["duration"], 60)
        value["timeline"]["text"] = [{"id": f"t{i}", "text": f"đoạn lời {i}"} for i in range(24)]
        value["timeline"]["video"][0]["text_ids"] = [t["id"] for t in value["timeline"]["text"]]
        self.assertEqual(len(normalize_compact_draft(value)["scenes"]), 24)

    def test_structural_errors_are_critical_and_never_silently_repaired(self):
        mutations = {
            "DUPLICATE_CLIP_ID": lambda t: t["text"][1].update(id="first"),
            "UNKNOWN_LINK_ID": lambda t: t["video"][0].update(text_ids=["missing"]),
            "UNLINKED_TEXT": lambda t: t["video"][0].update(text_ids=["first"]),
            "UNLINKED_MEDIA": lambda t: t["video"].append({"id": "d", "type": "image", "text_ids": []}),
            "CONFLICTING_MEDIA_LINKS": lambda t: t["text"][0].update(video_ids=["b"]),
            "NON_SEQUENTIAL_MEDIA_LINKS": lambda t: t["video"][1].update(text_ids=["first", "third"]),
            "INVALID_SOURCE_MEDIA_INDEX": lambda t: t["video"][0].update(source_media_index=99),
            "SOURCE_MEDIA_TYPE_MISMATCH": lambda t: t["video"][1].update(source_media_index=0),
            "MISSING_VIDEO_SOURCE": lambda t: t["video"][1].pop("source_media_index"),
            "INVALID_LINK_IDS": lambda t: t["video"][0].update(text_ids="first"),
            "EMPTY_DRAFT_TEXT": lambda t: t["text"][0].update(text=""),
            "INVALID_DRAFT_TEXT": lambda t: t["text"][0].update(text={"bad": "value"}),
            "INVALID_CLIP_ID": lambda t: t["text"].append(None),
        }
        for code, mutate in mutations.items():
            with self.subTest(code=code):
                value = draft()
                mutate(value["timeline"])
                compact = normalize_compact_draft(value)
                quality = evaluate_compact_draft(compact, FACTS, available_media=CATALOG)
                self.assertFalse(quality.passed)
                self.assertIn(code, [i.code for i in quality.issues])
                with self.assertRaises(ValueError):
                    build_timeline_from_compact_scenes(compact, available_media=CATALOG)

    def test_source_catalog_keeps_video_and_does_not_expose_urls_to_prompt(self):
        catalog = source_media_catalog([
            {"media_type": "IMAGE", "storage_url": "a.jpg"},
            {"media_type": "VIDEO", "source_url": "b.mp4", "thumbnail_url": "b.jpg"},
            {"media_type": "VIDEO", "thumbnail_url": "only-thumbnail.jpg"},
            {"media_type": "IMAGE", "storage_url": "a.jpg"},
        ])
        self.assertEqual([v["type"] for v in catalog], ["image", "video"])
        self.assertEqual(catalog[1]["src"], "b.mp4")
        self.assertNotIn("src", media_prompt_catalog(catalog)[1])

    def test_full_source_and_risk_checks_still_apply(self):
        value = draft()
        value["timeline"]["text"][0]["text"] += " có 999 hồ sơ"
        value["risk_flags"] = [{"type": "FACTUAL", "severity": "HIGH"}]
        quality = evaluate_compact_draft(normalize_compact_draft(value), FACTS, available_media=CATALOG)
        self.assertIn("UNSUPPORTED_NUMBER", [i.code for i in quality.issues])
        self.assertIn("HIGH_RISK_FLAG", [i.code for i in quality.issues])

    def test_recheck_reads_edited_timeline_not_stale_compact_copy(self):
        result = story()
        result["timeline"]["text"][0]["text"] += " 999"
        project = SimpleNamespace(metadata_json={"selection_mode": "AUTO", "confidence_score": 90})
        _recheck_auto_compact_quality(project, result)
        issues = project.metadata_json["draft_quality_recheck"]["issues"]
        self.assertIn("UNSUPPORTED_NUMBER", [i["code"] for i in issues])
        self.assertNotIn("INVALID_DURATION", [i["code"] for i in issues])
        sync_compact_scenes(result)
        payload = public_story_payload(result)
        self.assertEqual(payload["compact_scenes"][2]["text_id"], "third")
        self.assertEqual(payload["compact_scenes"][2]["video_ids"], ["b", "c"])
        self.assertNotIn("evidence_ids", payload["compact_scenes"][0])

    def test_voice_alignment_keeps_shared_text_once_and_refits_both_tracks(self):
        result = story()
        result["audio"] = {"voice": "voice-test.mp3", "voiceDuration": 12}
        segments = [{"start": i * 4, "end": (i + 1) * 4, "text": t["text"]} for i, t in enumerate(result["timeline"]["text"])]
        transcription = {"duration": 12, "segments": segments, "text": " ".join(t["text"] for t in result["timeline"]["text"])}
        with patch("app.video.services.generate_video_alignment.get_settings", return_value=SimpleNamespace(openai_api_key="test")), patch.object(Path, "exists", return_value=True), patch("app.video.services.generate_video_alignment.transcribe_whisper", return_value=transcription):
            fitted = fit_frames_with_whisper(result)["story"]
        self.assertEqual(len(fitted["timeline"]["text"]), 3)
        a, b, c = fitted["timeline"]["video"]
        self.assertEqual(a["end"], 8)
        self.assertEqual((b["start"], b["end"], c["end"]), (8, 10, 12))
        self.assertEqual(fitted["timeline"]["text"][2]["video_ids"], ["b", "c"])
        self.assertEqual(fitted["meta"]["timing_mode"], "voice_aligned")

    def test_successful_ai_review_keeps_shared_links(self):
        original = story()
        response = {"approved": True, "timeline": deepcopy(original["timeline"]), "notes": []}
        completion = ChatCompletionResult(provider="deepseek", model="test", content=json.dumps(response), raw_response={}, latency_ms=0)
        with (
            patch("app.video.services.generate_video_scripting.get_settings", return_value=SimpleNamespace(deepseek_api_key="test", deepseek_base_url="https://example.test")),
            patch("app.video.services.generate_video_scripting.deepseek_chat_completion", return_value=completion),
            patch("app.video.services.generate_video_scripting.log_prompt_run"),
        ):
            reviewed = review_story_with_ai(original)
        self.assertEqual(reviewed["timeline"]["text"][2]["video_ids"], ["b", "c"])
        self.assertEqual(reviewed["timeline"]["video"][0]["text_ids"], ["first", "second"])
        self.assertIn("reviewed_at", reviewed["meta"]["ai_story_review"])

    def test_ai_edit_preserves_omitted_links_by_id_and_sends_full_source(self):
        original = story()
        original["meta"]["source_facts"] = [{"id": "F1", "text": "nguồn " * 1400}]
        response = deepcopy(original["timeline"])
        for clip in response["video"]:
            clip.pop("text_ids", None)
            clip.pop("text_id", None)
        for clip in response["text"]:
            clip.pop("video_ids", None)
            clip.pop("video_id", None)
        completion = ChatCompletionResult(provider="deepseek", model="test", content=json.dumps({"timeline": response}), raw_response={}, latency_ms=0)
        with (
            patch("app.video.services.generate_video_scripting.get_settings", return_value=SimpleNamespace(deepseek_api_key="test", deepseek_base_url="https://example.test")),
            patch("app.video.services.generate_video_scripting.deepseek_chat_completion", return_value=completion) as call,
            patch("app.video.services.generate_video_scripting.log_prompt_run"),
            patch("app.video.services.generate_video_scripting.review_story_with_ai", side_effect=lambda value, *args: value),
        ):
            edited = edit_story_with_ai(original, "Giữ nội dung, chỉnh trình bày")
        self.assertEqual(edited["timeline"]["video"][0]["text_ids"], ["first", "second"])
        self.assertEqual(edited["timeline"]["text"][2]["video_ids"], ["b", "c"])
        payload = json.loads(call.call_args.kwargs["messages"][1]["content"])
        self.assertEqual(payload["source_document"]["sections"], original["meta"]["source_facts"])
        self.assertIn("text_ids", payload["required_output"]["timeline"]["video"][0])

    def test_ai_review_does_not_add_duration_contract_or_accept_broken_links(self):
        original = story()
        before = deepcopy(original)
        response = deepcopy(original["timeline"])
        response["video"][0]["text_ids"] = ["nonexistent"]
        completion = ChatCompletionResult(provider="deepseek", model="test", content=json.dumps({"approved": True, "timeline": response}), raw_response={}, latency_ms=0)
        with (
            patch("app.video.services.generate_video_scripting.get_settings", return_value=SimpleNamespace(deepseek_api_key="test", deepseek_base_url="https://example.test")),
            patch("app.video.services.generate_video_scripting.deepseek_chat_completion", return_value=completion) as call,
            patch("app.video.services.generate_video_scripting.log_prompt_run"),
        ):
            with self.assertRaisesRegex(RuntimeError, "UNKNOWN_LINK_ID"):
                review_story_with_ai(original)
        payload = json.loads(call.call_args.kwargs["messages"][1]["content"])
        self.assertNotIn("duration_contract", payload)
        self.assertEqual(original, before)

    def test_review_without_provider_keeps_independent_tracks(self):
        with patch("app.video.services.generate_video_scripting.get_settings", return_value=SimpleNamespace(deepseek_api_key="")):
            result = review_story_with_ai(story())
        self.assertEqual(result["meta"]["ai_story_review"]["action"], "SKIPPED_NO_DEEPSEEK_KEY")
        self.assertEqual(result["timeline"]["text"][2]["video_ids"], ["b", "c"])


class LinkedPlannerTests(unittest.TestCase):
    def run_planner(self, outputs):
        planner = AutoWorkflowPlanner()
        profile = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4(), platform="tiktok")
        strategy = SimpleNamespace(tone="Tự nhiên", target_audience="Người dân", content_topics="Thủ tục", avoid_topics="", risk_level="medium", require_video=False, min_similarity=.35)
        media = [{"media_type": item["type"].upper(), "source_url": item["src"]} for item in CATALOG]
        content = SimpleNamespace(id=uuid.uuid4(), canonical_title="Thủ tục", normalized_title="thu tuc", summary="", quality_score=90, status="READY", media_jsonb=media)
        completions = [ChatCompletionResult(provider="openai", model="test", content=json.dumps(value), raw_response={}, latency_ms=0) for value in outputs]
        with patch.object(planner, "script_source", return_value={"title": "Thủ tục", "source_content": {"full_text": FACTS[0]["text"]}}), patch("app.planning.services.auto_workflow_planner.extract_source_facts", return_value=FACTS * 5), patch("app.planning.services.auto_workflow_planner.get_settings", return_value=SimpleNamespace(openai_api_key="test", deepseek_api_key="", openai_model="test")), patch("app.planning.services.auto_workflow_planner.log_prompt_run"), patch.object(planner, "rank_series_candidates", return_value=[]), patch.object(planner, "call_llm", side_effect=completions) as call:
            decision = planner.decide_and_build_draft(MagicMock(), profile=profile, strategy=strategy, content=content, candidate_metadata={"embedding_similarity": .9, "similarity_threshold": .35})
        return decision, call

    def test_planner_emits_linked_draft_without_extra_call(self):
        decision, call = self.run_planner([draft()])
        self.assertTrue(decision.should_create_workflow, decision.error_message)
        self.assertEqual(call.call_count, 1)
        self.assertEqual(decision.metadata["quality"]["status"], "PASS")
        self.assertEqual(decision.story["meta"]["draft_generation_mode"], "compact-v2")
        self.assertNotIn("target_duration_seconds", decision.story["meta"])
        self.assertEqual(decision.story["compact_scenes"][2]["text_id"], "third")
        self.assertEqual(call.call_args.args[2]["available_media"][1]["type"], "video")

    def test_link_error_triggers_one_repair_with_complete_graph_and_catalog(self):
        invalid = draft()
        invalid["timeline"]["video"][0]["text_ids"].append("unknown")
        decision, call = self.run_planner([invalid, draft()])
        self.assertTrue(decision.should_create_workflow, decision.error_message)
        self.assertEqual(call.call_count, 2)
        repair = call.call_args_list[1].args[2]
        self.assertNotIn("scenes", repair["current_draft"])
        self.assertEqual(repair["current_draft"]["timeline"], invalid["timeline"])
        self.assertEqual(repair["available_media"], call.call_args_list[0].args[2]["available_media"])
        self.assertIn("UNKNOWN_LINK_ID", [i["code"] for i in repair["quality_issues"]])
        self.assertEqual(decision.metadata["quality"]["retry_count"], 1)

    def test_invalid_links_after_retry_do_not_start_production(self):
        invalid = draft()
        invalid["timeline"]["video"][0]["text_ids"].append("unknown")
        decision, call = self.run_planner([invalid, invalid])
        self.assertFalse(decision.should_create_workflow)
        self.assertEqual(call.call_count, 2)
        self.assertIn("UNKNOWN_LINK_ID", decision.error_message)

    def test_new_call_cannot_silently_fall_back_to_legacy_one_to_one_output(self):
        legacy = {"version": "compact-v1", "confidence_score": 90,
                  "plan": {"title": "Thủ tục", "format": "EXPLAINER", "duration_seconds": 40},
                  "scenes": [{"role": "CONTEXT", "voice_text": FACTS[0]["text"], "evidence_ids": ["F1"]}]}
        decision, call = self.run_planner([legacy, draft()])
        self.assertEqual(call.call_count, 2)
        self.assertTrue(decision.should_create_workflow, decision.error_message)
        self.assertEqual(decision.story["meta"]["draft_generation_mode"], "compact-v2")
        repair = call.call_args_list[1].args[2]
        self.assertIn("MISSING_DRAFT_TRACK", [item["code"] for item in repair["quality_issues"]])


if __name__ == "__main__":
    unittest.main()
