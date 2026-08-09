from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import requests

from common.core.config import get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_NEW_CONTEXT = """Bạn là Chuyên gia Quản lý Ngữ cảnh Kịch bản (Narrative Context Manager).
Nhiệm vụ của bạn là trích xuất và tổng hợp cấu trúc ngữ cảnh của câu chuyện/chuỗi video dựa trên các phần vừa được lập kế hoạch.

Schema JSON đầu ra:
{
  "story_summary": {
    "premise": "Tiền đề câu chuyện / Nội dung cốt lõi",
    "beginning": "Nội dung phần mở đầu",
    "middle": "Nội dung phần giữa",
    "ending": "Nội dung phần kết",
    "themes": ["Chủ đề 1", "Chủ đề 2"]
  },
  "characters": [
    {
      "character_id": "char_1",
      "name": "Tên nhân vật",
      "role": "Nhân vật chính / Phụ / Đối kháng",
      "description": "Mô tả ngắn về đặc điểm"
    }
  ],
  "relationships": [
    {
      "character_name": "Tên A",
      "target_character_name": "Tên B",
      "relation": "Quan hệ giữa A và B"
    }
  ],
  "story_events": [
    {
      "event_order": 1,
      "event_type": "OPENING/MIDDLE/ENDING",
      "description": "Mô tả sự kiện",
      "part_number": 1,
      "importance": "HIGH/MEDIUM/LOW"
    }
  ],
  "open_questions": ["Câu hỏi còn bỏ ngỏ 1"],
  "consistency_rules": [
    "Giữ nguyên tên nhân vật",
    "Không tiết lộ tình huống cuối ở phần đầu"
  ]
}
"""

SYSTEM_PROMPT_CONTINUE_CONTEXT = """Bạn là Chuyên gia Quản lý Ngữ cảnh Kịch bản (Narrative Context Manager).
Nhiệm vụ của bạn là CẬP NHẬT & NỐI TIẾP ngữ cảnh (Context) của một chuỗi câu chuyện đã có từ trước khi có thêm các phần mới.

YÊU CẦU:
1. Giữ nguyên danh sách nhân vật đã có, chỉ thêm nhân vật MỚI xuất hiện nếu có.
2. Nối tiếp các sự kiện mới vào `story_events` theo đúng `part_number`.
3. Kiểm tra xem các câu hỏi bỏ ngỏ (`open_questions`) cũ đã được giải đáp trong các phần mới chưa.

Schema JSON đầu ra:
{
  "story_summary": {
    "premise": "Tiền đề cập nhật",
    "beginning": "Bắt đầu",
    "middle": "Phần giữa cập nhật",
    "ending": "Kết thúc",
    "themes": ["Thủ đề"]
  },
  "characters": [
    {
      "character_id": "id",
      "name": "Tên",
      "role": "Vai trò",
      "description": "Mô tả"
    }
  ],
  "relationships": [],
  "story_events": [
    {
      "event_order": 1,
      "event_type": "MIDDLE",
      "description": "Sự kiện mới",
      "part_number": số_phần_mới,
      "importance": "MEDIUM"
    }
  ],
  "resolved_questions": ["Câu hỏi cũ đã giải đáp"],
  "open_questions": ["Câu hỏi mới mở ra"],
  "consistency_rules": []
}
"""


class ContextManagerService:
    def build_or_update_context(
        self,
        *,
        mode: str = "NEW",
        series_id: str,
        title: str,
        content_angle: str,
        tone: str,
        parts: list[dict[str, Any]],
        existing_context_doc: dict[str, Any] | None = None,
        instructions: str | None = None,
    ) -> tuple[dict[str, Any], str, str, int]:
        """
        Creates or updates a narrative context document for Mongo series_contexts collection.
        Returns (context_doc, provider_name, model_name, latency_ms)
        """
        settings = get_settings()
        start_time = time.time()

        version = (existing_context_doc.get("version", 1) + 1) if (mode == "CONTINUE" and existing_context_doc) else 1

        parts_summary = [
            {
                "part_number": p.get("part_number"),
                "part_type": p.get("part_type"),
                "title": p.get("title"),
                "goal": p.get("goal"),
                "recap": p.get("previous_part_recap"),
                "tease": p.get("next_part_tease"),
                "main_beats": p.get("main_beats"),
            }
            for p in parts
        ]

        if settings.openai_api_key:
            try:
                system_prompt = SYSTEM_PROMPT_CONTINUE_CONTEXT if mode == "CONTINUE" else SYSTEM_PROMPT_NEW_CONTEXT
                user_prompt = f"""
Tiêu đề chuỗi: {title}
Góc khai thác: {content_angle}
Tông giọng: {tone}
Chế độ: {mode}
Danh sách các phần mới:
{json.dumps(parts_summary, ensure_ascii=False, indent=2)}

Ngữ cảnh cũ (nếu có):
{json.dumps(existing_context_doc or {}, ensure_ascii=False, indent=2)}

Hướng dẫn: {instructions or 'Không'}
"""
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
                        "temperature": 0.5,
                    },
                    timeout=30,
                )
                if res.status_code == 200:
                    data = res.json()
                    parsed = json.loads(data["choices"][0]["message"]["content"])
                    context_doc = self._assemble_context_doc(
                        parsed=parsed,
                        mode=mode,
                        series_id=series_id,
                        version=version,
                        parts=parts,
                        content_angle=content_angle,
                        tone=tone,
                        existing_doc=existing_context_doc,
                    )
                    latency = int((time.time() - start_time) * 1000)
                    return context_doc, "openai", settings.openai_model or "gpt-4o-mini", latency
            except Exception as exc:
                logger.warning("OpenAI Context Manager failed, falling back to rule-based merger: %s", exc)

        # Fallback rule-based context generator/merger
        latency = int((time.time() - start_time) * 1000)
        context_doc = self._fallback_context_doc(
            mode=mode,
            series_id=series_id,
            version=version,
            title=title,
            content_angle=content_angle,
            tone=tone,
            parts=parts,
            existing_doc=existing_context_doc,
        )
        return context_doc, "local", "rule-based-context-manager-v1", latency

    def _assemble_context_doc(
        self,
        *,
        parsed: dict[str, Any],
        mode: str,
        series_id: str,
        version: int,
        parts: list[dict[str, Any]],
        content_angle: str,
        tone: str,
        existing_doc: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "series_id": series_id,
            "version": version,
            "story_summary": parsed.get("story_summary")
            or {
                "premise": content_angle,
                "beginning": parts[0].get("goal", "") if parts else "",
                "middle": "Cập nhật các sự kiện chính tiếp theo.",
                "ending": parts[-1].get("goal", "") if parts else "",
                "themes": [tone],
            },
            "created_at": datetime.now(timezone.utc),
        }

        if mode == "CONTINUE" and existing_doc:
            # Merge characters
            existing_chars = list(existing_doc.get("characters", []))
            existing_char_names = {c.get("name") for c in existing_chars}
            new_chars = [c for c in parsed.get("characters", []) if c.get("name") not in existing_char_names]
            doc["characters"] = existing_chars + new_chars

            # Merge relationships
            existing_rels = list(existing_doc.get("relationships", []))
            new_rels = parsed.get("relationships", [])
            doc["relationships"] = existing_rels + new_rels

            # Merge events
            existing_events = list(existing_doc.get("story_events", []))
            new_events = parsed.get("story_events", [])
            if not new_events:
                new_events = [
                    {
                        "event_order": len(existing_events) + idx + 1,
                        "event_type": p.get("part_type", "MIDDLE"),
                        "description": p.get("goal", ""),
                        "part_number": p.get("part_number"),
                        "source_refs": p.get("source_refs", []),
                        "importance": "MEDIUM",
                    }
                    for idx, p in enumerate(parts)
                ]
            doc["story_events"] = existing_events + new_events
        else:
            doc["characters"] = parsed.get("characters", [])
            doc["relationships"] = parsed.get("relationships", [])
            story_events = parsed.get("story_events", [])
            if not story_events:
                story_events = [
                    {
                        "event_order": idx + 1,
                        "event_type": p.get("part_type", "MIDDLE"),
                        "description": p.get("goal", ""),
                        "part_number": p.get("part_number", idx + 1),
                        "source_refs": p.get("source_refs", []),
                        "importance": "HIGH" if p.get("part_type") in {"OPENING", "ENDING"} else "MEDIUM",
                    }
                    for idx, p in enumerate(parts)
                ]
            doc["story_events"] = story_events

        # Build narrative coverage per part
        doc["narrative_coverage"] = [
            {
                "part_number": p.get("part_number"),
                "covered_events": [p.get("part_number")],
                "open_questions": [p.get("next_part_tease")] if p.get("next_part_tease") else [],
                "resolved_questions": [p.get("previous_part_recap")] if p.get("previous_part_recap") else [],
            }
            for p in parts
        ]
        if mode == "CONTINUE" and existing_doc:
            existing_coverage = list(existing_doc.get("narrative_coverage", []))
            doc["narrative_coverage"] = existing_coverage + doc["narrative_coverage"]

        doc["open_questions"] = parsed.get("open_questions") or [p.get("next_part_tease") for p in parts if p.get("next_part_tease")]
        doc["consistency_rules"] = parsed.get("consistency_rules") or [
            "Giữ nguyên tên nhân vật và tông giọng",
            "Đảm bảo continuity giữa các tập",
        ]
        return doc

    def _fallback_context_doc(
        self,
        *,
        mode: str,
        series_id: str,
        version: int,
        title: str,
        content_angle: str,
        tone: str,
        parts: list[dict[str, Any]],
        existing_doc: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if mode == "CONTINUE" and existing_doc:
            existing_events = list(existing_doc.get("story_events", []))
            start_event_idx = len(existing_events) + 1
            new_events = [
                {
                    "event_order": start_event_idx + idx,
                    "event_type": p.get("part_type", "MIDDLE"),
                    "description": p.get("goal", f"Tập {p.get('part_number')} - Diễn biến nối tiếp"),
                    "part_number": p.get("part_number"),
                    "source_refs": p.get("source_refs", []),
                    "importance": "MEDIUM",
                }
                for idx, p in enumerate(parts)
            ]
            new_coverage = [
                {
                    "part_number": p.get("part_number"),
                    "covered_events": [p.get("part_number")],
                    "open_questions": [p.get("next_part_tease")] if p.get("next_part_tease") else [],
                    "resolved_questions": [p.get("previous_part_recap")] if p.get("previous_part_recap") else [],
                }
                for p in parts
            ]
            return {
                "series_id": series_id,
                "version": version,
                "story_summary": existing_doc.get("story_summary", {
                    "premise": content_angle,
                    "beginning": "",
                    "middle": f"Cập nhật thêm {len(parts)} phần mới.",
                    "ending": "",
                    "themes": [tone],
                }),
                "characters": existing_doc.get("characters", []),
                "relationships": existing_doc.get("relationships", []),
                "story_events": existing_events + new_events,
                "narrative_coverage": list(existing_doc.get("narrative_coverage", [])) + new_coverage,
                "open_questions": [p.get("next_part_tease") for p in parts if p.get("next_part_tease")],
                "consistency_rules": existing_doc.get("consistency_rules", ["Duy trì tính nhất quán mạch truyện"]),
                "created_at": datetime.now(timezone.utc),
            }

        story_events = [
            {
                "event_order": idx + 1,
                "event_type": p.get("part_type", "MIDDLE"),
                "description": p.get("goal", f"Phần {p.get('part_number')}"),
                "part_number": p.get("part_number", idx + 1),
                "source_refs": p.get("source_refs", []),
                "importance": "HIGH" if p.get("part_type") in {"OPENING", "ENDING"} else "MEDIUM",
            }
            for idx, p in enumerate(parts)
        ]
        narrative_coverage = [
            {
                "part_number": p.get("part_number", idx + 1),
                "covered_events": [p.get("part_number", idx + 1)],
                "open_questions": [p.get("next_part_tease")] if p.get("next_part_tease") else [],
                "resolved_questions": [],
            }
            for idx, p in enumerate(parts)
        ]
        return {
            "series_id": series_id,
            "version": version,
            "story_summary": {
                "premise": content_angle,
                "beginning": parts[0].get("goal", "") if parts else "",
                "middle": "Phát triển qua các diễn biến mấu chốt.",
                "ending": parts[-1].get("goal", "") if parts else "",
                "themes": [tone],
            },
            "characters": [],
            "relationships": [],
            "story_events": story_events,
            "narrative_coverage": narrative_coverage,
            "open_questions": [p.get("next_part_tease") for p in parts if p.get("next_part_tease")],
            "consistency_rules": ["Giữ giọng văn đồng nhất", "Tránh lộ tình huống bất ngờ quá sớm"],
            "created_at": datetime.now(timezone.utc),
        }
