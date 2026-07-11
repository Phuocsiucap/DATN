from playwright.sync_api import sync_playwright
import json

def scrape(url):
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            
            # Wait a bit for JS to load the video element if it's dynamic
            page.wait_for_timeout(3000)

            result = {"link": url, "title": "", "content": "", "images": [], "videos": []}

            # 1. Lấy Tiêu đề
            try:
                result["title"] = page.locator("h1.title-detail").inner_text(timeout=5000)
            except Exception:
                pass

            # 2. Lấy Nội dung văn bản
            try:
                content_nodes = page.locator("article.fck_detail p.Normal").all()
                result["content"] = [n.inner_text().strip() for n in content_nodes if n.inner_text().strip()]
            except Exception:
                pass

            # 3. Lấy TẤT CẢ Hình ảnh
            try:
                imgs = page.locator("article.fck_detail img").all()
                for img in imgs:
                    src = img.get_attribute("src")
                    if src and src.startswith("data:"):
                        src = img.get_attribute("data-src")
                    if src and "svg" not in src:
                        result["images"].append(src)
            except Exception:
                pass

            # 4. Lấy TẤT CẢ Video
            try:
                vne_videos = page.locator("div.vne-video").all()
                for v in vne_videos:
                    vid_src = v.get_attribute("data-video-src")
                    if vid_src:
                        result["videos"].append(vid_src)
                        
                vjs_videos = page.locator("div.video-js").all()
                for v in vjs_videos:
                    vid_src = v.get_attribute("src")
                    if vid_src and "m3u8" in vid_src:
                        result["videos"].append(vid_src)
                
                html_videos = page.locator("article.fck_detail video").all()
                for v in html_videos:
                    vid_src = v.get_attribute("src")
                    if vid_src and not vid_src.startswith("blob:"):
                        result["videos"].append(vid_src)
                        
                iframes = page.locator("article.fck_detail iframe").all()
                for iframe in iframes:
                    src = iframe.get_attribute("src")
                    if src:
                        result["videos"].append(src)
                        
                result["videos"] = list(set(result["videos"]))
            except Exception:
                pass

            browser.close()
            return result
            
    except Exception as e:
        return {"error": str(e)}

print(json.dumps(scrape('https://vnexpress.net/chau-nhac-si-trinh-cong-son-gay-chu-y-o-tinh-ha-say-hi-5093649.html'), indent=2, ensure_ascii=False))
