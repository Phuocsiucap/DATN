from __future__ import annotations

import logging
import uuid
from typing import Any
from sqlalchemy.orm import Session

from common.db.models import PromptRun
from common.db.session import SessionLocal

logger = logging.getLogger(__name__)

# Standard token costs per 1M tokens (USD)
MODEL_PRICING = {
    "deepseek-v4-flash": {"input": 0.14 / 1_000_000, "output": 0.28 / 1_000_000},
    "deepseek-chat": {"input": 0.14 / 1_000_000, "output": 0.28 / 1_000_000},
    "gpt-4o": {"input": 2.50 / 1_000_000, "output": 10.00 / 1_000_000},
    "gpt-4o-mini": {"input": 0.15 / 1_000_000, "output": 0.60 / 1_000_000},
}


def log_prompt_run(
    *,
    db: Session | None = None,
    user_id: str | uuid.UUID | None = None,
    run_type: str = "GENERATE_SCRIPT",
    step_name: str = "ai_completion",
    reference_id: str | uuid.UUID | None = None,
    model_provider: str = "deepseek",
    model_name: str = "deepseek-v4-flash",
    result: Any | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    latency_ms: int = 0,
    status: str = "COMPLETED",
    error_message: str | None = None,
) -> None:
    """Record LLM token usage and cost metrics into the database."""
    own_session = False
    if db is None:
        db = SessionLocal()
        own_session = True

    try:
        in_tok = input_tokens
        out_tok = output_tokens
        lat_ms = latency_ms

        if result is not None:
            in_tok = getattr(result, "input_tokens", in_tok) or in_tok
            out_tok = getattr(result, "output_tokens", out_tok) or out_tok
            lat_ms = getattr(result, "latency_ms", lat_ms) or lat_ms
            if hasattr(result, "provider") and result.provider:
                model_provider = result.provider
            if hasattr(result, "model") and result.model:
                model_name = result.model

        tot_tok = in_tok + out_tok
        rates = MODEL_PRICING.get(model_name, MODEL_PRICING["deepseek-v4-flash"])
        cost = (in_tok * rates["input"]) + (out_tok * rates["output"])

        parsed_user_id = None
        if user_id:
            try:
                parsed_user_id = uuid.UUID(str(user_id))
            except (ValueError, TypeError):
                pass

        parsed_ref_id = None
        if reference_id:
            try:
                parsed_ref_id = uuid.UUID(str(reference_id))
            except (ValueError, TypeError):
                pass

        if not parsed_user_id and parsed_ref_id:
            try:
                from common.db.models import MediaWorkflow
                workflow = db.get(MediaWorkflow, parsed_ref_id)
                if workflow and workflow.user_id:
                    parsed_user_id = workflow.user_id
            except Exception:
                pass

        run = PromptRun(
            user_id=parsed_user_id,
            run_type=run_type,
            step_name=step_name,
            reference_id=parsed_ref_id,
            model_provider=model_provider,
            model_name=model_name,
            input_tokens=in_tok,
            output_tokens=out_tok,
            total_tokens=tot_tok,
            cost_usd=round(cost, 8),
            latency_ms=lat_ms,
            status=status,
            error_message=error_message,
        )
        db.add(run)
        db.commit()
    except Exception as exc:
        logger.warning(f"Failed to record prompt run: {exc}")
        if own_session:
            db.rollback()
    finally:
        if own_session:
            db.close()
