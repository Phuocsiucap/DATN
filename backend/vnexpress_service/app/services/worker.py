from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor

from backend.vnexpress_service.app.core.config import settings
from backend.vnexpress_service.app.core.kafka import make_consumer, make_producer
from backend.vnexpress_service.app.schemas.events import ArticleCrawled, CrawlCompleted, CrawlRequested
from backend.vnexpress_service.app.services.crawler import crawl_for_request


executor = ThreadPoolExecutor(max_workers=2)


def process_message(payload: dict) -> None:
    request = CrawlRequested(**payload)
    producer = make_producer()
    articles, skipped = crawl_for_request(request)

    for article in articles:
        event = ArticleCrawled(request_id=request.request_id, user_id=request.user_id, article=article)
        producer.send(settings.article_crawled_topic, value=event.model_dump(mode="json"), key=request.user_id)

    completed = CrawlCompleted(
        request_id=request.request_id,
        user_id=request.user_id,
        crawled=len(articles),
        skipped=skipped,
    )
    producer.send(settings.crawl_completed_topic, value=completed.model_dump(mode="json"), key=request.user_id)
    producer.flush()


def consume_forever() -> None:
    consumer = make_consumer()
    for message in consumer:
        try:
            process_message(message.value)
        except Exception as exc:
            print(f"VNExpress worker error: {exc}")


async def start_worker() -> None:
    loop = asyncio.get_running_loop()
    loop.run_in_executor(executor, consume_forever)
