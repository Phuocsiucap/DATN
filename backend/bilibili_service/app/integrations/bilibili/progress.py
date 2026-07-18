from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable


ProgressCallback = Callable[[dict[str, Any]], None]


@dataclass
class ThrottledProgress:
    callback: ProgressCallback
    min_interval_seconds: float = 0.5
    min_percent_delta: float = 1.0
    _last_emit_at: float = field(default=0.0, init=False)
    _last_percent: float | None = field(default=None, init=False)

    def emit(
        self,
        *,
        step: str,
        label: str,
        status: str = "running",
        percent: float | None = None,
        current: int | None = None,
        total: int | None = None,
        detail: str | None = None,
        unit: str | None = None,
        force: bool = False,
    ) -> None:
        now = time.monotonic()
        if percent is None and current is not None and total:
            percent = min(100.0, max(0.0, (current / total) * 100))
        if not force and now - self._last_emit_at < self.min_interval_seconds:
            if percent is None or self._last_percent is None or abs(percent - self._last_percent) < self.min_percent_delta:
                return

        payload: dict[str, Any] = {
            "step": step,
            "label": label,
            "status": status,
            "updated_at_ms": int(time.time() * 1000),
        }
        if percent is not None:
            payload["percent"] = round(percent, 1)
        if current is not None:
            payload["current"] = current
        if total is not None:
            payload["total"] = total
        if detail:
            payload["detail"] = detail
        if unit:
            payload["unit"] = unit

        self.callback(payload)
        self._last_emit_at = now
        self._last_percent = percent
