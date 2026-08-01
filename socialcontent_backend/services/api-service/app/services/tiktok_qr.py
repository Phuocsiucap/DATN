from __future__ import annotations

import base64
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

    def capture_qr(self) -> str:
        self.page.wait_for_timeout(2000)
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
                if locator.count() > 0 and locator.is_visible(timeout=1500):
                    screenshot = locator.screenshot()
                    break
            except Exception:
                continue

        if screenshot is None:
            screenshot = self.page.screenshot(full_page=True)

        self.qr_image_b64 = base64.b64encode(screenshot).decode("utf-8")
        return self.qr_image_b64

    def is_authenticated(self) -> bool:
        try:
            cookies = self.context.cookies(["https://www.tiktok.com"])
        except Exception:
            return False
        cookie_names = {cookie["name"] for cookie in cookies}
        return bool(cookie_names.intersection(DEFAULT_AUTH_COOKIE_NAMES))

    def page_url(self) -> str | None:
        try:
            return self.page.url
        except Exception:
            return None

    def close(self) -> None:
        try:
            self.context.close()
        finally:
            self.playwright.stop()


_SESSION_LOCK = threading.Lock()
_SESSIONS: dict[str, TikTokLoginSession] = {}


def _load_sync_playwright():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Playwright chưa được cài. Cài dependency rồi chạy: python -m playwright install chromium",
        ) from exc
    return sync_playwright


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


def _launch_persistent_context(profile_dir: Path):
    settings = get_settings()
    sync_playwright = _load_sync_playwright()
    playwright = sync_playwright().start()
    launch_kwargs = {
        "user_data_dir": str(profile_dir),
        "headless": settings.browser_headless,
        "viewport": {"width": 1280, "height": 900},
        "args": ["--disable-blink-features=AutomationControlled"],
    }

    try:
        context = playwright.chromium.launch_persistent_context(channel=settings.browser_channel, **launch_kwargs)
    except Exception:
        try:
            context = playwright.chromium.launch_persistent_context(**launch_kwargs)
        except Exception as exc:
            playwright.stop()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Không mở được browser Playwright cho TikTok QR: {exc}",
            ) from exc

    page = context.pages[0] if context.pages else context.new_page()
    return playwright, context, page


def start_tiktok_qr_session(session_id: str, folder_path: str, user_id: uuid.UUID) -> TikTokLoginSession:
    profile_dir = _resolve_profile_dir(folder_path)
    with _SESSION_LOCK:
        existing = _SESSIONS.pop(session_id, None)
    if existing:
        existing.close()

    settings = get_settings()
    playwright, context, page = _launch_persistent_context(profile_dir)
    page.goto(settings.tiktok_qr_login_url, wait_until="domcontentloaded")
    page.wait_for_timeout(5000)

    session = TikTokLoginSession(
        playwright=playwright,
        context=context,
        page=page,
        session_id=session_id,
        user_id=user_id,
        profile_dir=profile_dir,
    )
    session.capture_qr()

    with _SESSION_LOCK:
        _SESSIONS[session_id] = session
    return session


def get_tiktok_qr_session(session_id: str, user_id: uuid.UUID | None = None) -> TikTokLoginSession | None:
    with _SESSION_LOCK:
        session = _SESSIONS.get(session_id)
    if session and user_id is not None and session.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên QR TikTok")
    return session


def refresh_tiktok_qr_session(session_id: str, user_id: uuid.UUID | None = None) -> TikTokLoginSession:
    session = get_tiktok_qr_session(session_id, user_id)
    if not session:
        raise RuntimeError("Chưa khởi tạo phiên QR cho profile này")
    session.capture_qr()
    return session


def stop_tiktok_qr_session(session_id: str, user_id: uuid.UUID | None = None) -> None:
    with _SESSION_LOCK:
        session = _SESSIONS.get(session_id)
        if session and user_id is not None and session.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên QR TikTok")
        session = _SESSIONS.pop(session_id, None)
    if session:
        session.close()


def qr_image_data_url(session: TikTokLoginSession) -> str | None:
    return f"data:image/png;base64,{session.qr_image_b64}" if session.qr_image_b64 else None
