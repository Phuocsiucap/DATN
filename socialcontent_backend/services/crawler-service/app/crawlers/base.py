from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote_plus

import httpx

class BaseCrawler:
    name = "base-crawler"
    version = "1.0.0"
    content_type = "ARTICLE"

    def checksum(self, payload: dict[str, Any]) -> str:
        return hashlib.sha256(str(payload).encode("utf-8")).hexdigest()

    def build_search_url(self, keywords: list[str]) -> str:
        query = quote_plus(" ".join(keywords))
        return f"https://www.google.com/search?q={query}"

    def resolve_url(self, source_url: str | None, keywords: list[str]) -> str:
        if source_url:
            return source_url
        if not keywords:
            raise ValueError("Crawler task requires source_url or keywords")
        return self.build_search_url(keywords)

    def parse_response(self, url: str, body: str) -> dict[str, Any]:
        title_match = re.search(r"<title[^>]*>(.*?)</title>", body, flags=re.IGNORECASE | re.DOTALL)
        title = self._html_to_text(title_match.group(1)) if title_match else url
        cleaned = re.sub(r"<script.*?</script>", " ", body, flags=re.IGNORECASE | re.DOTALL)
        cleaned = re.sub(r"<style.*?</style>", " ", cleaned, flags=re.IGNORECASE | re.DOTALL)
        text = self._html_to_text(cleaned)
        return {"title": title, "description": "", "author": "", "url": url, "text": text[:20000]}

    def _html_to_text(self, value: str) -> str:
        text = re.sub(r"<script.*?</script>", " ", value, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<style.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        text = (
            text.replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            .replace("&#39;", "'")
        )
        return " ".join(text.split()).strip()

    def fetch(self, *, job_id: str, task_id: str, source_type: str, source_url: str | None, keywords: list[str], configuration: dict[str, Any]) -> dict[str, Any]:
        url = self.resolve_url(source_url, keywords)
        timeout = float(configuration.get("timeout_seconds", 20))
        headers = {"User-Agent": configuration.get("user_agent", "SocialContentCrawler/1.0")}
        started = datetime.now(timezone.utc)
        with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
            response = client.get(url)
        parsed = self.parse_response(str(response.url), response.text)
        raw = {
            "title": parsed["title"],
            "description": parsed["description"],
            "author": parsed["author"],
            "url": parsed["url"],
            "text": parsed["text"],
        }
        return {
            "job_id": job_id,
            "task_id": task_id,
            "source_type": source_type,
            "source_external_id": hashlib.sha256(raw["url"].encode("utf-8")).hexdigest(),
            "source_url": raw["url"],
            "content_type": self.content_type,
            "fetched_at": started.isoformat(),
            "http": {
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "response_time_ms": int(response.elapsed.total_seconds() * 1000),
            },
            "raw": {"html": response.text, "json": raw, "text": raw["text"]},
            "media": [],
            "crawler": {"name": self.name, "version": self.version},
            "checksum": self.checksum(raw),
            "status": "RAW",
        }

    def fetch_many(
        self,
        *,
        job_id: str,
        task_id: str,
        source_type: str,
        source_url: str | None,
        keywords: list[str],
        configuration: dict[str, Any],
    ) -> list[dict[str, Any]]:
        return [
            self.fetch(
                job_id=job_id,
                task_id=task_id,
                source_type=source_type,
                source_url=source_url,
                keywords=keywords,
                configuration=configuration,
            )
        ]
