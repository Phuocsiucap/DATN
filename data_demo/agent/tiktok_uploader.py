import os
import time
from playwright.sync_api import sync_playwright

USER_DATA_DIR = os.path.join(os.getcwd(), "tiktok_profile")
VIDEO_PATH = r"d:\DATN\data_demo\Recording 2026-06-15 235803.mp4"
CAPTION_TEXT = "demo autoupload"

def upload_video():
    print(f"[*] Đang load phiên đăng nhập từ: {USER_DATA_DIR}")
    
    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            headless=False,
            channel="chrome",
            viewport={"width": 1280, "height": 720},
            args=[
                "--disable-blink-features=AutomationControlled",
            ]
        )
        
        page = browser.new_page() if len(browser.pages) == 0 else browser.pages[0]
        
        print("[*] Truy cập vào trang Upload Video...")
        page.goto("https://www.tiktok.com/creator-center/upload")
        
        # 1. Tìm iframe (nếu TikTok dùng iframe) hoặc trực tiếp trên DOM
        # Đợi một chút để trang load hoàn tất thay vì dùng networkidle (TikTok gọi api ngầm liên tục sẽ gây timeout)
        page.wait_for_timeout(5000)
        
        iframe_element = page.locator("iframe[data-tt-e2e='creator-center-iframe']")
        if iframe_element.count() > 0:
            print("[*] Đã phát hiện iframe tải video, đang lấy nội dung iframe...")
            frame = iframe_element.content_frame()
        else:
            print("[*] Không có iframe, xử lý trực tiếp trên trang chính...")
            frame = page

        # 2. Upload video
        print("[*] Đang tìm ô upload file...")
        file_input = frame.locator("input[type='file'][accept*='video']")
        file_input.wait_for(state="attached", timeout=30000)
        print(f"[*] Đang tải video lên: {VIDEO_PATH}")
        file_input.set_input_files(VIDEO_PATH)

        # 3. Chờ tải video hoàn tất và nhập caption
        print("[*] Chờ form nhập liệu xuất hiện...")
        # TikTok dùng thư viện Draft.js cho phần nhập text
        editor = frame.locator(".public-DraftEditor-content, div[contenteditable='true']").first
        editor.wait_for(state="visible", timeout=60000)
        
        print("[*] Xóa text cũ và nhập caption mới...")
        editor.focus()
        editor.click(force=True)
        # Dùng editor.press thay cho page.keyboard để đảm bảo chỉ thao tác trong phạm vi ô nhập liệu
        editor.press("Control+a") 
        editor.press("Backspace")
        editor.type(CAPTION_TEXT, delay=100)
        
        # 4. Tìm và bấm nút Đăng (Post)
        print("[*] Đang tìm nút Đăng bài...")
        # Tìm nút có chữ "Post" hoặc "Đăng"
        post_button = frame.locator("button:has-text('Post'), button:has-text('Đăng'), [data-e2e='post_button']").last
        
        print("[*] Video đã sẵn sàng! (Chờ 5 giây trước khi tự động bấm Đăng...)")
        time.sleep(5)
        
        if post_button.count() > 0:
            post_button.click(force=True)
            print("[*] Đã bấm nút Đăng!")
            # Đợi một chút để tiến trình upload hoàn tất trước khi đóng trình duyệt
            time.sleep(15) 
        else:
            print("[!] Không tìm thấy nút Đăng, vui lòng kiểm tra lại giao diện!")
            # Giữ trình duyệt mở để kiểm tra
            try:
                while len(browser.pages) > 0:
                    time.sleep(1)
            except:
                pass

if __name__ == "__main__":
    upload_video()
