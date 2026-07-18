from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    kafka_bootstrap_servers: str = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    crawl_requested_topic: str = os.getenv("VNEXPRESS_CRAWL_REQUESTED_TOPIC", "vnexpress.crawl.requested")
    article_crawled_topic: str = os.getenv("VNEXPRESS_ARTICLE_CRAWLED_TOPIC", "vnexpress.article.crawled")
    crawl_completed_topic: str = os.getenv("VNEXPRESS_CRAWL_COMPLETED_TOPIC", "vnexpress.crawl.completed")
    consumer_group: str = os.getenv("VNEXPRESS_CONSUMER_GROUP", "vnexpress-service")


settings = Settings()
