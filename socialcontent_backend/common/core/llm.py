from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ChatCompletionResult:
    provider: str
    model: str
    content: str
    raw_response: dict[str, Any]
    latency_ms: int

    @property
    def input_tokens(self) -> int:
        usage = self.raw_response.get("usage", {})
        return usage.get("prompt_tokens", 0) or 0

    @property
    def output_tokens(self) -> int:
        usage = self.raw_response.get("usage", {})
        return usage.get("completion_tokens", 0) or 0

    @property
    def total_tokens(self) -> int:
        usage = self.raw_response.get("usage", {})
        return usage.get("total_tokens", 0) or (self.input_tokens + self.output_tokens)

    def parsed_json(self) -> Any:
        return json.loads(strip_json_fence(self.content))


def openai_chat_completion(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.7,
    response_format: dict[str, Any] | None = None,
    max_tokens: int | None = None,
    timeout: int = 30,
) -> ChatCompletionResult:
    return chat_completion(
        provider="openai",
        base_url="https://api.openai.com/v1",
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=temperature,
        response_format=response_format,
        max_tokens=max_tokens,
        timeout=timeout,
    )


def deepseek_chat_completion(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.7,
    response_format: dict[str, Any] | None = None,
    max_tokens: int | None = None,
    thinking: bool | None = None,
    reasoning_effort: str | None = None,
    timeout: int = 120,
) -> ChatCompletionResult:
    return chat_completion(
        provider="deepseek",
        base_url=base_url,
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=temperature,
        response_format=response_format,
        max_tokens=max_tokens,
        thinking=thinking,
        reasoning_effort=reasoning_effort,
        timeout=timeout,
    )


def chat_completion(
    *,
    provider: str,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.7,
    response_format: dict[str, Any] | None = None,
    max_tokens: int | None = None,
    thinking: bool | None = None,
    reasoning_effort: str | None = None,
    timeout: int = 120,
) -> ChatCompletionResult:
    if not api_key:
        raise RuntimeError(f"Missing API key for {provider}")

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        payload["response_format"] = response_format
    if max_tokens is not None:
        payload["max_completion_tokens" if provider == "openai" else "max_tokens"] = max(1, int(max_tokens))
    if provider == "deepseek" and thinking is not None:
        payload["thinking"] = {"type": "enabled" if thinking else "disabled"}
    if provider == "deepseek" and reasoning_effort:
        payload["reasoning_effort"] = str(reasoning_effort)

    start_time = time.time()
    raw_response = post_json(
        f"{base_url.rstrip('/')}/chat/completions",
        payload,
        api_key,
        timeout=timeout,
    )
    latency_ms = int((time.time() - start_time) * 1000)
    try:
        choice = raw_response["choices"][0]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Unexpected {provider} chat completion response: {raw_response}") from exc
    finish_reason = str(choice.get("finish_reason") or "")
    if finish_reason == "length":
        usage = raw_response.get("usage") if isinstance(raw_response.get("usage"), dict) else {}
        details = usage.get("completion_tokens_details") if isinstance(usage.get("completion_tokens_details"), dict) else {}
        raise RuntimeError(
            f"{provider} chat completion reached max_tokens"
            f" (completion_tokens={usage.get('completion_tokens', 0)}, reasoning_tokens={details.get('reasoning_tokens', 0)})"
        )
    if not str(content or "").strip():
        raise RuntimeError(f"{provider} chat completion returned empty content (finish_reason={finish_reason or 'unknown'})")

    return ChatCompletionResult(
        provider=provider,
        model=model,
        content=str(content or ""),
        raw_response=raw_response,
        latency_ms=latency_ms,
    )


def post_json(url: str, payload: dict[str, Any], api_key: str, timeout: int = 120) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode("utf-8")) from error


def strip_json_fence(content: str) -> str:
    text = str(content or "").strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    return text
