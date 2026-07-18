from __future__ import annotations


def crawl_vnexpress_sync() -> list[str]:
    from playwright.sync_api import sync_playwright

    links = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto("https://vnexpress.net/", wait_until="domcontentloaded", timeout=30000)
            anchors = page.query_selector_all("h3.title-news a")
            links = list(set([(a.get_attribute("href") or "").split("#")[0] for a in anchors]))
            browser.close()
    except Exception as exc:
        print(f"Playwright crawl error: {exc}")
    return [link for link in links if link.startswith("http")][:10]


def crawl_rss_sync(numberofarticles: int = 10) -> list[str]:
    import feedparser

    try:
        feed = feedparser.parse("https://vnexpress.net/rss/tin-moi-nhat.rss")
        return [entry.link for entry in feed.entries[:numberofarticles]]
    except Exception as exc:
        print(f"RSS error: {exc}")
        return []


def crawl_article_sync(url: str) -> dict | None:
    import html
    import re

    from playwright.sync_api import sync_playwright

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                extra_http_headers={
                    "Referer": "https://vnexpress.net/",
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/115.0.0.0 Safari/537.36"
                    ),
                }
            )
            page = context.new_page()
            captured_videos: list[str] = []

            def capture_video_response(response):
                response_url = response.url
                if ".m3u8" in response_url or ".mp4" in response_url:
                    captured_videos.append(response_url)

            page.on("response", capture_video_response)
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)

            result = {"link": url, "title": "", "content": [], "images": [], "videos": []}

            try:
                result["title"] = page.locator("h1.title-detail").inner_text(timeout=5000)
            except Exception:
                pass

            try:
                content_nodes = page.locator("article.fck_detail p.Normal").all()
                result["content"] = [node.inner_text().strip() for node in content_nodes if node.inner_text().strip()]
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
                for video in page.locator("div.vne-video").all():
                    for attr in ("data-video-src", "data-src", "data-file", "data-url"):
                        src = video.get_attribute(attr)
                        if src:
                            result["videos"].append(html.unescape(src))

                for video in page.locator("div.video-js").all():
                    for attr in ("src", "data-src", "data-file", "data-url"):
                        src = video.get_attribute(attr)
                        if src and (".m3u8" in src or ".mp4" in src):
                            result["videos"].append(html.unescape(src))

                for video in page.locator("article.fck_detail video").all():
                    src = video.get_attribute("src")
                    if src and not src.startswith("blob:"):
                        result["videos"].append(src)

                for iframe in page.locator("article.fck_detail iframe").all():
                    src = iframe.get_attribute("src")
                    if src:
                        result["videos"].append(src)

                page_html = page.content()
                for match in re.findall(r'https?:\\?/\\?/[^"\'\s<>]+?(?:\.m3u8|\.mp4)[^"\'\s<>]*', page_html):
                    result["videos"].append(html.unescape(match).replace("\\/", "/"))

                result["videos"].extend(captured_videos)
                result["videos"] = list(dict.fromkeys(result["videos"]))
            except Exception:
                pass

            context.close()
            browser.close()
            return result if result["title"] else None
    except Exception as exc:
        print(f"Error crawling {url}: {exc}")
        return None
