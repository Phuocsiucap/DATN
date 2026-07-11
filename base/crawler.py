import redis
import json
from playwright.sync_api import sync_playwright

r = redis.Redis(host='localhost', port=6379, decode_responses=True)

def push_job(link):
    r.lpush("article_queue", link)
    

def crawl_vnexpress():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=500)
        page = browser.new_page()
        
        page.goto("https://vnexpress.net/", wait_until="domcontentloaded")

        articles = page.query_selector_all("h3.title-news a")
        links = [a.get_attribute("href").split("#")[0] for a in articles]
        links = list(set(links))  # Remove duplicates
        # results = []
        # for article in articles:
        #     title = article.inner_text()
        #     link = article.get_attribute("href")
        #     results.append({"title": title, "link": link})

        for link in links[:5]:
            print(f"Crawling article: {link}")
            
            push_job(link)
        

        browser.close()

if __name__ == "__main__":
    crawl_vnexpress()
