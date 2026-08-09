from __future__ import annotations

import asyncio
import traceback
from collections.abc import Callable


async def run_thread_worker_forever(name: str, target: Callable[[], None], restart_delay_seconds: int = 5) -> None:
    while True:
        try:
            print(f"[{name}] worker starting")
            await asyncio.to_thread(target)
            print(f"[{name}] worker exited; restarting in {restart_delay_seconds}s")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[{name}] worker crashed: {exc}")
            traceback.print_exc()
            print(f"[{name}] restarting in {restart_delay_seconds}s")
        await asyncio.sleep(restart_delay_seconds)
