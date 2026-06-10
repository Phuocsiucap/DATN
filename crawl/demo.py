from playwright.sync_api import sync_playwright

def crawl_article(page, url):
    page.goto(url, wait_until="domcontentloaded")
    
    try:
        title = page.locator("h1.title-detail").inner_text()
        content_nodes = page.locator("article.fck_detail p").all()
        content = "\n".join([node.inner_text() for node in content_nodes])
        
        # image = page.locator("article.fck_detail img").first.get_attribute("src")
        img = page.locator("article.fck_detail img").first

        image = img.get_attribute("src")

        if image and image.startswith("data:"):
            image = img.get_attribute("data-src")
        return {
            "title": title,
            "content": content,
            "image": image,
            "link": url
        }
    except Exception as e:
        print(f"Error occurred while crawling {url}: {e}")
        return None

def crawl_vnexpress():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=500)
        page = browser.new_page()
        
        page.goto("https://vnexpress.net/", wait_until="domcontentloaded")

        articles = page.query_selector_all("h3.title-news a")
        links = [a.get_attribute("href").split("#")[0] for a in articles]
        links = list(set(links))  # Remove duplicates
        results = []
        # for article in articles:
        #     title = article.inner_text()
        #     link = article.get_attribute("href")
        #     results.append({"title": title, "link": link})

        for link in links[:5]:
            print(f"Crawling article: {link}")
            data = crawl_article(page, link)
            if data:
                results.append(data)
        for item in results:
            print(item)

        browser.close()

if __name__ == "__main__":
    crawl_vnexpress()
