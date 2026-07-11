def crawl_vnexpress_sync() -> list[str]:
    """Run Playwright in its own thread with ProactorEventLoop (Windows-safe)."""
    from playwright.sync_api import sync_playwright

    links = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto("https://vnexpress.net/", wait_until="domcontentloaded", timeout=30000)
            anchors = page.query_selector_all("h3.title-news a")
            links = list(set([
                (a.get_attribute("href") or "").split("#")[0]
                for a in anchors
            ]))
            browser.close()
    except Exception as e:
        print(f"Playwright crawl error: {e}")
    return [l for l in links if l.startswith("http")][:10]


def crawl_rss_sync(numberofarticles: int = 10) -> list[str]:
    import feedparser
    try:
        feed = feedparser.parse("https://vnexpress.net/rss/tin-moi-nhat.rss")
        return [e.link for e in feed.entries[:numberofarticles]]
    except Exception as e:
        print(f"RSS error: {e}")
        return []


def crawl_article_sync(url: str) -> dict | None:
    """Crawl a single article synchronously using Playwright."""
    from playwright.sync_api import sync_playwright

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=30000)

            result = {"link": url, "title": "", "content": [], "images": [], "videos": []}

            try:
                result["title"] = page.locator("h1.title-detail").inner_text(timeout=5000)
            except Exception:
                pass

            try:
                content_nodes = page.locator("article.fck_detail p.Normal").all()
                result["content"] = [n.inner_text().strip() for n in content_nodes if n.inner_text().strip()]
            except Exception:
                pass

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
            
            if result["title"]:
                return result
            return None
    except Exception as e:
        print(f"Error crawling {url}: {e}")
        return None
