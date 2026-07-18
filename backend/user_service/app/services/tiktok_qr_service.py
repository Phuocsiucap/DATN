from __future__ import annotations

import base64
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parents[4]
LEGACY_PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOGIN_URL = "https://www.tiktok.com/login/qrcode"


@dataclass
class TikTokLoginSession:
    playwright: any
    context: any
    page: any
    session_id: str
    profile_dir: Path
    login_url: str = DEFAULT_LOGIN_URL
    qr_image_b64: Optional[str] = None
    last_error: Optional[str] = None

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
        auth_cookie_names = {
            "sessionid",
            "sid_tt",
            "uid_tt",
            "sid_ucp_v1",
            "csrf_session_id",
        }
        return bool(cookie_names.intersection(auth_cookie_names))

    def close(self):
        try:
            self.context.close()
        finally:
            self.playwright.stop()


_SESSION_LOCK = threading.Lock()
_SESSIONS: dict[str, TikTokLoginSession] = {}


def _launch_persistent_context(profile_dir: Path):
    playwright = sync_playwright().start()
    launch_kwargs = {
        "user_data_dir": str(profile_dir),
        "headless": False,
        "viewport": {"width": 1280, "height": 900},
        "args": ["--disable-blink-features=AutomationControlled"],
    }

    try:
        context = playwright.chromium.launch_persistent_context(channel="chrome", **launch_kwargs)
    except Exception:
        context = playwright.chromium.launch_persistent_context(**launch_kwargs)

    page = context.pages[0] if context.pages else context.new_page()
    return playwright, context, page


def _build_profile_dir(folder_path: str) -> Path:
    folder = Path(folder_path)
    if folder.is_absolute():
        profile_dir = folder
    else:
        profile_dir = PROJECT_ROOT / folder
        legacy_profile_dir = LEGACY_PROJECT_ROOT / folder
        if not profile_dir.exists() and legacy_profile_dir.exists():
            profile_dir = legacy_profile_dir
    profile_dir.mkdir(parents=True, exist_ok=True)
    return profile_dir


def start_tiktok_qr_session(session_id: str, folder_path: str) -> TikTokLoginSession:
    profile_dir = _build_profile_dir(folder_path)
    session = _SESSIONS.get(session_id)
    if session:
        session.close()

    playwright, context, page = _launch_persistent_context(profile_dir)
    page.goto(DEFAULT_LOGIN_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(5000)

    session = TikTokLoginSession(
        playwright=playwright,
        context=context,
        page=page,
        session_id=session_id,
        profile_dir=profile_dir,
    )
    session.capture_qr()

    with _SESSION_LOCK:
        _SESSIONS[session_id] = session

    return session


def get_tiktok_qr_session(session_id: str) -> Optional[TikTokLoginSession]:
    return _SESSIONS.get(session_id)


def stop_tiktok_qr_session(session_id: str):
    with _SESSION_LOCK:
        session = _SESSIONS.pop(session_id, None)

    if session:
        session.close()


def refresh_tiktok_qr_session(session_id: str) -> TikTokLoginSession:
    session = _SESSIONS.get(session_id)
    if not session:
        raise RuntimeError("Chưa khởi tạo phiên QR cho profile này")

    session.capture_qr()
    return session
