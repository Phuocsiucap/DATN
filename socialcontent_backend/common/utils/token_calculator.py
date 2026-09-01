from __future__ import annotations

# Pricing per 1,000,000 tokens (USD)
PRICING_TABLE: dict[str, dict[str, float]] = {
    "deepseek-v4-flash": {"input": 0.14, "output": 0.28},
    "deepseek-chat": {"input": 0.14, "output": 0.28},
    "text-embedding-3-small": {"input": 0.02, "output": 0.0},
    "text-embedding-3-large": {"input": 0.13, "output": 0.0},
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30},
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "gemini-1.5-pro": {"input": 1.25, "output": 5.00},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "claude-3-5-sonnet": {"input": 3.00, "output": 15.00},
    "default": {"input": 0.50, "output": 1.50},
}


def calculate_token_cost(model_name: str | None, input_tokens: int, output_tokens: int) -> float:
    """Calculate the estimated USD cost for a given model and token count."""
    if not model_name:
        pricing = PRICING_TABLE["default"]
    else:
        key = model_name.lower().strip()
        matched_pricing = None
        for m_key, p_val in PRICING_TABLE.items():
            if m_key in key:
                matched_pricing = p_val
                break
        pricing = matched_pricing or PRICING_TABLE["default"]

    input_cost = (input_tokens / 1_000_000.0) * pricing["input"]
    output_cost = (output_tokens / 1_000_000.0) * pricing["output"]
    return round(input_cost + output_cost, 6)
