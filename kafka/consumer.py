import os
import asyncio
import sys
from pathlib import Path
from kafka import KafkaConsumer
import json
from dotenv import load_dotenv
from playwright.async_api import async_playwright
from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from crawl.article import crawl_article


load_dotenv()
client = MongoClient(os.getenv("MONGO_URI"))
db = client[os.getenv("DB_NAME")]
collection = db[os.getenv("COLLECTION_NAME")]

consumer = KafkaConsumer(
    "vnexpress-articles",
    bootstrap_servers="localhost:9092",
    value_deserializer=lambda x: json.loads(x.decode("utf-8"))
)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        for message in consumer:
            page = await context.new_page()
            data = message.value
            print("Received data:", data)
            await crawl_article(page, data["link"])
            await page.close()

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())