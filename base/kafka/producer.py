import os

from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable
import json

from playwright.sync_api import sync_playwright
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from dotenv import load_dotenv

load_dotenv()

client = None
collection = None
producer = None
mongo_disabled = False


def get_collection():
    global client, collection, mongo_disabled

    if mongo_disabled:
        return None

    if collection is not None:
        return collection

    mongo_uri = os.getenv("MONGO_URI")
    db_name = os.getenv("DB_NAME")
    collection_name = os.getenv("COLLECTION_NAME")

    if not mongo_uri or not db_name or not collection_name:
        return None

    try:
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        collection = client[db_name][collection_name]
        return collection
    except PyMongoError as exc:
        print(f"Mongo unavailable, skipping dedupe: {exc}")
        mongo_disabled = True
        client = None
        collection = None
        return None


def get_producer():
    global producer

    if producer is not None:
        return producer

    try:
        producer = KafkaProducer(
            bootstrap_servers="localhost:9092",
            value_serializer=lambda v: json.dumps(v).encode("utf-8")
        )
    except NoBrokersAvailable as exc:
        print(f"Kafka unavailable, skipping enqueue: {exc}")
        producer = None

    return producer

    


def push_job(link):
    queue = get_producer()
    if queue is None:
        return

    queue.send("vnexpress-articles", value={"link": link})
    

def crawl_vnexpress():
    global mongo_disabled, collection

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
            dedupe_collection = get_collection()
            if dedupe_collection is not None:
                try:
                    if dedupe_collection.find_one({"link": link}):
                        print(f"Already crawled: {link}")
                        continue
                except PyMongoError as exc:
                    print(f"Mongo query failed, continuing without dedupe: {exc}")
                    mongo_disabled = True
                    collection = None
            print(f"Crawling article: {link}")
            
            push_job(link)
        

        browser.close()

if __name__ == "__main__":
    crawl_vnexpress()
