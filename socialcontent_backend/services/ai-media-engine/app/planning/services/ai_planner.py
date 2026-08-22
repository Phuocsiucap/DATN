from __future__ import annotations

import json
import logging
import re
from typing import Any

from common.core.config import get_settings
from common.core.llm import ChatCompletionResult, deepseek_chat_completion, openai_chat_completion

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """Bạn là Chuyên gia Lập Kế hoạch Nội dung (Content Planner) hàng đầu cho (TikTok, Reels, Facebook).
Nhiệm vụ của bạn là phân tích tài khoản và nội dung đầu vào.
BƯỚC 1 (QUAN TRỌNG NHẤT): Đánh giá xem Nội dung đầu vào có THỰC SỰ phù hợp với Chiến lược tài khoản hay không. Nếu không phù hợp hoặc vi phạm chủ đề né tránh, hãy từ chối.
BƯỚC 2: Nếu phù hợp, hãy xây dựng một Content Plan độc đáo, kịch tính, thu hút khán giả.

YÊU CẦU CHẤT LƯỢNG NỘI DUNG:
- Không viết theo kiểu giới thiệu meta như "bài viết này nói về", "nội dung này đề cập", "hãy cùng tìm hiểu", "câu chuyện này".
- Đi thẳng vào sự kiện/nhân vật/vấn đề cụ thể của nguồn; hook, goal và main_beats phải chứa chi tiết thật từ title, summary hoặc trích đoạn gốc.
- Mỗi main_beats cần là một ý nội dung có thể chuyển thành lời dẫn/scene, không được là nhãn chung như "giới thiệu bối cảnh" hoặc "phát triển tình huống".
- Nếu dữ liệu nguồn quá mỏng, vẫn phải bám vào chi tiết có sẵn và ghi rõ hạn chế trong risk_notes.

Bạn BẮT BUỘC phải trả về kết quả dưới dạng cấu trúc JSON hợp lệ duy nhất, KHÔNG kèm thêm markdown fence hoặc bất kỳ giải thích nào bên ngoài.

Schema JSON đầu ra:
{
  "is_suitable": true/false,
  "rejection_reason": "Nếu is_suitable=false, ghi rõ lý do từ chối (VD: Nội dung không liên quan đến thể thao). Nếu true thì để null",
  "plan_title": "Tiêu đề kế hoạch nội dung thu hút (chỉ có khi is_suitable=true)",
  "content_angle": "Góc nhìn/hướng khai thác câu chuyện độc đáo (chỉ có khi is_suitable=true)",
  "tone": "Tông giọng đề xuất cho riêng nội dung này, vẫn phù hợp chiến lược tài khoản",
  "planning_mode": "SERIES hoặc SINGLE",
  "recommended_part_count": số_lượng_phần_nguyên,
  "target_duration_seconds": thời_lượng_mỗi_phần_giây,
  "target_series_id": "UUID chuỗi đang chạy nếu đây là bản cập nhật/tiếp nối của chuỗi đó, hoặc null nếu tạo chuỗi mới",
  "script_part": {
    "part_type": "OPENING/MIDDLE/ENDING",
    "title": "Tiêu đề part/kịch bản cho bài này",
    "goal": "Mục tiêu nội dung của bài",
    "hook_direction": "Cách mở đầu 3-5 giây đầu",
    "ending_direction": "Cách kết bài/kêu gọi tương tác",
    "previous_part_recap": null,
    "next_part_tease": null,
    "main_beats": ["Beat 1", "Beat 2", "Beat 3"],
    "production_notes": {"visuals": "...", "voice": "...", "editing": "..."},
    "risk_notes": ["Lưu ý rủi ro nếu có"]
  },
  "risk_flags": [
    {
      "type": "VIOLENCE/SENSITIVE/GENERAL",
      "severity": "LOW/MEDIUM/HIGH",
      "note": "Ghi chú rủi ro nếu có"
    }
  ],
  "reasoning": [
    "Lý do 1",
    "Lý do 2"
  ],
  "confidence_score": số_nguyên_từ_0_đến_100
}

Với nội dung dạng ARTICLE/bài báo hoặc yêu cầu SINGLE, hãy coi "script_part" là kịch bản hoàn chỉnh cho 1 bài video.
Chỉ đề xuất SERIES/nhiều part khi nguồn là story/playlist dài thật sự, người dùng yêu cầu rõ chia nhiều part, hoặc đang regenerate cả series lớn.
"""


DIRECT_SCRIPT_SYSTEM_PROMPT = """Bạn là Chuyên gia viết kịch bản video cho mạng xã hội.
Nhiệm vụ của bạn là tạo ngay Content Plan và script_part từ đúng nội dung người dùng đã chọn.
Không đánh giá độ phù hợp với chiến lược tài khoản, không chấm điểm candidate, không từ chối nội dung vì topic/tone/audience.
Nếu có chủ đề né tránh hoặc rủi ro, chỉ ghi vào risk_flags/risk_notes để người dùng biết khi biên tập.

YÊU CẦU CHẤT LƯỢNG NỘI DUNG:
- Không viết theo kiểu giới thiệu meta như "bài viết này nói về", "nội dung này đề cập", "hãy cùng tìm hiểu", "câu chuyện này".
- Đi thẳng vào sự kiện/nhân vật/vấn đề cụ thể của nguồn; hook, goal và main_beats phải chứa chi tiết thật từ title, summary hoặc trích đoạn gốc.
- Mỗi main_beats cần là một ý nội dung có thể chuyển thành lời dẫn/scene, không được là nhãn chung như "giới thiệu bối cảnh" hoặc "phát triển tình huống".
- Nếu dữ liệu nguồn quá mỏng, vẫn phải bám vào chi tiết có sẵn và ghi rõ hạn chế trong risk_notes.

Bạn BẮT BUỘC phải trả về JSON hợp lệ duy nhất, KHÔNG kèm markdown fence hoặc giải thích ngoài JSON.

Schema JSON đầu ra:
{
  "is_suitable": true,
  "rejection_reason": null,
  "plan_title": "Tiêu đề kế hoạch/kịch bản",
  "content_angle": "Góc triển khai video",
  "tone": "Tông giọng đề xuất cho riêng nội dung này",
  "planning_mode": "SINGLE hoặc SERIES",
  "recommended_part_count": số_lượng_phần_nguyên,
  "target_duration_seconds": thời_lượng_mỗi_phần_giây,
  "target_series_id": null,
  "script_part": {
    "part_type": "OPENING/MIDDLE/ENDING",
    "title": "Tiêu đề part/kịch bản",
    "goal": "Mục tiêu nội dung",
    "hook_direction": "Cách mở đầu 3-5 giây đầu",
    "ending_direction": "Cách kết bài/kêu gọi tương tác",
    "previous_part_recap": null,
    "next_part_tease": null,
    "main_beats": ["Beat 1", "Beat 2", "Beat 3"],
    "production_notes": {"visuals": "...", "voice": "...", "editing": "..."},
    "risk_notes": ["Lưu ý rủi ro nếu có"]
  },
  "risk_flags": [{"type": "GENERAL", "severity": "LOW/MEDIUM/HIGH", "note": "Ghi chú rủi ro nếu có"}],
  "reasoning": ["Đã tạo trực tiếp từ nội dung người dùng chọn"],
  "confidence_score": số_nguyên_từ_0_đến_100
}

Với nội dung dạng ARTICLE hoặc yêu cầu SINGLE, hãy coi script_part là kịch bản hoàn chỉnh cho 1 video.
"""


class AIPlannerService:
    def generate_plan(
        self,
        *,
        title: str,
        summary: str,
        content_type: str,
        source_excerpt: str | None,
        source_url: str | None,
        source_type: str | None,
        episode_count: int,
        quality: float,
        strategy_topics: str,
        avoid_topics: str,
        tone: str,
        target_audience: str,
        risk_level: str,
        planning_mode: str,
        preferred_part_count: int | None,
        target_duration: int | None,
        active_series: list[dict[str, Any]] | None = None,
        instructions: str | None = None,
        skip_ai_evaluation: bool = False,
    ) -> tuple[dict[str, Any], str, str, int, int, int, int]:
        """
        Generates structured plan payload.
        Returns (payload, provider_name, model_name, latency_ms, confidence_score, input_tokens, output_tokens)
        """
        settings = get_settings()

        active_series_str = ""
        if active_series and not skip_ai_evaluation:
            active_series_str = f"\nCác chuỗi nội dung đang chạy của kênh (Active Series), kèm tối đa 5 bài mới nhất của từng chuỗi:\n{json.dumps(active_series, ensure_ascii=False, indent=2)}\nChỉ điền 'target_series_id' khi nội dung đầu vào THỰC SỰ tiếp nối cùng mạch với một chuỗi đang chạy, dựa trên các bài gần nhất. Nếu chỉ cùng chủ đề rộng nhưng không cùng mạch nội dung, hãy để 'target_series_id': null để tạo chuỗi mới.\n"

        user_prompt = f"""
Nội dung đầu vào:
- Tiêu đề: {title}
- Tóm tắt: {summary or 'Nội dung tổng hợp từ nguồn crawl'}
- Loại nguồn: {content_type or 'UNKNOWN'}
- Nguồn crawl: {source_type or 'UNKNOWN'} - {source_url or 'Không có URL'}
- Số tập/phần có sẵn: {episode_count}
- Chất lượng dữ liệu: {quality:.0f}/100
{active_series_str}
Trích đoạn nội dung gốc để lập plan và viết script_part:
{source_excerpt or 'Không có trích đoạn nội dung gốc, chỉ được dùng summary.'}

Chiến lược tài khoản:
- Chủ đề ưu tiên: {strategy_topics or 'Không giới hạn'}
- Chủ đề né tránh: {avoid_topics or 'Không'}
- Tông giọng mong muốn: {tone or 'kịch tính, hấp dẫn'}
- Khán giả mục tiêu: {target_audience or 'Khán giả thích video ngắn'}
- Mức độ rủi ro chấp nhận: {risk_level or 'medium'}

Yêu cầu cụ thể:
- Chế độ lập kế hoạch: {planning_mode}
- Số phần ưu tiên: {preferred_part_count or 'Tự đề xuất dựa trên nội dung'}
- Thời lượng mỗi phần (giây): {target_duration or 60}
- Hướng dẫn bổ sung: {instructions or 'Không có'}

Nguyên tắc:
- Plan tổng quan có thể dùng title, summary, metadata và excerpt.
- Nếu trả về script_part cho ARTICLE/SINGLE, script_part phải bám vào trích đoạn nội dung gốc ở trên, không chỉ dựa vào summary.
- Không mở đầu bằng việc giới thiệu "bài viết/nội dung/câu chuyện"; hãy bắt đầu bằng chi tiết nổi bật nhất trong nguồn.
- main_beats phải đi sâu vào diễn biến/luận điểm/kết quả cụ thể, ưu tiên tên riêng, mốc thời gian, nguyên nhân, hệ quả, số liệu nếu nguồn có.
- Không dùng beat chung chung như "Mở bằng bối cảnh", "Tóm tắt diễn biến", "Chốt lại ý nghĩa" nếu không kèm chi tiết nguồn.
{"- Đây là yêu cầu tạo kịch bản trực tiếp: bỏ qua chấm điểm, bỏ qua đánh giá phù hợp, không reject nội dung." if skip_ai_evaluation else ""}
"""
        system_prompt = DIRECT_SCRIPT_SYSTEM_PROMPT if skip_ai_evaluation else SYSTEM_PROMPT
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        source_text = source_excerpt or summary
        provider_errors: list[str] = []

        if settings.openai_api_key:
            try:
                result = openai_chat_completion(
                    api_key=settings.openai_api_key,
                    model=settings.openai_model or "gpt-4o-mini",
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.7,
                    timeout=30,
                )
                return self._provider_result_to_payload(
                    result,
                    skip_ai_evaluation=skip_ai_evaluation,
                    title=title,
                    episode_count=episode_count,
                    target_duration=target_duration,
                    source_text=source_text,
                    default_tone=tone,
                    default_target_audience=target_audience,
                )
            except Exception as exc:
                provider_errors.append(f"openai: {exc}")
                logger.warning("OpenAI planning call failed, trying DeepSeek: %s", exc)

        if settings.deepseek_api_key:
            try:
                result = deepseek_chat_completion(
                    base_url=settings.deepseek_base_url,
                    api_key=settings.deepseek_api_key,
                    model="deepseek-v4-flash",
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.7,
                    timeout=30,
                )
                return self._provider_result_to_payload(
                    result,
                    skip_ai_evaluation=skip_ai_evaluation,
                    title=title,
                    episode_count=episode_count,
                    target_duration=target_duration,
                    source_text=source_text,
                    default_tone=tone,
                    default_target_audience=target_audience,
                )
            except Exception as exc:
                provider_errors.append(f"deepseek: {exc}")
                logger.warning("DeepSeek planning call failed: %s", exc)

        if provider_errors:
            raise RuntimeError(f"AI planning failed; {'; '.join(provider_errors)}")
        raise RuntimeError("Missing OPENAI_API_KEY or DEEPSEEK_API_KEY for AI planning")

    def _provider_result_to_payload(
        self,
        result: ChatCompletionResult,
        *,
        skip_ai_evaluation: bool,
        title: str,
        episode_count: int,
        target_duration: int | None,
        source_text: str | None,
        default_tone: str | None,
        default_target_audience: str | None,
    ) -> tuple[dict[str, Any], str, str, int, int, int, int]:
        parsed = result.parsed_json()

        if skip_ai_evaluation:
            parsed["is_suitable"] = True
            parsed["rejection_reason"] = None

        in_tok = result.input_tokens
        out_tok = result.output_tokens

        if not parsed.get("is_suitable", True):
            return parsed, result.provider, result.model, result.latency_ms, 0, in_tok, out_tok

        validated = self._validate_and_sanitize(
            parsed,
            title,
            episode_count,
            target_duration,
            source_text,
            default_tone=default_tone,
            default_target_audience=default_target_audience,
        )
        return (
            validated,
            result.provider,
            result.model,
            result.latency_ms,
            int(validated.get("confidence_score", 85)),
            in_tok,
            out_tok,
        )

    def _validate_and_sanitize(
        self,
        payload: dict[str, Any],
        fallback_title: str,
        episode_count: int,
        target_duration: int | None,
        source_text: str | None = None,
        default_tone: str | None = None,
        default_target_audience: str | None = None,
    ) -> dict[str, Any]:
        if not payload.get("plan_title"):
            payload["plan_title"] = f"{fallback_title} - Kế hoạch video"
        if not payload.get("content_angle"):
            payload["content_angle"] = f"Khai thác góc nhìn hấp dẫn từ {fallback_title}"
        payload["target_audience"] = default_target_audience or payload.get("target_audience") or "Khán giả thích video ngắn"
        payload["tone"] = payload.get("tone") or default_tone or "kịch tính, hấp dẫn"
        payload["format"] = "NARRATED_STORY"
        if not payload.get("planning_mode"):
            payload["planning_mode"] = "SERIES" if episode_count > 1 else "SINGLE"
        parts = payload.get("recommended_part_count")
        if not isinstance(parts, int) or parts <= 0:
            payload["recommended_part_count"] = min(max(episode_count, 1), 8)
        if not payload.get("target_duration_seconds"):
            payload["target_duration_seconds"] = target_duration or 60
        target_series = payload.get("target_series_id")
        if target_series and not isinstance(target_series, str):
            payload["target_series_id"] = None
        else:
            payload["target_series_id"] = target_series
        payload["production_requirements"] = self._production_requirements(payload.get("planning_mode"))
        if not payload.get("risk_flags"):
            payload["risk_flags"] = [{"type": "GENERAL", "severity": "LOW", "note": "Ghi nhận từ AI Analysis"}]
        if not payload.get("reasoning"):
            payload["reasoning"] = ["Đã qua bộ lọc AI Planner"]
        payload["script_part"] = self._sanitize_script_part(
            payload.get("script_part"),
            fallback_title,
            payload.get("content_angle") or "",
            int(payload.get("target_duration_seconds") or target_duration or 60),
            source_text,
        )
        return payload

    def _production_requirements(self, planning_mode: str | None) -> dict[str, bool]:
        return {
            "requires_voice": True,
            "requires_subtitles": True,
            "requires_background_media": True,
            "requires_character_consistency": planning_mode == "SERIES",
        }

    def _sanitize_script_part(
        self,
        raw: Any,
        fallback_title: str,
        fallback_angle: str,
        target_duration: int,
        source_text: str | None = None,
    ) -> dict[str, Any]:
        part = raw if isinstance(raw, dict) else {}
        part_type = part.get("part_type")
        if part_type not in {"OPENING", "MIDDLE", "ENDING"}:
            part_type = "OPENING"

        main_beats = part.get("main_beats")
        if not isinstance(main_beats, list) or not main_beats:
            main_beats = self._fallback_beats_from_source(source_text or fallback_angle, fallback_title)
        main_beats = [str(item) for item in main_beats if str(item).strip()]
        if self._beats_are_too_generic(main_beats):
            main_beats = self._fallback_beats_from_source(source_text or fallback_angle, fallback_title)

        risk_notes = part.get("risk_notes")
        if not isinstance(risk_notes, list):
            risk_notes = []
        risk_notes = [str(item) for item in risk_notes if str(item).strip()]

        production_notes = part.get("production_notes")
        if not isinstance(production_notes, (dict, list, str)):
            production_notes = {}

        return {
            "part_type": part_type,
            "title": str(part.get("title") or fallback_title),
            "goal": str(part.get("goal") or fallback_angle or f"Kể lại nội dung {fallback_title} thành một video ngắn."),
            "hook_direction": str(part.get("hook_direction") or "Mở bằng chi tiết gây tò mò nhất trong bài."),
            "ending_direction": str(part.get("ending_direction") or "Kết bằng câu hỏi để kéo bình luận."),
            "previous_part_recap": part.get("previous_part_recap"),
            "next_part_tease": part.get("next_part_tease"),
            "target_duration_seconds": target_duration,
            "main_beats": main_beats,
            "production_notes": production_notes,
            "risk_notes": risk_notes,
        }

    def _fallback_beats_from_source(self, source_text: str | None, title: str) -> list[str]:
        sentences = self._source_sentences(source_text)
        if not sentences:
            return [
                f"{title}: nêu chi tiết cụ thể nhất đang có trong dữ liệu nguồn.",
                "Làm rõ nguyên nhân, diễn biến hoặc luận điểm chính dựa trên phần tóm tắt hiện có.",
                "Kết bằng hệ quả trực tiếp hoặc điểm còn bỏ ngỏ từ nội dung nguồn.",
            ]
        if len(sentences) <= 3:
            return sentences
        middle_index = len(sentences) // 2
        picked = [sentences[0], sentences[middle_index], sentences[-1]]
        unique: list[str] = []
        for item in picked:
            if item not in unique:
                unique.append(item)
        return unique

    def _source_sentences(self, text: str | None) -> list[str]:
        if not text:
            return []
        cleaned = re.sub(r"\s+", " ", str(text)).strip()
        if not cleaned:
            return []
        parts = re.split(r"(?<=[.!?。！？])\s+|\n+", cleaned)
        sentences = []
        for part in parts:
            compact = self._compact_text(part, 220)
            if len(compact) >= 24 and not self._is_meta_intro(compact):
                sentences.append(compact)
            if len(sentences) >= 6:
                break
        if not sentences and cleaned:
            sentences.append(self._compact_text(cleaned, 220))
        return sentences

    def _compact_text(self, value: str | None, limit: int) -> str:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        if len(text) <= limit:
            return text
        return text[: max(0, limit - 1)].rstrip() + "..."

    def _beats_are_too_generic(self, beats: list[str]) -> bool:
        if not beats:
            return True
        generic_count = sum(1 for beat in beats if self._is_meta_intro(beat) or len(beat.strip()) < 18)
        return generic_count >= max(1, len(beats) // 2)

    def _is_meta_intro(self, value: str) -> bool:
        text = value.lower()
        patterns = [
            "bài viết này",
            "bai viet nay",
            "nội dung này",
            "noi dung nay",
            "câu chuyện này",
            "cau chuyen nay",
            "hãy cùng tìm hiểu",
            "hay cung tim hieu",
            "giới thiệu",
            "gioi thieu",
            "mở bằng bối cảnh",
            "mo bang boi canh",
            "tóm tắt các diễn biến",
            "tom tat cac dien bien",
            "phát triển tình huống",
            "phat trien tinh huong",
            "hook mở đầu",
            "hook 3s",
        ]
        return any(pattern in text for pattern in patterns)
