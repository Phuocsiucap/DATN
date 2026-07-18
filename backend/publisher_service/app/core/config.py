from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    kafka_bootstrap_servers: str = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    publish_requested_topic: str = os.getenv("PUBLISH_REQUESTED_TOPIC", "publisher.publish.requested")
    publish_completed_topic: str = os.getenv("PUBLISH_COMPLETED_TOPIC", "publisher.publish.completed")
    consumer_group: str = os.getenv("PUBLISHER_CONSUMER_GROUP", "publisher-service")
    user_service_url: str = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    fb_page_id: str | None = os.getenv("FB_PAGE_ID")
    fb_access_token: str | None = os.getenv("FB_ACCESS_TOKEN")


settings = Settings()
