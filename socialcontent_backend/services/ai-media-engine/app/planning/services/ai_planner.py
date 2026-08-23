from __future__ import annotations

import json
import logging
import re
from typing import Any

from common.core.config import get_settings
from common.core.llm import ChatCompletionResult, deepseek_chat_completion, openai_chat_completion

logger = logging.getLogger(__name__)


DEFAULT_SCENE_IMAGES = [
    "assets/images/001-signal-room.png",
    "assets/images/002-alien-tower.png",
    "assets/images/003-final-light.png",
]
DEFAULT_SCENE_EFFECTS = ["slow-zoom", "pan-right", "pan-left", "push-in"]


SYSTEM_PROMPT = """Bạn là Chuyên gia tạo story_data sản xuất video ngắn cho TikTok, Reels, Facebook.
Nhiệm vụ của bạn là phân tích tài khoản và nội dung đầu vào.
BƯỚC 1 (QUAN TRỌNG NHẤT): Đánh giá xem Nội dung đầu vào có THỰC SỰ phù hợp với Chiến lược tài khoản hay không. Nếu không phù hợp hoặc vi phạm chủ đề né tránh, hãy từ chối.
BƯỚC 2: Nếu phù hợp, hãy sinh THẲNG story_data theo từng scene để đưa vào xưởng video. Không sinh outline, không sinh script_parts, không chia bước lập kế hoạch.

YÊU CẦU CHẤT LƯỢNG NỘI DUNG:
- Không viết theo kiểu giới thiệu meta như "bài viết này nói về", "nội dung này đề cập", "hãy cùng tìm hiểu", "câu chuyện này".
- Đi thẳng vào sự kiện/nhân vật/vấn đề cụ thể của nguồn; mỗi scene phải chứa chi tiết thật từ title, summary hoặc trích đoạn gốc.
- `subtitle` là lời thoại/phụ đề tiếng Việt của scene, có thể đem đi TTS ngay.
- `voice_text` chỉ dùng khi cần lời thoại dài hơn subtitle.
- Mỗi scene dùng đúng schema video cũ: duration, image, effect, subtitle, fit và các field media/timing optional.
- Tổng thời lượng story_data phải khớp target_duration_seconds. Với video 60 giây phải có 12-15 scene, mỗi scene thường 4-5 giây; không được trả 3-4 scene rồi kéo duration lên 8 giây.
- `image` chỉ được dùng default asset được cung cấp trong schema hoặc để null; không tự bịa đường dẫn asset theo nội dung.
- `effect` chỉ dùng một trong: slow-zoom, pan-right, pan-left, push-in. Không dùng hiệu ứng rung, xoay, giật.
- Không tạo nhãn chung chung như "giới thiệu bối cảnh", "phát triển tình huống" nếu không có chi tiết nguồn.
- Nếu dữ liệu nguồn quá mỏng để đủ target duration, giảm `target_duration_seconds` xuống tổng thời lượng thật và ghi rõ `SOURCE_TOO_THIN` trong risk_flags; không được báo 60 giây khi story_data chỉ đủ 30 giây.
- QUAN TRỌNG VỀ TÊN CHUỖI (series_title): `series_title` BẮT BUỘC phải là một tên chủ đề rộng, bao quát và mang tính thương hiệu lâu dài (VD: "Tiêu Điểm An Toàn Giao Thông", "Góc Nhìn Kinh Tế Số", "Bí Ẩn Lịch Sử"). KHÔNG ĐƯỢC đặt `series_title` theo tiêu đề cụ thể của đúng 1 bài viết đơn lẻ để các bài viết cùng chủ đề sau này có thể vào chung chuỗi này.

Bạn BẮT BUỘC phải trả về kết quả dưới dạng cấu trúc JSON hợp lệ duy nhất, KHÔNG kèm thêm markdown fence hoặc bất kỳ giải thích nào bên ngoài.

Schema JSON đầu ra:
{
  "is_suitable": true/false,
  "rejection_reason": "Nếu is_suitable=false, ghi rõ lý do từ chối (VD: Nội dung không liên quan đến thể thao). Nếu true thì để null",
  "series_title": "Tên chuỗi/chủ đề rộng bao quát (VD: 'Tiêu Điểm Giao Thông', 'Kinh Tế Số 24/7'). BẮT BUỘC mang tính tổng quát để các bài viết khác cùng chủ đề có thể tham gia vào chuỗi này. KHÔNG ĐƯỢC lấy tiêu đề riêng của 1 bài báo làm series_title",
  "plan_title": "Tiêu đề kịch bản/video cụ thể cho riêng bài viết/tập này",
  "content_angle": "Góc nhìn/hướng khai thác câu chuyện độc đáo (chỉ có khi is_suitable=true)",
  "tone": "Tông giọng đề xuất cho riêng nội dung này, vẫn phù hợp chiến lược tài khoản",
  "planning_mode": "SERIES hoặc SINGLE",
  "recommended_part_count": 1,
  "target_duration_seconds": thời_lượng_video_giây,
  "target_series_id": "UUID chuỗi đang chạy nếu đây là bản cập nhật/tiếp nối của chuỗi đó, hoặc null nếu tạo chuỗi mới",
  "story_data": [
  {
    "duration": 4,
    "image": "assets/images/001-signal-room.png",
    "effect": "slow-zoom",
    "fit": "cover",
    "subtitle": "Câu chữ/lời thoại tiếng Việt để hiện trên màn hình",
    "voice_text": "Lời thoại TTS nếu khác subtitle"
  }
  ],
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

Với nội dung dạng ARTICLE/bài báo hoặc yêu cầu SINGLE, hãy trả về story_data cho đúng 1 video.
Chỉ đề xuất SERIES/nhiều part khi nguồn là story/playlist dài thật sự, người dùng yêu cầu rõ chia nhiều part, hoặc đang regenerate cả series lớn.
"""


DIRECT_SCRIPT_SYSTEM_PROMPT = """Bạn là Chuyên gia tạo story_data video cho mạng xã hội.
Nhiệm vụ của bạn là tạo ngay story_data từng scene từ đúng nội dung người dùng đã chọn.
Không đánh giá độ phù hợp với chiến lược tài khoản, không chấm điểm candidate, không từ chối nội dung vì topic/tone/audience.
Nếu có chủ đề né tránh hoặc rủi ro, chỉ ghi vào risk_flags để người dùng biết khi biên tập.

YÊU CẦU CHẤT LƯỢNG NỘI DUNG:
- Không viết theo kiểu giới thiệu meta như "bài viết này nói về", "nội dung này đề cập", "hãy cùng tìm hiểu", "câu chuyện này".
- Mỗi scene phải có `duration`, `image`, `effect`, `subtitle`; có thể thêm `voice_text` nếu lời thoại TTS cần dài hơn subtitle.
- Tổng thời lượng story_data phải khớp target_duration_seconds. Với video 60 giây phải có 12-15 scene, mỗi scene thường 4-5 giây; không được trả 3-4 scene rồi kéo duration lên 8 giây.
- `image` chỉ được dùng default asset được cung cấp trong schema hoặc để null; không tự bịa đường dẫn asset theo nội dung.
- `effect` chỉ dùng một trong: slow-zoom, pan-right, pan-left, push-in. Không dùng hiệu ứng rung, xoay, giật.
- Không sinh outline, không sinh script_parts, không trả về beat/part.
- Nếu dữ liệu nguồn quá mỏng để đủ target duration, giảm `target_duration_seconds` xuống tổng thời lượng thật và ghi rõ `SOURCE_TOO_THIN` trong risk_flags.
- `series_title` BẮT BUỘC là tên chủ đề rộng bao quát cho chuỗi (VD: "Tin Tức Công Nghệ", "Hồ Sơ Vụ Án").

Bạn BẮT BUỘC phải trả về JSON hợp lệ duy nhất, KHÔNG kèm markdown fence hoặc giải thích ngoài JSON.

Schema JSON đầu ra:
{
  "is_suitable": true,
  "rejection_reason": null,
  "series_title": "Tên chuỗi/chủ đề rộng bao quát cho Series",
  "plan_title": "Tiêu đề kịch bản/video cụ thể",
  "content_angle": "Góc triển khai video",
  "tone": "Tông giọng đề xuất cho riêng nội dung này",
  "planning_mode": "SINGLE hoặc SERIES",
  "recommended_part_count": 1,
  "target_duration_seconds": thời_lượng_video_giây,
  "target_series_id": null,
  "story_data": [
  {
    "duration": 4,
    "image": "assets/images/001-signal-room.png",
    "effect": "slow-zoom",
    "fit": "cover",
    "subtitle": "Phụ đề/lời thoại tiếng Việt",
    "voice_text": "Lời thoại TTS nếu khác subtitle"
  }
  ],
  "risk_flags": [{"type": "GENERAL", "severity": "LOW/MEDIUM/HIGH", "note": "Ghi chú rủi ro nếu có"}],
  "reasoning": ["Đã tạo trực tiếp từ nội dung người dùng chọn"],
  "confidence_score": số_nguyên_từ_0_đến_100
}

Với nội dung dạng ARTICLE hoặc yêu cầu SINGLE, hãy trả về story_data cho 1 video hoàn chỉnh.
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
            active_series_str = f"""
Các chuỗi nội dung đang chạy của kênh (Active Series), kèm tối đa 5 bài mới nhất của từng chuỗi:
{json.dumps(active_series, ensure_ascii=False, indent=2)}

HƯỚNG DẪN QUAN TRỌNG VỀ PHÂN LOẠI CHUỖI (SERIES):
- Hãy kiểm tra xem bài viết/nội dung mới này có cùng chủ đề rộng, cùng lĩnh vực hoặc cùng hướng phát triển với một trong các Active Series ở trên hay không.
- Nếu CÓ: Hãy ĐIỀN 'target_series_id' bằng UUID của series đó để xếp bài mới vào chung chuỗi.
- Nếu KHÔNG (nội dung thuộc chủ đề mới): Hãy để 'target_series_id': null và ĐẶT 'series_title' MỚI thật bao quát để các bài viết cùng chủ đề sau này có thể tham gia vào chuỗi này.
"""

        user_prompt = f"""
Nội dung đầu vào:
- Tiêu đề: {title}
- Tóm tắt: {summary or 'Nội dung tổng hợp từ nguồn crawl'}
- Loại nguồn: {content_type or 'UNKNOWN'}
- Nguồn crawl: {source_type or 'UNKNOWN'} - {source_url or 'Không có URL'}
- Số tập/phần có sẵn: {episode_count}
- Chất lượng dữ liệu: {quality:.0f}/100
{active_series_str}
Trích đoạn nội dung gốc để viết kịch bản sản xuất:
- Khán giả mục tiêu: {target_audience or 'Khán giả thích video ngắn'}
- Mức độ rủi ro chấp nhận: {risk_level or 'medium'}

Yêu cầu cụ thể:
- Chế độ lập kế hoạch: {planning_mode}
- Số phần ưu tiên: {preferred_part_count or 'Tự đề xuất dựa trên nội dung'}
- Thời lượng mỗi phần (giây): {target_duration or 60}
- Hướng dẫn bổ sung: {instructions or 'Không có'}

Nguyên tắc:
- Plan tổng quan có thể dùng title, summary, metadata và excerpt.
- story_data phải bám vào trích đoạn nội dung gốc ở trên, không chỉ dựa vào summary.
- Tổng duration của story_data phải nằm trong khoảng 90%-110% thời lượng yêu cầu.
- Số scene tối thiểu: 30s cần 6 scene, 45s cần 9 scene, 60s cần 12 scene, 90s cần 18 scene.
- Mỗi scene nên dài 4-5 giây. Chỉ dùng 6-8 giây khi câu thoại thật sự dài.
- Nếu là bản tin/tổng hợp có nhiều headline, hãy tách từng headline thành nhiều scene: sự kiện, địa điểm/nhân vật, tác động, điểm cần theo dõi.
- Không bịa đường dẫn image theo chủ đề; image để null hoặc dùng default asset trong schema.
- Không mở đầu bằng việc giới thiệu "bài viết/nội dung/câu chuyện"; hãy bắt đầu bằng chi tiết nổi bật nhất trong nguồn.
- main_beats phải đi sâu vào diễn biến/luận điểm/kết quả cụ thể, ưu tiên tên riêng, mốc thời gian, nguyên nhân, hệ quả, số liệu nếu nguồn có.
- Không dùng beat chung chung như "Mở bằng bối cảnh", "Tóm tắt diễn biến", "Chốt lại ý nghĩa" nếu không kèm chi tiết nguồn.
{"- Đây là yêu cầu tạo story_data trực tiếp: bỏ qua chấm điểm, bỏ qua đánh giá phù hợp, không reject nội dung." if skip_ai_evaluation else ""}
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
        if not payload.get("series_title"):
            payload["series_title"] = payload.get("plan_title") or fallback_title
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
        payload["story_data"] = self._sanitize_story_data(
            payload,
            fallback_title,
            payload.get("content_angle") or "",
            int(payload.get("target_duration_seconds") or target_duration or 60),
            source_text,
        )
        payload.pop("script_parts", None)
        payload.pop("script_part", None)
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
            "visual_direction": str(part.get("visual_direction") or self._visual_direction(part.get("production_notes"))),
            "voiceover": str(part.get("voiceover") or self._voiceover_from_parts(part, main_beats)),
            "duration_seconds": target_duration,
            "target_duration_seconds": target_duration,
            "main_beats": main_beats,
            "production_notes": production_notes,
            "risk_notes": risk_notes,
        }

    def _sanitize_script_parts(
        self,
        payload: dict[str, Any],
        fallback_title: str,
        fallback_angle: str,
        target_duration: int,
        source_text: str | None = None,
    ) -> list[dict[str, Any]]:
        raw_parts = payload.get("script_parts")
        if not isinstance(raw_parts, list) or not raw_parts:
            raw_part = payload.get("script_part")
            raw_parts = [raw_part] if isinstance(raw_part, dict) else []
        if not raw_parts:
            raw_parts = [{}]
        result = []
        for index, raw in enumerate(raw_parts, start=1):
            part = self._sanitize_script_part(raw, fallback_title, fallback_angle, target_duration, source_text)
            part["part_number"] = int((raw if isinstance(raw, dict) else {}).get("part_number") or index)
            result.append(part)
        return result

    def _sanitize_story_data(
        self,
        payload: dict[str, Any],
        fallback_title: str,
        fallback_angle: str,
        target_duration: int,
        source_text: str | None = None,
    ) -> list[dict[str, Any]]:
        raw_scenes = payload.get("story_data")
        if not isinstance(raw_scenes, list) or not raw_scenes:
            raw_scenes = payload.get("scenes") if isinstance(payload.get("scenes"), list) else []
        if not raw_scenes:
            raw_scenes = self._scenes_from_legacy_script(payload, fallback_title, fallback_angle, target_duration, source_text)
        if not raw_scenes:
            raw_scenes = self._fallback_scenes_from_source(source_text or fallback_angle, fallback_title, target_duration)

        scenes: list[dict[str, Any]] = []
        for index, raw in enumerate(raw_scenes, start=1):
            scene = self._sanitize_story_scene(raw if isinstance(raw, dict) else {}, index, target_duration)
            if scene:
                scenes.append(scene)
        scenes = scenes or self._fallback_scenes_from_source(source_text or fallback_angle, fallback_title, target_duration)
        self._validate_story_density(scenes, target_duration)
        return scenes

    def _sanitize_story_scene(self, raw: dict[str, Any], index: int, target_duration: int) -> dict[str, Any] | None:
        voice_text = str(raw.get("voice_text") or raw.get("voiceover") or raw.get("narration") or raw.get("subtitle") or "").strip()
        subtitle = str(raw.get("subtitle") or raw.get("text") or voice_text).strip()
        if not voice_text and not subtitle:
            return None
        duration = raw.get("duration") if raw.get("duration") is not None else raw.get("duration_seconds")
        try:
            duration_value = float(duration)
        except (TypeError, ValueError):
            duration_value = max(3.0, min(8.0, len(voice_text.split()) / 2.5 + 0.8))
        image = self._valid_scene_image(raw.get("image") or raw.get("src"), index)
        scene = {
            "duration": round(max(3.0, min(8.0, duration_value)), 2),
            "image": image,
            "effect": DEFAULT_SCENE_EFFECTS[(index - 1) % len(DEFAULT_SCENE_EFFECTS)],
            "fit": "cover" if str(raw.get("fit") or "cover").lower() == "cover" else "contain",
            "subtitle": self._compact_text(subtitle, 140),
        }
        if voice_text and voice_text != scene["subtitle"]:
            scene["voice_text"] = voice_text
        for key in ("media_type", "scale", "opacity", "position_x", "position_y", "rotation", "subtitle_start", "subtitle_duration"):
            if raw.get(key) is not None:
                scene[key] = raw[key]
        if isinstance(raw.get("text_style"), dict):
            scene["text_style"] = raw["text_style"]
        if raw.get("voice_subtitle"):
            scene["voice_subtitle"] = str(raw["voice_subtitle"])
        if isinstance(raw.get("timing"), dict):
            scene["timing"] = raw["timing"]
        return scene

    def _validate_story_density(self, scenes: list[dict[str, Any]], target_duration: int) -> None:
        target = max(15, int(target_duration or 60))
        required_count = self._target_scene_count(target)
        total_duration = sum(float(scene.get("duration") or 0) for scene in scenes if isinstance(scene, dict))
        if len(scenes) < required_count:
            raise ValueError(f"AI story_data too sparse: expected at least {required_count} scenes for {target}s, got {len(scenes)}")
        if total_duration < target * 0.9 or total_duration > target * 1.1:
            raise ValueError(f"AI story_data duration mismatch: expected about {target}s, got {round(total_duration, 2)}s")

    def _target_scene_count(self, target_duration: int) -> int:
        return max(3, min(18, int(round(float(target_duration) / 5.0))))

    def _valid_scene_image(self, value: Any, index: int) -> str:
        image = str(value or "").strip()
        if image.startswith("http://") or image.startswith("https://"):
            return image
        if image in DEFAULT_SCENE_IMAGES:
            return image
        return DEFAULT_SCENE_IMAGES[(index - 1) % len(DEFAULT_SCENE_IMAGES)]

    def _scenes_from_legacy_script(
        self,
        payload: dict[str, Any],
        fallback_title: str,
        fallback_angle: str,
        target_duration: int,
        source_text: str | None,
    ) -> list[dict[str, Any]]:
        parts = self._sanitize_script_parts(payload, fallback_title, fallback_angle, target_duration, source_text)
        scenes: list[dict[str, Any]] = []
        for part in parts:
            voiceover = str(part.get("voiceover") or "").strip()
            if not voiceover:
                continue
            visual = str(part.get("visual_direction") or "").strip()
            for segment in self._split_voiceover_segments(voiceover):
                scenes.append(
                    {
                        "subtitle": segment,
                        "voice_text": segment,
                        "duration": max(3.0, min(8.0, len(segment.split()) / 2.5 + 0.8)),
                    }
                )
        return scenes

    def _fallback_scenes_from_source(self, source_text: str | None, title: str, target_duration: int) -> list[dict[str, Any]]:
        sentences = self._source_sentences(source_text)
        if not sentences:
            sentences = [title]
        max_scenes = max(3, min(12, int((target_duration or 60) / 5)))
        picked = sentences[:max_scenes]
        duration = max(3.0, round((target_duration or 60) / max(1, len(picked)), 2))
        return [
            {
                "duration": duration,
                "image": DEFAULT_SCENE_IMAGES[(index - 1) % len(DEFAULT_SCENE_IMAGES)],
                "effect": DEFAULT_SCENE_EFFECTS[(index - 1) % len(DEFAULT_SCENE_EFFECTS)],
                "fit": "cover",
                "subtitle": self._compact_text(sentence, 140),
                "voice_text": sentence,
            }
            for index, sentence in enumerate(picked, start=1)
        ]

    def _split_voiceover_segments(self, text: str) -> list[str]:
        sentences = [item.strip() for item in re.split(r"(?<=[.!?。！？])\s+", text) if item.strip()]
        if not sentences:
            sentences = [text.strip()]
        result: list[str] = []
        for sentence in sentences:
            if len(sentence) <= 180:
                result.append(sentence)
                continue
            words = sentence.split()
            current: list[str] = []
            for word in words:
                candidate = " ".join([*current, word]).strip()
                if len(candidate) > 160 and current:
                    result.append(" ".join(current))
                    current = [word]
                else:
                    current.append(word)
            if current:
                result.append(" ".join(current))
        return result

    def _voiceover_from_parts(self, part: dict[str, Any], main_beats: list[str]) -> str:
        lines = [
            str(part.get("hook_direction") or "").strip(),
            *main_beats,
            str(part.get("ending_direction") or "").strip(),
        ]
        return "\n".join(line for line in lines if line)

    def _visual_direction(self, production_notes: Any) -> str:
        if isinstance(production_notes, dict):
            return str(production_notes.get("visuals") or production_notes.get("visual") or "Dựng hình theo các chi tiết chính trong nguồn.")
        if production_notes:
            return str(production_notes)
        return "Dựng hình theo các chi tiết chính trong nguồn."

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
