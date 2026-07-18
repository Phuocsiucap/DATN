from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from typing import Any

from backend.bilibili_service.app.core.config import get_settings


def deepseek_chat_json(
    *,
    model: str,
    system_prompt: str,
    user_payload: dict[str, Any],
    max_tokens: int,
    temperature: float = 0.0,
    reasoning_effort: str | None = None,
) -> dict[str, Any]:
    user_content = json.dumps(user_payload, ensure_ascii=False)
    last_error: Exception | None = None
    prompts = [
        system_prompt + "\nReturn a valid JSON object only. Do not use markdown.",
        system_prompt + "\nYou must output only compact valid JSON. No markdown, no explanation.",
    ]
    for prompt in prompts:
        try:
            content = deepseek_chat_text(
                model=model,
                system_prompt=prompt,
                user_content=user_content,
                max_tokens=max_tokens,
                temperature=temperature,
                reasoning_effort=reasoning_effort,
                json_mode=False,
            )
            return parse_json_object(content)
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"DeepSeek JSON response failed: {last_error}") from last_error


def deepseek_chat_text(
    *,
    model: str,
    system_prompt: str,
    user_content: str,
    max_tokens: int,
    temperature: float = 0.0,
    reasoning_effort: str | None = None,
    json_mode: bool = False,
) -> str:
    settings = get_settings()
    request: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "stream": False,
        "max_tokens": max_tokens,
    }
    if not reasoning_effort:
        request["temperature"] = temperature
    if json_mode:
        request["response_format"] = {"type": "json_object"}
    if reasoning_effort:
        request["reasoning_effort"] = reasoning_effort
        request["extra_body"] = {"thinking": {"type": "enabled"}}
    else:
        request["extra_body"] = {"thinking": {"type": "disabled"}}

    try:
        response = deepseek_client().chat.completions.create(**request)
    except Exception as exc:
        raise RuntimeError(format_deepseek_error(exc)) from exc

    choice = response.choices[0]
    content = choice.message.content
    if not content:
        finish_reason = getattr(choice, "finish_reason", None) or "unknown"
        raise RuntimeError(f"DeepSeek API returned an empty response. finish_reason={finish_reason}")
    return str(content)


@lru_cache(maxsize=1)
def deepseek_client():
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("Missing dependency: install the official 'openai' Python SDK.") from exc

    settings = get_settings()
    api_key = settings.deepseek_api_key or os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("Chưa cấu hình DeepSeek API key. Mở tab Config, nhập API key rồi lưu trước khi search/dịch.")
    return OpenAI(api_key=api_key, base_url=settings.deepseek_base_url)


def parse_json_object(content: str) -> dict[str, Any]:
    text = content.strip()
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        text = match.group(0)
    data = json.loads(text)
    if not isinstance(data, dict):
        raise RuntimeError("DeepSeek response is not a JSON object.")
    return data


def format_deepseek_error(exc: Exception) -> str:
    text = str(exc)
    if "Insufficient Balance" in text or "402" in text:
        return "DeepSeek API failed: insufficient balance for this API key."
    if "401" in text or "Unauthorized" in text:
        return "DeepSeek API failed: invalid API key."
    if "429" in text or "rate" in text.lower():
        return "DeepSeek API failed: rate limit exceeded."
    return f"DeepSeek API failed: {text}"



