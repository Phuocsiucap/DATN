async def crawl_article(page, url):
    await page.goto(url, wait_until="domcontentloaded")

    try:
        title = await page.locator("h1.title-detail").inner_text()

        content_nodes = await page.locator("article.fck_detail p").all()
        content = "\n".join([await node.inner_text() for node in content_nodes])

        img = page.locator("article.fck_detail img").first
        image = await img.get_attribute("src")

        if image and image.startswith("data:"):
            image = await img.get_attribute("data-src")

        return {
            "title": title,
            "content": content,
            "image": image,
            "link": url
        }

    except Exception as e:
        print(f"❌ Error crawling {url}: {e}")
        return None