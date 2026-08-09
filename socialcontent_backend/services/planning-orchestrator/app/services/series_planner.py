from __future__ import annotations

import json
import logging
import time
from typing import Any

import requests

from common.core.config import get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_NEW = """Bạn là Chuyên gia Xây dựng Kịch bản Chuỗi Video (Series Planner) hàng đầu.
Nhiệm vụ của bạn là lập kế hoạch chi tiết từng phần (Series Parts) cho một chuỗi video ngắn từ nội dung đầu vào.

Bạn BẮT BUỘC phải trả về kết quả dưới dạng cấu trúc JSON hợp lệ duy nhất, KHÔNG kèm thêm markdown fence.

Schema JSON đầu ra:
{
  "parts": [
    {
      "part_number": 1,
      "part_type": "OPENING/MIDDLE/ENDING",
      "title": "Tiêu đề phần",
      "goal": "Mục tiêu truyền tải và diễn biến chính của phần",
      "hook_direction": "Gợi ý hook mở đầu thu hút trong 3 giây",
      "ending_direction": "Gợi ý kết thúc / câu hỏi lửng cho phần sau",
      "previous_part_recap": null,
      "next_part_tease": "Chuẩn bị cho biến cố phần sau",
      "main_beats": ["Nhịp 1", "Nhịp 2", "Nhịp 3"],
      "production_notes": {
        "voice": "narration",
        "subtitle": "required",
        "pace": "fast"
      },
      "risk_notes": []
    }
  ]
}
"""

SYSTEM_PROMPT_CONTINUE = """Bạn là Chuyên gia Xây dựng Kịch bản Chuỗi Video (Series Planner) hàng đầu.
Nhiệm vụ của bạn là viết kịch bản cho BÀI MỚI trong một series đã có các bài trước đó.

YÊU CẦU QUAN TRỌNG:
1. KHÔNG lặp lại góc khai thác, hook hoặc thông tin chính đã dùng trong các bài cũ của series.
2. Đánh số tập bắt đầu chính xác từ phần số {continuation_from_part}.
3. Vì mỗi bài báo chỉ sinh 1 part/script, hãy dùng `previous_part_recap` để nối mạch với bài gần nhất trong series.
4. Giữ vững mạch logic và giọng văn của các bài cũ, nhưng nội dung chính phải bám vào bài mới.

Schema JSON đầu ra:
{
  "parts": [
    {
      "part_number": số_tập_mới,
      "part_type": "MIDDLE/ENDING",
      "title": "Tiêu đề phần mới",
      "goal": "Mục tiêu và diễn biến tiếp theo",
      "hook_direction": "Hook mở đầu nối tiếp phần cũ",
      "ending_direction": "Hướng kết thúc / tease phần sau",
      "previous_part_recap": "Tóm tắt ngắn phần cũ trước đó",
      "next_part_tease": "Tease phần tiếp theo",
      "main_beats": ["Nhịp 1", "Nhịp 2", "Nhịp 3"],
      "production_notes": {
        "voice": "narration",
        "subtitle": "required",
        "pace": "fast"
      },
      "risk_notes": []
    }
  ]
}
"""


class SeriesPlannerService:
    def plan_series(
        self,
        *,
        mode: str = "NEW",  # "NEW" or "CONTINUE"
        title: str,
        summary: str,
        plan_angle: str,
        tone: str,
        source_excerpt: str | None = None,
        part_count: int = 3,
        target_duration: int = 60,
        existing_parts: list[dict[str, Any]] | None = None,
        recent_articles: list[dict[str, Any]] | None = None,
        continuation_from_part: int = 1,
        instructions: str | None = None,
    ) -> tuple[list[dict[str, Any]], str, str, int]:
        """
        Generates structured parts list for a series.
        Returns (parts_list, provider_name, model_name, latency_ms)
        """
        settings = get_settings()
        start_time = time.time()

        system_prompt = (
            SYSTEM_PROMPT_CONTINUE.replace("{continuation_from_part}", str(continuation_from_part))
            if mode == "CONTINUE"
            else SYSTEM_PROMPT_NEW
        )

        existing_parts_info = ""
        recent_articles_info = ""
        if mode == "CONTINUE" and recent_articles:
            recent_articles_info = f"\n5 bài mới nhất trong series này (dùng để giữ mạch và tránh lặp):\n{json.dumps(recent_articles, ensure_ascii=False, indent=2)}\n"
        if mode == "CONTINUE" and existing_parts:
            existing_summary = [
                {
                    "part_number": p.get("part_number"),
                    "title": p.get("title"),
                    "goal": p.get("goal"),
                }
                for p in existing_parts
            ]
            existing_parts_info = f"\nCác script/part cũ đã sản xuất (tham khảo thứ tự và recap, không coi đây là danh sách bài):\n{json.dumps(existing_summary, ensure_ascii=False, indent=2)}\n"

        user_prompt = f"""
Thông tin nội dung:
- Tiêu đề chuỗi: {title}
- Tóm tắt tổng quan: {summary}
- Trích đoạn nội dung gốc của bài mới:
{source_excerpt or 'Không có trích đoạn nội dung gốc, chỉ được dùng summary.'}
- Hướng khai thác (Angle): {plan_angle}
- Tông giọng: {tone}
- Chế độ: {mode}
- Số lượng phần MỚI cần sinh: {part_count}
- Thời lượng mỗi phần: {target_duration}s
- Bắt đầu đánh số phần từ: Part {continuation_from_part}
{recent_articles_info}
{existing_parts_info}
Hướng dẫn bổ sung: {instructions or 'Không'}

Nguyên tắc: Khi có trích đoạn nội dung gốc, hãy dùng nó làm nguồn chính để xây dựng main_beats, hook và ending. Summary chỉ là lớp định hướng.
"""

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
                            {"role": "system", "content": system_prompt},
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
                    raw_parts = parsed.get("parts", [])
                    validated_parts = self._sanitize_parts(
                        raw_parts, continuation_from_part, part_count, title, target_duration
                    )
                    latency = int((time.time() - start_time) * 1000)
                    return validated_parts, "openai", settings.openai_model or "gpt-4o-mini", latency
            except Exception as exc:
                logger.warning("OpenAI Series Planner failed, fallback to rule-based: %s", exc)

        # Fallback rule-based generation
        latency = int((time.time() - start_time) * 1000)
        fallback_parts = self._fallback_parts(
            title=title,
            mode=mode,
            continuation_from_part=continuation_from_part,
            part_count=part_count,
            target_duration=target_duration,
            existing_parts=existing_parts,
        )
        return fallback_parts, "local", "rule-based-series-planner-v1", latency

    def _sanitize_parts(
        self,
        raw_parts: list[dict[str, Any]],
        start_part_num: int,
        part_count: int,
        title: str,
        target_duration: int,
    ) -> list[dict[str, Any]]:
        sanitized = []
        for i in range(part_count):
            part_num = start_part_num + i
            item = raw_parts[i] if i < len(raw_parts) and isinstance(raw_parts[i], dict) else {}
            
            p_type = item.get("part_type")
            if p_type not in {"OPENING", "MIDDLE", "ENDING"}:
                p_type = "OPENING" if part_num == 1 else "MIDDLE"

            part_title = item.get("title") or f"Phần {part_num}: Cập nhật mới từ {title}"
            goal = item.get("goal") or f"Diễn biến tiếp theo của phần {part_num}"
            hook = item.get("hook_direction") or "Mở đầu kịch tính trong 3s đầu tiên."
            ending = item.get("ending_direction") or "Kết bằng câu hỏi tò mò cho phần tiếp."

            recap = item.get("previous_part_recap")
            if part_num == 1:
                recap = None
            elif not recap:
                recap = f"Tóm tắt nhanh diễn biến chính của Phần {part_num - 1}."

            tease = item.get("next_part_tease")
            if not tease:
                tease = f"Tease sự kiện bất ngờ ở Phần {part_num + 1}."

            beats = item.get("main_beats")
            if not isinstance(beats, list) or not beats:
                beats = ["Hook mở đầu", "Phát triển tình huống", "Cao trào ngắn & Kết"]

            sanitized.append(
                {
                    "part_number": part_num,
                    "part_type": p_type,
                    "title": part_title,
                    "goal": goal,
                    "hook_direction": hook,
                    "ending_direction": ending,
                    "previous_part_recap": recap,
                    "next_part_tease": tease,
                    "target_duration_seconds": item.get("target_duration_seconds") or target_duration,
                    "main_beats": beats,
                    "production_notes": item.get("production_notes") or {"voice": "narration", "subtitle": "required", "pace": "fast"},
                    "risk_notes": item.get("risk_notes") if isinstance(item.get("risk_notes"), list) else [],
                }
            )
        return sanitized

    def _fallback_parts(
        self,
        *,
        title: str,
        mode: str,
        continuation_from_part: int,
        part_count: int,
        target_duration: int,
        existing_parts: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        parts = []
        last_existing_title = existing_parts[-1].get("title") if existing_parts else None

        for i in range(part_count):
            part_num = continuation_from_part + i
            is_first = (part_num == 1)
            is_last = (i == part_count - 1)

            part_type = "OPENING" if is_first else ("ENDING" if is_last and mode == "NEW" else "MIDDLE")
            
            p_title = f"Phần {part_num}: Diễn biến mới của {title}"
            goal = f"Phát triển tình huống phần {part_num} đẩy cao sự tò mò của người xem."
            recap = None
            if not is_first:
                prev_name = last_existing_title if (i == 0 and last_existing_title) else f"Phần {part_num - 1}"
                recap = f"Tóm tắt điểm nhấn của {prev_name}."

            tease = f"Hé lộ manh mối cho Phần {part_num + 1}." if not is_last else "Tổng kết trọn vẹn thông điệp chính."

            parts.append(
                {
                    "part_number": part_num,
                    "part_type": part_type,
                    "title": p_title,
                    "goal": goal,
                    "hook_direction": "Mở bằng một chi tiết gây bất ngờ trong 3s đầu.",
                    "ending_direction": "Giữ suspense cho các diễn biến tiếp theo.",
                    "previous_part_recap": recap,
                    "next_part_tease": tease,
                    "target_duration_seconds": target_duration,
                    "main_beats": ["Hook 3s", "Tình huống trung tâm", "Câu hỏi lửng cuối phần"],
                    "production_notes": {"voice": "narration", "subtitle": "required", "pace": "fast"},
                    "risk_notes": [],
                }
            )
        return parts
