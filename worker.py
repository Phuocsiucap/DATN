import sys
from pathlib import Path
from playwright.async_api import async_playwright
import asyncio
import redis
import os
from dotenv import load_dotenv
from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from crawl.article import crawl_article

load_dotenv()

r = redis.Redis(host='localhost', port=6379, decode_responses=True)

client = MongoClient(os.getenv("MONGO_URI"))
db = client[os.getenv("DB_NAME")]
collection = db[os.getenv("COLLECTION_NAME")]

async def process(context, link):
    if not collection.find_one({"link": link}):
        page = await context.new_page()

        print("🔄 Processing:", link)
        
        
        data = await crawl_article(page, link)

        if data:
            try:
                collection.insert_one(data)
                print("✅ Saved:", data["title"])
            except:
                print("⏩ Duplicate")

        await page.close()
    
async def worker():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()

        while True:
            tasks = []

            # lấy 5 job 1 lúc
            for _ in range(5):
                item = r.lpop("article_queue")
                if item:
                    tasks.append(process(context, item))

            if tasks:
                await asyncio.gather(*tasks)
            else:
                await asyncio.sleep(1)
        
async def main():
    await worker()

if __name__ == "__main__":
    asyncio.run(main())