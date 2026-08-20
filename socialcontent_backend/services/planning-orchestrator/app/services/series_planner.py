from __future__ import annotations

import json
import logging
import re
from typing import Any

from common.core.config import get_settings
from common.core.llm import deepseek_chat_completion, openai_chat_completion

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_NEW = """Bạn là Chuyên gia Xây dựng Kịch bản Chuỗi Video (Series Planner) hàng đầu.
Nhiệm vụ của bạn là lập kế hoạch chi tiết từng phần (Series Parts) cho một chuỗi video ngắn từ nội dung đầu vào.

YÊU CẦU CHẤT LƯỢNG NỘI DUNG:
- Không viết part theo kiểu giới thiệu meta như "bài viết này nói về", "nội dung này đề cập", "hãy cùng tìm hiểu".
- Mỗi part phải đi vào chi tiết cụ thể của nguồn: nhân vật/sự kiện/luận điểm/nguyên nhân/hệ quả/số liệu nếu có.
- main_beats phải là nội dung có thể chuyển thành lời dẫn hoặc cảnh cụ thể, không được là nhãn chung như "Hook mở đầu", "Phát triển tình huống".
- Nếu nguồn ngắn, hãy chia theo các chi tiết thật đang có thay vì tự tạo drama ngoài nguồn.

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
5. Không viết kiểu giới thiệu meta như "bài viết này nói về"; bài mới phải đi thẳng vào chi tiết cụ thể của nguồn.
6. main_beats phải chứa thông tin thật từ bài mới, không dùng nhãn chung như "Hook mở đầu" hoặc "Phát triển tình huống".

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
Không mở đầu bằng việc giới thiệu bài viết/nội dung. Hãy bắt đầu bằng chi tiết nổi bật nhất, rồi đào sâu vào diễn biến, nguyên nhân, hệ quả hoặc điểm gây tranh luận có trong nguồn.
"""
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
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
                parsed = result.parsed_json()
                raw_parts = parsed.get("parts", [])
                validated_parts = self._sanitize_parts(
                    raw_parts, continuation_from_part, part_count, title, target_duration, source_excerpt or summary
                )
                return validated_parts, result.provider, result.model, result.latency_ms
            except Exception as exc:
                provider_errors.append(f"openai: {exc}")
                logger.warning("OpenAI Series Planner failed, trying DeepSeek: %s", exc)

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
                parsed = result.parsed_json()
                raw_parts = parsed.get("parts", [])
                validated_parts = self._sanitize_parts(
                    raw_parts, continuation_from_part, part_count, title, target_duration, source_excerpt or summary
                )
                return validated_parts, result.provider, result.model, result.latency_ms
            except Exception as exc:
                provider_errors.append(f"deepseek: {exc}")
                logger.warning("DeepSeek Series Planner failed: %s", exc)

        if provider_errors:
            raise RuntimeError(f"Series planning failed; {'; '.join(provider_errors)}")
        raise RuntimeError("Missing OPENAI_API_KEY or DEEPSEEK_API_KEY for series planning")

    def _sanitize_parts(
        self,
        raw_parts: list[dict[str, Any]],
        start_part_num: int,
        part_count: int,
        title: str,
        target_duration: int,
        source_text: str | None = None,
    ) -> list[dict[str, Any]]:
        fallback_beats = self._fallback_beats_from_source(source_text, title)
        sanitized = []
        for i in range(part_count):
            part_num = start_part_num + i
            item = raw_parts[i] if i < len(raw_parts) and isinstance(raw_parts[i], dict) else {}
            
            p_type = item.get("part_type")
            if p_type not in {"OPENING", "MIDDLE", "ENDING"}:
                p_type = "OPENING" if part_num == 1 else "MIDDLE"

            part_title = item.get("title") or f"Phần {part_num}: Cập nhật mới từ {title}"
            source_detail = fallback_beats[min(i, len(fallback_beats) - 1)] if fallback_beats else title
            goal = item.get("goal") or source_detail
            hook = item.get("hook_direction") or source_detail
            ending = item.get("ending_direction") or "Kết bằng hệ quả hoặc câu hỏi còn bỏ ngỏ từ chính nội dung nguồn."

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
                beats = self._beats_for_part(fallback_beats, i, part_count, title)
            beats = [str(beat) for beat in beats if str(beat).strip()]
            if self._beats_are_too_generic(beats):
                beats = self._beats_for_part(fallback_beats, i, part_count, title)

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

    def _beats_for_part(self, source_beats: list[str], index: int, part_count: int, title: str) -> list[str]:
        if not source_beats:
            return [
                f"{title}: nêu chi tiết cụ thể nhất đang có trong dữ liệu nguồn.",
                "Làm rõ nguyên nhân, diễn biến hoặc luận điểm chính dựa trên phần tóm tắt hiện có.",
                "Kết bằng hệ quả trực tiếp hoặc điểm còn bỏ ngỏ từ nội dung nguồn.",
            ]
        if part_count <= 1 or len(source_beats) <= 3:
            return source_beats
        chunk_size = max(1, (len(source_beats) + part_count - 1) // part_count)
        start = min(len(source_beats) - 1, index * chunk_size)
        chunk = source_beats[start:start + chunk_size]
        return chunk or [source_beats[-1]]

    def _fallback_beats_from_source(self, source_text: str | None, title: str) -> list[str]:
        sentences = self._source_sentences(source_text)
        if sentences:
            return sentences
        return [
            f"{title}: nêu chi tiết cụ thể nhất đang có trong dữ liệu nguồn.",
            "Làm rõ nguyên nhân, diễn biến hoặc luận điểm chính dựa trên phần tóm tắt hiện có.",
            "Kết bằng hệ quả trực tiếp hoặc điểm còn bỏ ngỏ từ nội dung nguồn.",
        ]

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
            if len(sentences) >= 10:
                break
        if not sentences:
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
            "hook mở đầu",
            "hook 3s",
            "phát triển tình huống",
            "phat trien tinh huong",
            "tình huống trung tâm",
            "tinh huong trung tam",
            "câu hỏi lửng",
            "cau hoi lung",
        ]
        return any(pattern in text for pattern in patterns)
