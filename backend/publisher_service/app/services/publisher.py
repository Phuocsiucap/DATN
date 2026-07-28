import httpx
from datetime import datetime
from types import SimpleNamespace
from backend.publisher_service.app.core.config import settings
from backend.publisher_service.app.services.ai_rewriter import rewrite_for_platform
from backend.publisher_service.app.services.user_client import create_publish_log
import os
import re
import asyncio
import time
from playwright.sync_api import sync_playwright


from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[4]
LEGACY_USER_SERVICE_ROOT = PROJECT_ROOT / "backend" / "user_service"


async def broadcast(event: dict):
    return None

def _profile_obj(profile: dict | SimpleNamespace | None):
    if profile is None or isinstance(profile, SimpleNamespace):
        return profile
    return SimpleNamespace(**profile)


def _resolve_profile_dir(folder_path: str) -> Path:
    folder = Path(folder_path)
    if folder.is_absolute():
        return folder.resolve()

    profile_dir = (PROJECT_ROOT / folder).resolve()
    legacy_profile_dir = (LEGACY_USER_SERVICE_ROOT / folder).resolve()
    if profile_dir.exists():
        return profile_dir
    if legacy_profile_dir.exists():
        return legacy_profile_dir
    return profile_dir


def _safe_wait(page, timeout_ms: int) -> None:
    try:
        if not page.is_closed():
            page.wait_for_timeout(timeout_ms)
    except Exception:
        pass


def _safe_close_browser(browser) -> None:
    try:
        browser.close()
    except Exception:
        pass


def _is_checked_control(control) -> bool:
    try:
        if control.get_attribute("aria-checked") == "true":
            return True
    except Exception:
        pass
    try:
        if control.get_attribute("aria-pressed") == "true":
            return True
    except Exception:
        pass
    try:
        return bool(control.is_checked())
    except Exception:
        return False


def _disable_tiktok_check_toggle(frame, label: str) -> bool:
    label_node = frame.get_by_text(label, exact=True).first
    try:
        if label_node.count() == 0:
            return False
        container = label_node.locator(
            "xpath=ancestor::*[.//button[@role='switch'] or .//*[@role='switch'] or .//input[@type='checkbox']][1]"
        )
        if container.count() == 0:
            container = label_node.locator("xpath=ancestor::*[self::div or self::section][1]")

        control = container.locator("button[role='switch'], [role='switch'], input[type='checkbox']").first
        if control.count() == 0:
            control = container.locator("button").last
        if control.count() == 0:
            return False

        if _is_checked_control(control):
            control.click(force=True)
            print(f"[*] Đã tắt TikTok check: {label}")
            return True
    except Exception as exc:
        print(f"[!] Không tắt được TikTok check '{label}': {exc}")
    return False


def _disable_tiktok_pre_post_checks(frame) -> None:
    for label in ("Music copyright check", "Content check lite"):
        _disable_tiktok_check_toggle(frame, label)


def _first_visible_locator(*locators):
    for locator in locators:
        try:
            count = locator.count()
        except Exception:
            continue
        for index in range(count):
            item = locator.nth(index)
            try:
                if item.is_visible(timeout=1000):
                    return item
            except Exception:
                continue
    return None


def _find_tiktok_post_button(frame):
    return _first_visible_locator(
        frame.locator("[data-e2e='post_button']"),
        frame.get_by_role("button", name=re.compile(r"^(Post|Đăng|Post now|Đăng ngay)$", re.I)),
        frame.locator("button:has-text('Post')"),
        frame.locator("button:has-text('Đăng')"),
    )


def _is_tiktok_post_button_disabled(post_button) -> bool:
    try:
        if post_button.is_disabled(timeout=2000):
            return True
    except Exception:
        return True
    for attr in ("aria-disabled", "disabled"):
        try:
            value = post_button.get_attribute(attr)
            if value in {"", "true", "disabled"}:
                return True
        except Exception:
            pass
    try:
        class_name = (post_button.get_attribute("class") or "").lower()
        if "disabled" in class_name or "disable" in class_name:
            return True
    except Exception:
        pass
    return False


def _wait_for_tiktok_post_button_ready(frame, page, timeout_seconds: int = 600):
    deadline = time.time() + timeout_seconds
    attempt = 0
    ready_hits = 0
    while time.time() < deadline:
        attempt += 1
        post_button = _find_tiktok_post_button(frame)
        if not post_button:
            print(f"[*] Chưa thấy nút Đăng, chờ thêm 5s... (Lần {attempt})")
            page.wait_for_timeout(5000)
            continue

        try:
            post_button.scroll_into_view_if_needed(timeout=5000)
        except Exception:
            pass

        is_disabled = _is_tiktok_post_button_disabled(post_button)
        uploading_text = frame.locator(
            "div:text-is('Uploading...'), div:text-is('Đang tải lên...'), "
            "div:text-is('Processing...'), div:text-is('Đang xử lý...')"
        ).count()
        is_canceling = frame.locator("button:has-text('Cancel'), button:has-text('Hủy'), [data-e2e='cancel-upload']").count() > 0

        if not is_disabled and uploading_text == 0 and not is_canceling:
            ready_hits += 1
            if ready_hits >= 2:
                print("[*] Nút Đăng đã bật và ổn định, có thể bấm.")
                return post_button
            print("[*] Nút Đăng đã bật, kiểm tra ổn định thêm 2s...")
            page.wait_for_timeout(2000)
            continue

        ready_hits = 0

        print(f"[*] Tiến trình tải lên đang diễn ra, chờ thêm 5s... (Lần {attempt}/{timeout_seconds // 5})")
        page.wait_for_timeout(5000)
    return None


def _click_tiktok_post_button(frame, page) -> None:
    post_button = _find_tiktok_post_button(frame)
    if not post_button:
        _save_tiktok_debug_screenshot(page, "post-button-not-found")
        raise RuntimeError("Không tìm thấy nút Đăng bài trên TikTok")
    if _is_tiktok_post_button_disabled(post_button):
        _save_tiktok_debug_screenshot(page, "post-button-disabled")
        raise RuntimeError("Nút Đăng vẫn đang disabled, chưa thể bấm.")

    try:
        post_button.scroll_into_view_if_needed(timeout=5000)
    except Exception:
        pass

    try:
        post_button.click(timeout=15000)
    except Exception as normal_click_error:
        print(f"[!] Click thường vào nút Đăng thất bại, thử force click: {normal_click_error}")
        post_button.click(force=True, timeout=15000)


async def publish_to_facebook(content: str, media_path: str = None) -> dict:
    """Post to Facebook Page via Graph API."""
    page_id = settings.fb_page_id
    token = settings.fb_access_token

    if not page_id or not token:
        return {"success": False, "error": "Facebook credentials not configured"}

    url = f"https://graph.facebook.com/v19.0/{page_id}/feed"
    payload = {"message": content, "access_token": token}

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(url, data=payload, timeout=30)
            data = resp.json()
            if "id" in data:
                return {"success": True, "post_id": data["id"]}
            return {"success": False, "error": data.get("error", {}).get("message", "Unknown")}
        except Exception as e:
            return {"success": False, "error": str(e)}

def _publish_to_tiktok_sync(content: str, video_path: str, user_data_dir: str):
    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=False, # True -chạy ngầm hoàn toàn
            channel="chrome",
            viewport={"width": 1280, "height": 720},
            args=["--disable-blink-features=AutomationControlled"]
        )
        
        try:
            pages = browser.pages
            page = pages[0] if len(pages) > 0 else browser.new_page()
            
            print("[*] Tự động truy cập Upload Video TikTok...")
            page.goto("https://www.tiktok.com/tiktokstudio/upload")
            
            # Đợi tải trang
            page.wait_for_timeout(5000)
            
            iframe_element = page.locator("iframe[data-tt-e2e='creator-center-iframe']")
            if iframe_element.count() > 0:
                frame = iframe_element.content_frame()
            else:
                frame = page

            # 1. Tải video lên
            print(f"[*] Đang tự động tải video lên: {video_path}")
            file_input = frame.locator("input[type='file'][accept*='video']")
            file_input.wait_for(state="attached", timeout=30000)
            file_input.set_input_files(video_path)

            # 2. Chờ ô nhập caption xuất hiện
            print("[*] Đang đợi form nhập liệu...")
            editor = frame.locator(".public-DraftEditor-content, div[contenteditable='true']").first
            editor.wait_for(state="visible", timeout=60000)
            
            # TikTok tự động điền tên file vào caption, chờ một chút để nó điền xong rồi mình xóa
            page.wait_for_timeout(2000)
            
            print("[*] Xóa text cũ và dán caption mới...")
            editor.focus()
            editor.click(force=True)
            editor.press("Control+a")
            editor.press("Backspace")
            
            import pyperclip
            pyperclip.copy(content)
            editor.press("Control+v")
            page.wait_for_timeout(1000) # đợi dán xong
            
            print("[*] Đang chờ tiến trình tải lên 100% hoàn tất...")
            
            post_button = _wait_for_tiktok_post_button_ready(frame, page)
            if post_button:
                _disable_tiktok_pre_post_checks(frame)
                page.wait_for_timeout(1000)
                _click_tiktok_post_button(frame, page)
                print("[*] Đã tự động bấm nút Đăng khi nút đã bật!")
                # Chờ tiến trình upload hoàn tất (có thể mất thời gian tuỳ mạng)
                page.wait_for_timeout(15000)
                
                print("[*] Đã đăng xong. Chờ 10 giây rồi đóng trình duyệt...")
                page.wait_for_timeout(10000)
                _safe_close_browser(browser)
                return {"success": True, "note": "TikTok auto-posted successfully"}
            else:
                print("[!] Không tìm thấy nút Đăng!")
                # Nếu lỗi không thấy nút, giữ lại cho người dùng xem
                page.wait_for_timeout(10000)
                _safe_close_browser(browser)
                return {"success": False, "error": "Không tìm thấy nút Đăng bài trên TikTok"}
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[!] Lỗi xảy ra: {e}. Giữ trình duyệt mở để kiểm tra...")
            _safe_wait(page, 10000)
            _safe_close_browser(browser)
            raise e


async def publish_to_tiktok(content: str, media_path: str = None, profile: dict | SimpleNamespace | None = None) -> dict:
    """Post caption to TikTok (mở trình duyệt để người dùng đăng thủ công)."""
    profile = _profile_obj(profile)
    if not profile or not profile.folder_path:
        return {"success": False, "error": "Chưa chọn TikTok profile để đăng bài"}

    full_path = _resolve_profile_dir(profile.folder_path)
    if not full_path.exists():
        return {"success": False, "error": f"Không tìm thấy thư mục session TikTok tại {full_path}. Hãy QR login lại account này."}
    user_data_dir = str(full_path)
    print(f"[*] Đang dùng TikTok profile #{profile.id} - {profile.profile_name}: {user_data_dir}")
    
    # Ưu tiên video tải về, nếu không có dùng video mặc định
    if media_path and os.path.exists(media_path):
        video_path = media_path
    else:
        video_path = str(PROJECT_ROOT / "data_demo" / "Recording 2026-06-15 235803.mp4")
    
    try:
        if not os.path.exists(video_path):
            return {"success": False, "error": f"Không tìm thấy video tại {video_path}"}

        # Run sync playwright in a background thread to avoid Windows NotImplementedError with asyncio subprocess in Uvicorn
        result = await asyncio.to_thread(_publish_to_tiktok_sync, content, video_path, user_data_dir)
        return result
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[!] Lỗi khi chạy Playwright auto TikTok:\n{tb}")
        return {"success": False, "error": f"{repr(e)}\n{tb}"}


async def publish_local_video_to_tiktok(content: str, video_path: str, profile: dict | SimpleNamespace | None = None) -> dict:
    """Publish a processed local video file to TikTok without crawling or downloading anything."""
    profile = _profile_obj(profile)
    if not profile or not profile.folder_path:
        return {"success": False, "error": "Chưa chọn TikTok profile để đăng bài"}
    if not video_path:
        return {"success": False, "error": "Chưa có đường dẫn video thành phẩm"}

    resolved_video_path = Path(video_path).resolve()
    if not resolved_video_path.exists() or not resolved_video_path.is_file():
        return {"success": False, "error": f"Không tìm thấy video thành phẩm tại {resolved_video_path}"}

    full_path = _resolve_profile_dir(profile.folder_path)
    if not full_path.exists():
        return {"success": False, "error": f"Không tìm thấy thư mục session TikTok tại {full_path}. Hãy QR login lại account này."}
    user_data_dir = str(full_path)
    print(f"[*] Đăng video local đã xử lý bằng TikTok profile #{profile.id} - {profile.profile_name}: {user_data_dir}")
    print(f"[*] Video local: {resolved_video_path}")

    try:
        result = await asyncio.to_thread(_publish_to_tiktok_sync, content, str(resolved_video_path), user_data_dir)
        return result
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[!] Lỗi khi đăng video local lên TikTok:\n{tb}")
        return {"success": False, "error": f"{repr(e)}\n{tb}"}

PUBLISHERS = {
    "facebook": publish_to_facebook,
    "tiktok": publish_to_tiktok,
}

from backend.publisher_service.app.services.video_handler.downloader import extract_video_url, download_video

async def publish_article(article: dict, platform: str, profile: dict | SimpleNamespace | None = None, content_override: str = None) -> dict:
    """Rewrite and publish article to a platform."""
    profile = _profile_obj(profile)
    link = article.get("link", "")

    # Tạm thời bỏ qua api viết lại, dùng trực tiếp nội dung gốc của bài báo
    title = article.get("title", "")
    content_raw = article.get("content", "")
    
    # Do database lưu content dưới dạng mảng các đoạn văn (list), ta cần nối chúng lại
    # if isinstance(content_raw, list):
    #     content_text = "\n\n".join(content_raw)
    # else:
    #     content_text = str(content_raw)
    if content_override:
        rewritten = content_override
    else:
        content_text = await rewrite_for_platform({"title": title, "content": content_raw}, platform)

        # Lấy một phần nội dung và đính kèm link gốc
        if platform == "tiktok":
            # Caption TikTok
            rewritten = f"{title}\n\n{content_text[:1000]}...\n\n#tinnhanh #tintuc"
        else:
            rewritten = f"{title}\n\n{content_text[:1000]}...\n\nĐọc tiếp tại: {link}"

    # Lấy video đầu tiên nếu có
    videos = article.get("videos", [])
    media_path = None
    if videos:
        print("[*] Đang tiến hành tải video tự động từ bài báo...")
        embed_url = videos[0]
        raw_url = extract_video_url(embed_url)
        try:
            media_path = await asyncio.to_thread(download_video, raw_url)
            print(f"[*] Tải video thành công: {media_path}")
        except Exception as e:
            print(f"[!] Lỗi khi tải video: {e}")

    # Publish
    publisher_fn = PUBLISHERS.get(platform)
    if not publisher_fn:
        return {"success": False, "error": f"Unknown platform: {platform}"}

    if platform == "tiktok":
        result = await publish_to_tiktok(rewritten, media_path, profile)
    else:
        result = await publisher_fn(rewritten, media_path)

    # Log result
    log = {
        "link": link,
        "platform": platform,
        "profile_id": profile.id if profile else None,
        "profile_name": profile.profile_name if profile else None,
        "success": result.get("success", False),
        "result": result,
        "published_at": datetime.utcnow().isoformat(),
        "content_preview": rewritten[:200],
    }
    await create_publish_log(log)

    return result
