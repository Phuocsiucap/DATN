from __future__ import annotations

import json
import logging
import time
from typing import Any

import requests

from common.core.config import get_settings

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """Bạn là Chuyên gia Lập Kế hoạch Nội dung (Content Planner) hàng đầu cho video ngắn (TikTok, Reels, Shorts).
Nhiệm vụ của bạn là phân tích tài khoản và nội dung đầu vào.
BƯỚC 1 (QUAN TRỌNG NHẤT): Đánh giá xem Nội dung đầu vào có THỰC SỰ phù hợp với Chiến lược tài khoản hay không. Nếu không phù hợp hoặc vi phạm chủ đề né tránh, hãy từ chối.
BƯỚC 2: Nếu phù hợp, hãy xây dựng một Content Plan độc đáo, kịch tính, thu hút khán giả.

Bạn BẮT BUỘC phải trả về kết quả dưới dạng cấu trúc JSON hợp lệ duy nhất, KHÔNG kèm thêm markdown fence hoặc bất kỳ giải thích nào bên ngoài.

Schema JSON đầu ra:
{
  "is_suitable": true/false,
  "rejection_reason": "Nếu is_suitable=false, ghi rõ lý do từ chối (VD: Nội dung không liên quan đến thể thao). Nếu true thì để null",
  "plan_title": "Tiêu đề kế hoạch nội dung thu hút (chỉ có khi is_suitable=true)",
  "content_angle": "Góc nhìn/hướng khai thác câu chuyện độc đáo (chỉ có khi is_suitable=true)",
  "target_audience": "Đối tượng khán giả mục tiêu",
  "tone": "Phong cách/tông giọng",
  "format": "NARRATED_STORY",
  "planning_mode": "SERIES hoặc SINGLE",
  "recommended_part_count": số_lượng_phần_nguyên,
  "target_duration_seconds": thời_lượng_mỗi_phần_giây,
  "target_series_id": "UUID chuỗi đang chạy nếu đây là bản cập nhật/tiếp nối của chuỗi đó, hoặc null nếu tạo chuỗi mới",
  "production_requirements": {
    "requires_voice": true,
    "requires_subtitles": true,
    "requires_background_media": true,
    "requires_character_consistency": boolean
  },
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
    ) -> tuple[dict[str, Any], str, str, int, int]:
        """
        Generates structured plan payload.
        Returns (payload, provider_name, model_name, latency_ms, confidence_score)
        """
        settings = get_settings()
        start_time = time.time()

        active_series_str = ""
        if active_series:
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
"""

        # Try OpenAI API first if key exists
        if settings.openai_api_key:
            try:
                res = requests.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.openai_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.openai_model or "gpt-4o-mini",
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": user_prompt},
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.7,
                    },
                    timeout=30,
                )
                if res.status_code == 200:
                    data = res.json()
                    content_str = data["choices"][0]["message"]["content"]
                    parsed = json.loads(content_str)
                    latency = int((time.time() - start_time) * 1000)

                    if not parsed.get("is_suitable", True):
                        return (
                            parsed,
                            "openai",
                            settings.openai_model or "gpt-4o-mini",
                            latency,
                            0,
                        )

                    validated = self._validate_and_sanitize(parsed, title, episode_count, target_duration)
                    return (
                        validated,
                        "openai",
                        settings.openai_model or "gpt-4o-mini",
                        latency,
                        int(validated.get("confidence_score", 85)),
                    )
            except Exception as exc:
                logger.warning("OpenAI API planning call failed, falling back: %s", exc)

        # Fallback rule-based structured payload
        latency = int((time.time() - start_time) * 1000)
        mode = planning_mode if planning_mode != "AUTO" else ("SERIES" if episode_count > 1 else "SINGLE")
        part_count = preferred_part_count or min(max(episode_count, 1), 8)
        if mode == "SINGLE":
            part_count = 1
        source_basis = (source_excerpt[:240] if source_excerpt else "") or summary

        fallback_payload = {
            "is_suitable": True,
            "rejection_reason": None,
            "plan_title": f"{title} - {'Chuỗi' if mode == 'SERIES' else 'Video'} {part_count} phần",
            "content_angle": (source_basis[:240] if source_basis else f"Kể lại nội dung {title} theo góc nhìn kịch tính, tạo sự tò mò trong 3s đầu."),
            "target_audience": target_audience or "Khán giả thích câu chuyện ngắn hấp dẫn trên TikTok",
            "tone": tone or "kịch tính, lôi cuốn",
            "format": "NARRATED_STORY",
            "planning_mode": mode,
            "recommended_part_count": part_count,
            "target_duration_seconds": target_duration or 60,
            "target_series_id": None,
            "production_requirements": {
                "requires_voice": True,
                "requires_subtitles": True,
                "requires_background_media": True,
                "requires_character_consistency": mode == "SERIES",
            },
            "script_part": {
                "part_type": "OPENING" if part_count == 1 else "MIDDLE",
                "title": f"{title} - Kịch bản chính",
                "goal": (source_basis[:220] if source_basis else f"Kể lại nội dung {title} thành một video ngắn dễ theo dõi."),
                "hook_direction": f"Mở bằng chi tiết gây tò mò nhất trong câu chuyện: {title}.",
                "ending_direction": "Kết bằng câu hỏi hoặc nhận định mở để kéo bình luận.",
                "previous_part_recap": None,
                "next_part_tease": None,
                "main_beats": [
                    "Mở bằng bối cảnh và chi tiết gây tò mò nhất",
                    "Tóm tắt các diễn biến chính theo trình tự rõ ràng",
                    "Chốt lại ý nghĩa hoặc điểm gây tranh luận của câu chuyện",
                ],
                "production_notes": {
                    "visuals": "Dùng hình ảnh/footage liên quan trực tiếp tới nội dung nguồn.",
                    "voice": tone or "kịch tính, lôi cuốn",
                    "editing": "Nhịp dựng nhanh, phụ đề rõ, nhấn mạnh các mốc quan trọng.",
                },
                "risk_notes": ["Kiểm chứng chi tiết nhạy cảm trước khi sản xuất."],
            },
            "risk_flags": [
                {
                    "type": "GENERAL",
                    "severity": (risk_level or "MEDIUM").upper(),
                    "note": "Tuân thủ bộ lọc rủi ro của chiến lược tài khoản",
                }
            ],
            "reasoning": [
                "Nội dung đạt chuẩn chất lượng dữ liệu",
                "Phù hợp với chủ đề và tông giọng chiến lược",
                f"Đã tối ưu cho cấu trúc {'chuỗi video' if mode == 'SERIES' else 'video đơn'}",
            ],
            "confidence_score": min(95, max(65, int(quality))),
        }
        return fallback_payload, "local", "rule-based-planner-v1", latency, int(fallback_payload["confidence_score"])

    def _validate_and_sanitize(
        self,
        payload: dict[str, Any],
        fallback_title: str,
        episode_count: int,
        target_duration: int | None,
    ) -> dict[str, Any]:
        if not payload.get("plan_title"):
            payload["plan_title"] = f"{fallback_title} - Kế hoạch video"
        if not payload.get("content_angle"):
            payload["content_angle"] = f"Khai thác góc nhìn hấp dẫn từ {fallback_title}"
        if not payload.get("format"):
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
        if not payload.get("production_requirements"):
            payload["production_requirements"] = {
                "requires_voice": True,
                "requires_subtitles": True,
                "requires_background_media": True,
                "requires_character_consistency": payload["planning_mode"] == "SERIES",
            }
        if not payload.get("risk_flags"):
            payload["risk_flags"] = [{"type": "GENERAL", "severity": "LOW", "note": "Ghi nhận từ AI Analysis"}]
        if not payload.get("reasoning"):
            payload["reasoning"] = ["Đã qua bộ lọc AI Planner"]
        payload["script_part"] = self._sanitize_script_part(
            payload.get("script_part"),
            fallback_title,
            payload.get("content_angle") or "",
            int(payload.get("target_duration_seconds") or target_duration or 60),
        )
        return payload

    def _sanitize_script_part(
        self,
        raw: Any,
        fallback_title: str,
        fallback_angle: str,
        target_duration: int,
    ) -> dict[str, Any]:
        part = raw if isinstance(raw, dict) else {}
        part_type = part.get("part_type")
        if part_type not in {"OPENING", "MIDDLE", "ENDING"}:
            part_type = "OPENING"

        main_beats = part.get("main_beats")
        if not isinstance(main_beats, list) or not main_beats:
            main_beats = [
                "Mở bằng chi tiết gây tò mò nhất của bài",
                "Triển khai các ý chính theo mạch nguồn",
                "Kết lại bằng góc nhìn hoặc câu hỏi tạo tương tác",
            ]
        main_beats = [str(item) for item in main_beats if str(item).strip()]

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
