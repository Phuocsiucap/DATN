from __future__ import annotations

import json
import logging
import time
from typing import Any

import requests

from common.core.config import get_settings

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """Bạn là Chuyên gia Lập Kế hoạch Nội dung (Content Planner) hàng đầu cho video ngắn (TikTok, Reels, Shorts).
Nhiệm vụ của bạn là phân tích tài khoản và nội dung đầu vào, xây dựng một Content Plan độc đáo, kịch tính, thu hút khán giả.

Bạn BẮT BUỘC phải trả về kết quả dưới dạng cấu trúc JSON hợp lệ duy nhất, KHÔNG kèm thêm markdown fence hoặc bất kỳ giải thích nào bên ngoài.

Schema JSON đầu ra:
{
  "plan_title": "Tiêu đề kế hoạch nội dung thu hút",
  "content_angle": "Góc nhìn/hướng khai thác câu chuyện độc đáo",
  "target_audience": "Đối tượng khán giả mục tiêu",
  "tone": "Phong cách/tông giọng",
  "format": "NARRATED_STORY",
  "planning_mode": "SERIES hoặc SINGLE",
  "recommended_part_count": số_lượng_phần_nguyên,
  "target_duration_seconds": thời_lượng_mỗi_phần_giây,
  "production_requirements": {
    "requires_voice": true,
    "requires_subtitles": true,
    "requires_background_media": true,
    "requires_character_consistency": boolean
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
"""


class AIPlannerService:
    def generate_plan(
        self,
        *,
        title: str,
        summary: str,
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
        instructions: str | None = None,
    ) -> tuple[dict[str, Any], str, str, int, int]:
        """
        Generates structured plan payload.
        Returns (payload, provider_name, model_name, latency_ms, confidence_score)
        """
        settings = get_settings()
        start_time = time.time()

        user_prompt = f"""
Nội dung đầu vào:
- Tiêu đề: {title}
- Tóm tắt: {summary or 'Nội dung tổng hợp từ nguồn crawl'}
- Số tập/phần có sẵn: {episode_count}
- Chất lượng dữ liệu: {quality:.0f}/100

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

        fallback_payload = {
            "plan_title": f"{title} - {'Chuỗi' if mode == 'SERIES' else 'Video'} {part_count} phần",
            "content_angle": (summary[:240] if summary else f"Kể lại nội dung {title} theo góc nhìn kịch tính, tạo sự tò mò trong 3s đầu."),
            "target_audience": target_audience or "Khán giả thích câu chuyện ngắn hấp dẫn trên TikTok",
            "tone": tone or "kịch tính, lôi cuốn",
            "format": "NARRATED_STORY",
            "planning_mode": mode,
            "recommended_part_count": part_count,
            "target_duration_seconds": target_duration or 60,
            "production_requirements": {
                "requires_voice": True,
                "requires_subtitles": True,
                "requires_background_media": True,
                "requires_character_consistency": mode == "SERIES",
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
        return payload
