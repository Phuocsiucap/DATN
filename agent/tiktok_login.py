import os
import time
from playwright.sync_api import sync_playwright

# Đường dẫn thư mục lưu trữ profile (session)
USER_DATA_DIR = os.path.join(os.getcwd(), "tiktok_profile")

def login_to_tiktok():
    print(f"[*] Đang sử dụng thư mục profile: {USER_DATA_DIR}")
    print("[*] Vui lòng đăng nhập bằng tay trên trình duyệt vừa mở.")
    print("[*] Sau khi đăng nhập thành công và thấy trang chủ của bạn, hãy đóng trình duyệt để lưu phiên.")
    
    with sync_playwright() as p:
        # Mở trình duyệt với context lưu trữ vĩnh viễn (persistent context)
        # headless=False để hiển thị giao diện cho bạn thao tác đăng nhập
        browser = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            headless=False,
            channel="chrome", # Sử dụng Chrome thực tế thay vì Chromium mặc định (giúp tránh bị nhận diện bot dễ hơn)
            viewport={"width": 1280, "height": 720},
            args=[
                "--disable-blink-features=AutomationControlled", # Ẩn dấu hiệu automation
            ]
        )
        
        page = browser.new_page() if len(browser.pages) == 0 else browser.pages[0]
        
        # Truy cập vào TikTok
        page.goto("https://www.tiktok.com/login")
        
        print("\n[*] Trình duyệt đã mở. Hãy tiến hành đăng nhập.")
        print("[*] Đang chờ bạn đăng nhập và đóng trình duyệt...")
        
        # Giữ cho trình duyệt mở cho đến khi người dùng tự đóng nó
        try:
            # Vòng lặp chờ trình duyệt đóng (sẽ văng ra lỗi khi context bị đóng, ta dùng try-except để bắt)
            while len(browser.pages) > 0:
                time.sleep(1)
        except Exception as e:
            pass
            
        print("[*] Trình duyệt đã đóng. Session đăng nhập đã được lưu lại thành công!")

if __name__ == "__main__":
    login_to_tiktok()
