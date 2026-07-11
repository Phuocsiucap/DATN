import httpx
from datetime import datetime
from backend.core.config import settings
from backend.core.database import articles_col, publish_log_col
from backend.services.ai_rewriter import rewrite_for_platform
from backend.api.websockets.events import broadcast
import os
import asyncio
from playwright.sync_api import sync_playwright


from pathlib import Path

# Tìm đường dẫn gốc của project (D:\DATN)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

async def publish_to_facebook(content: str, media_path: str = None) -> dict:
    """Post to Facebook Page via Graph API."""
    page_id = settings.FB_PAGE_ID
    token = settings.FB_ACCESS_TOKEN

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
            
            post_button = frame.locator("button:has-text('Post'), button:has-text('Đăng'), [data-e2e='post_button']").last
            
            # Chờ linh hoạt: Kiểm tra liên tục trạng thái của nút Đăng và các text trạng thái
            for i in range(120): # Tối đa 10 phút (120 * 5s)
                # 1. Nút Đăng có bị mờ/khoá không? Sử dụng hàm chuẩn của Playwright thay vì JS
                is_disabled = post_button.is_disabled()
                
                # 2. Kiểm tra xem có thanh progress hay thông báo Đang tải không
                uploading_text = frame.locator("div:text-is('Uploading...'), div:text-is('Đang tải lên...'), div:text-is('Processing...'), div:text-is('Đang xử lý...')").count()
                
                # 3. Kiểm tra xem nút Huỷ (Cancel) tải lên còn tồn tại không
                is_canceling = frame.locator("button:has-text('Cancel'), button:has-text('Hủy'), [data-e2e='cancel-upload']").count() > 0
                
                if not is_disabled and uploading_text == 0 and not is_canceling:
                    # Chờ thêm 3 giây để đảm bảo mọi animation đã xong
                    page.wait_for_timeout(3000)
                    print("[*] Đã xác nhận file được đẩy lên server TikTok thành công 100%!")
                    break
                
                print(f"[*] Tiến trình tải lên đang diễn ra, chờ thêm 5s... (Lần {i+1}/120)")
                page.wait_for_timeout(5000)
            
            if post_button.count() > 0:
                post_button.click(force=True)
                print("[*] Đã tự động bấm nút Đăng!")
                # Chờ tiến trình upload hoàn tất (có thể mất thời gian tuỳ mạng)
                page.wait_for_timeout(15000)
                
                print("[*] Đã đăng xong. Giữ trình duyệt mở theo yêu cầu...")
                while len(browser.pages) > 0:
                    page.wait_for_timeout(1000)
                return {"success": True, "note": "TikTok auto-posted successfully"}
            else:
                print("[!] Không tìm thấy nút Đăng!")
                # Nếu lỗi không thấy nút, giữ lại cho người dùng xem
                while len(browser.pages) > 0:
                    page.wait_for_timeout(1000)
                return {"success": False, "error": "Không tìm thấy nút Đăng bài trên TikTok"}
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[!] Lỗi xảy ra: {e}. Giữ trình duyệt mở để kiểm tra...")
            while len(browser.pages) > 0:
                page.wait_for_timeout(1000)
            raise e


async def publish_to_tiktok(content: str, media_path: str = None) -> dict:
    """Post caption to TikTok (mở trình duyệt để người dùng đăng thủ công)."""
    # Trỏ động về thư mục chứa profile tiktok
    user_data_dir = str(PROJECT_ROOT / "tiktok_profile")
    
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

PUBLISHERS = {
    "facebook": publish_to_facebook,
    "tiktok": publish_to_tiktok,
}

from backend.services.video_handler.downloader import extract_video_url, download_video

async def publish_article(article: dict, platform: str) -> dict:
    """Rewrite and publish article to a platform."""
    link = article.get("link", "")

    # Tạm thời bỏ qua api viết lại, dùng trực tiếp nội dung gốc của bài báo
    title = article.get("title", "")
    content_raw = article.get("content", "")
    
    # Do database lưu content dưới dạng mảng các đoạn văn (list), ta cần nối chúng lại
    # if isinstance(content_raw, list):
    #     content_text = "\n\n".join(content_raw)
    # else:
    #     content_text = str(content_raw)
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

    result = await publisher_fn(rewritten, media_path)

    # Log result
    log = {
        "link": link,
        "platform": platform,
        "success": result.get("success", False),
        "result": result,
        "published_at": datetime.utcnow(),
        "content_preview": rewritten[:200],
    }
    publish_log_col.insert_one(log)

    # Update article status
    if result.get("success"):
        articles_col.update_one(
            {"link": link},
            {"$set": {f"published.{platform}": True, "status": "published"}}
        )

    # Broadcast to dashboard
    await broadcast({
        "type": "article_published",
        "platform": platform,
        "title": article.get("title", ""),
        "link": link,
        "success": result.get("success"),
        "timestamp": datetime.utcnow().isoformat()
    })

    return result
