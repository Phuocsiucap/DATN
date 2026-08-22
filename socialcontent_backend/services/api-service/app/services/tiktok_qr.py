from __future__ import annotations

import asyncio
import base64
import logging
import os
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status

from common.core.config import get_settings

WORKSPACE_ROOT = Path(__file__).resolve().parents[5]
BACKEND_ROOT = Path(__file__).resolve().parents[4]
SOCIAL_PROFILE_ROOT = WORKSPACE_ROOT / "social_profile" / "accounts"
BACKEND_SOCIAL_PROFILE_ROOT = BACKEND_ROOT / "social_profile" / "accounts"
DEFAULT_AUTH_COOKIE_NAMES = {"sessionid", "sid_tt", "uid_tt", "sid_ucp_v1", "csrf_session_id"}
logger = logging.getLogger(__name__)


@dataclass
class TikTokLoginSession:
    playwright: Any
    context: Any
    page: Any
    session_id: str
    user_id: uuid.UUID
    profile_dir: Path
    qr_image_b64: str | None = None
    last_error: str | None = None

    async def capture_qr(self) -> str:
        await asyncio.sleep(2)
        qr_selectors = [
            "canvas",
            "img[alt*='QR' i]",
            "img[src^='data:image']",
            "[data-e2e*='qr' i] canvas",
            "[data-e2e*='qr' i] img",
        ]

        screenshot = None
        for selector in qr_selectors:
            locator = self.page.locator(selector).first
            try:
                if await locator.count() > 0 and await locator.is_visible(timeout=1500):
                    screenshot = await locator.screenshot()
                    break
            except Exception:
                continue

        if screenshot is None:
            try:
                screenshot = await self.page.screenshot(full_page=True)
            except Exception as e:
                logger.warning("Screenshot failed for session_id=%s: %s", self.session_id, e)
                return self.qr_image_b64 or ""

        self.qr_image_b64 = base64.b64encode(screenshot).decode("utf-8")
        return self.qr_image_b64

    async def is_authenticated(self) -> bool:
        try:
            cookies = await self.context.cookies(["https://www.tiktok.com"])
        except Exception:
            return False
        cookie_names = {cookie["name"] for cookie in cookies}
        return bool(cookie_names.intersection(DEFAULT_AUTH_COOKIE_NAMES))

    async def cookie_names(self) -> list[str]:
        try:
            cookies = await self.context.cookies(["https://www.tiktok.com"])
        except Exception:
            return []
        return sorted({cookie["name"] for cookie in cookies})

    def page_url(self) -> str | None:
        try:
            return self.page.url
        except Exception:
            return None

    async def close(self) -> None:
        try:
            await self.context.close()
        except Exception as e:
            logger.warning("Error closing context for session_id=%s: %s", self.session_id, e)
        finally:
            try:
                await self.playwright.stop()
            except Exception as e:
                logger.warning("Error stopping playwright for session_id=%s: %s", self.session_id, e)


_SESSION_LOCK = threading.Lock()
_SESSIONS: dict[str, TikTokLoginSession] = {}


def _load_async_playwright():
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Playwright chưa được cài. Cài dependency rồi chạy: python -m playwright install chromium",
        ) from exc
    return async_playwright


def _resolve_profile_dir(folder_path: str) -> Path:
    folder = Path(folder_path)
    if folder.is_absolute():
        profile_dir = folder
    else:
        profile_dir = WORKSPACE_ROOT / folder
        backend_profile_dir = BACKEND_ROOT / folder
        if not profile_dir.exists() and backend_profile_dir.exists():
            profile_dir = backend_profile_dir
    profile_dir.mkdir(parents=True, exist_ok=True)
    return profile_dir


async def _launch_persistent_context(profile_dir: Path):
    settings = get_settings()
    async_playwright = _load_async_playwright()
    pw = await async_playwright().start()
    browser_headless = settings.browser_headless or (os.name != "nt" and not os.environ.get("DISPLAY"))
    if browser_headless and not settings.browser_headless:
        logger.warning("TikTok QR browser forced to headless because DISPLAY is not available")

    # Clean up any stale Singleton lock files from interrupted sessions
    for lock_name in ["SingletonLock", "SingletonCookie", "SingletonSocket"]:
        lock_path = profile_dir / lock_name
        if lock_path.exists():
            try:
                lock_path.unlink()
            except Exception:
                pass

    launch_kwargs = {
        "user_data_dir": str(profile_dir),
        "headless": browser_headless,
        "viewport": {"width": 1280, "height": 900},
        "args": ["--disable-blink-features=AutomationControlled"],
    }

    channels_to_try = [settings.browser_channel, None] if settings.browser_channel else [None]
    context = None
    for ch in channels_to_try:
        try:
            kwargs = {**launch_kwargs}
            if ch:
                kwargs["channel"] = ch
            context = await pw.chromium.launch_persistent_context(**kwargs)
            break
        except Exception as exc:
            logger.warning("Could not launch Playwright context with channel=%s: %s", ch, exc)

    if not context:
        await pw.stop()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Không mở được browser Playwright cho TikTok QR",
        )

    page = context.pages[0] if context.pages else await context.new_page()
    return pw, context, page


async def start_tiktok_qr_session(session_id: str, folder_path: str, user_id: uuid.UUID) -> TikTokLoginSession:
    profile_dir = _resolve_profile_dir(folder_path)
    with _SESSION_LOCK:
        existing = _SESSIONS.pop(session_id, None)
    if existing:
        await existing.close()

    settings = get_settings()
    pw, context, page = await _launch_persistent_context(profile_dir)
    try:
        await page.goto(settings.tiktok_qr_login_url, wait_until="domcontentloaded")
    except Exception as e:
        logger.warning("Page goto failed or timed out: %s", e)

    session = TikTokLoginSession(
        playwright=pw,
        context=context,
        page=page,
        session_id=session_id,
        user_id=user_id,
        profile_dir=profile_dir,
    )
    await session.capture_qr()

    with _SESSION_LOCK:
        _SESSIONS[session_id] = session
    logger.info(
        "Started TikTok QR session session_id=%s user_id=%s profile_dir=%s page_url=%s",
        session_id,
        user_id,
        profile_dir,
        session.page_url(),
    )
    return session


def get_tiktok_qr_session(session_id: str, user_id: uuid.UUID | None = None) -> TikTokLoginSession | None:
    with _SESSION_LOCK:
        session = _SESSIONS.get(session_id)
    if session and user_id is not None and session.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên QR TikTok")
    return session


async def refresh_tiktok_qr_session(session_id: str, user_id: uuid.UUID | None = None) -> TikTokLoginSession:
    session = get_tiktok_qr_session(session_id, user_id)
    if not session:
        raise RuntimeError("Chưa khởi tạo phiên QR cho profile này")
    await session.capture_qr()
    return session


async def stop_tiktok_qr_session(session_id: str, user_id: uuid.UUID | None = None) -> None:
    with _SESSION_LOCK:
        session = _SESSIONS.get(session_id)
        if session and user_id is not None and session.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên QR TikTok")
        session = _SESSIONS.pop(session_id, None)
    if session:
        await session.close()


def qr_image_data_url(session: TikTokLoginSession) -> str | None:
    return f"data:image/png;base64,{session.qr_image_b64}" if session.qr_image_b64 else None
