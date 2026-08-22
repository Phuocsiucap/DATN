from __future__ import annotations

import hashlib
import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote_plus

import httpx

from app.crawler.crawlers.base import BaseCrawler


class VNExpressCrawler(BaseCrawler):
    name = "vnexpress-crawler"
    content_type = "ARTICLE"
    latest_rss_url = "https://vnexpress.net/rss/tin-moi-nhat.rss"
    homepage_url = "https://vnexpress.net/"
    blocked_image_names = {"nguonuutien.jpg"}

    def __init__(self) -> None:
        self.last_errors: list[dict[str, Any]] = []

    def build_search_url(self, keywords: list[str]) -> str:
        return f"https://timkiem.vnexpress.net/?q={quote_plus(' '.join(keywords))}"

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
        limit = self._limit(configuration)
        exclude_keywords = self._terms(configuration.get("exclude_keywords"))
        topics = self._terms(keywords)
        timeout = float(configuration.get("timeout_seconds", 20))
        headers = self._headers(configuration)

        self.last_errors = []
        with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
            links = self.discover_links(client, source_url=source_url, keywords=topics, limit=max(limit * 5, limit))
            seen: set[str] = set()
            documents: list[dict[str, Any]] = []
            for link in links:
                if not link or link in seen:
                    continue
                seen.add(link)
                if len(documents) >= limit:
                    break
                try:
                    article = self.fetch_article(client, link)
                except Exception as exc:
                    self.last_errors.append({"url": link, "stage": "FETCH_ARTICLE", "error": str(exc)})
                    continue
                if not self.matches_terms(article, topics):
                    continue
                if exclude_keywords and self.matches_terms(article, exclude_keywords):
                    continue
                documents.append(self.to_raw_document(job_id, task_id, source_type, article))
            return documents

    def discover_links(self, client: httpx.Client, *, source_url: str | None, keywords: list[str], limit: int) -> list[str]:
        if source_url and self._looks_like_article(source_url):
            return [source_url]

        discovery_urls = []
        if source_url:
            discovery_urls.append(source_url)
        if keywords:
            discovery_urls.append(self.build_search_url(keywords))
        discovery_urls.extend([self.latest_rss_url, self.homepage_url])

        links: list[str] = []
        for url in discovery_urls:
            if len(links) >= limit:
                break
            try:
                response = client.get(url)
                response.raise_for_status()
            except Exception:
                continue
            if url.endswith(".rss") or "rss" in response.headers.get("content-type", ""):
                links.extend(self._parse_rss_links(response.text))
            else:
                links.extend(self._parse_page_links(response.text))
        return self._dedupe_links(links)[:limit]

    def fetch_article(self, client: httpx.Client, url: str) -> dict[str, Any]:
        response = client.get(url)
        response.raise_for_status()
        body = response.text
        title = self._first_match(body, [r"<h1[^>]*class=[\"'][^\"']*title-detail[^\"']*[\"'][^>]*>(.*?)</h1>", r"<title[^>]*>(.*?)</title>"])
        content = self._article_paragraphs(body)
        images = self._image_urls(body)
        videos = self._video_urls(body)
        return {
            "link": str(response.url),
            "title": self._html_to_text(title) if title else str(response.url),
            "description": self._html_to_text(self._meta_content(body, "description") or ""),
            "author": self._html_to_text(self._first_match(body, [r"<p[^>]*class=[\"'][^\"']*author[^\"']*[\"'][^>]*>(.*?)</p>"]) or ""),
            "published_at": self._published_at(body),
            "category": self._category(body),
            "tags": self._tags(body),
            "content": content,
            "images": images,
            "videos": videos,
            "crawled_at": datetime.now(timezone.utc).isoformat(),
            "http": {
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "response_time_ms": int(response.elapsed.total_seconds() * 1000) if response.elapsed else None,
            },
            "html": body,
            "status": "crawled",
        }

    def to_raw_document(self, job_id: str, task_id: str, source_type: str, article: dict[str, Any]) -> dict[str, Any]:
        content_text = " ".join(article.get("content") or [])
        raw = {
            "title": article.get("title"),
            "description": article.get("description") or "",
            "author": article.get("author") or "",
            "published_at": article.get("published_at"),
            "category": article.get("category"),
            "tags": article.get("tags") or [],
            "url": article.get("link"),
            "text": content_text,
            "images": article.get("images") or [],
            "videos": article.get("videos") or [],
        }
        media = [{"media_type": "IMAGE", "source_url": url} for url in raw["images"]]
        media.extend({"media_type": "VIDEO", "source_url": url} for url in raw["videos"])
        return {
            "job_id": job_id,
            "task_id": task_id,
            "source_type": source_type,
            "source_external_id": self._external_id(raw["url"]),
            "source_url": raw["url"],
            "content_type": self.content_type,
            "fetched_at": article.get("crawled_at"),
            "http": article.get("http") or {"status_code": 200, "headers": {}, "response_time_ms": None},
            "raw": {"html": article.get("html"), "json": raw, "text": content_text},
            "media": media,
            "crawler": {"name": self.name, "version": self.version},
            "checksum": self.checksum(raw),
            "status": "RAW",
        }

    def matches_terms(self, article: dict[str, Any], terms: list[str]) -> bool:
        if not terms:
            return True
        content = article.get("content") or []
        text = f"{article.get('title', '')} {' '.join(content)}".lower()
        return any(term.lower() in text for term in terms)

    def _parse_rss_links(self, body: str) -> list[str]:
        try:
            root = ET.fromstring(body)
        except ET.ParseError:
            candidates = re.findall(r"<link>\s*(https?://[^<]+)\s*</link>", body, flags=re.IGNORECASE)
            return [link for link in candidates if self._looks_like_article(link)]
        links = []
        for link in root.findall(".//link"):
            if link.text and link.text.startswith("http"):
                clean_link = link.text.strip()
                if self._looks_like_article(clean_link):
                    links.append(clean_link)
        return links

    def _parse_page_links(self, body: str) -> list[str]:
        candidates = re.findall(r"<a[^>]+href=[\"'](https?://vnexpress\.net/[^\"']+)[\"']", body, flags=re.IGNORECASE)
        return [html.unescape(link).split("#")[0] for link in candidates if self._looks_like_article(link)]

    def _article_paragraphs(self, body: str) -> list[str]:
        article_match = re.search(r'<article[^>]*class=["\'][^"\']*fck_detail[^"\']*["\'][^>]*>(.*?)</article>', body, flags=re.IGNORECASE | re.DOTALL)
        scope = article_match.group(1) if article_match else body

        # Grab all <p> tags inside the article body, covering Normal, Intermezzo, ArticleIntro, and plain <p>
        paragraphs_html = re.findall(r'<p[^>]*>(.*?)</p>', scope, flags=re.IGNORECASE | re.DOTALL)

        result = []
        seen = set()
        for raw_p in paragraphs_html:
            # Skip nav/ads: paragraphs inside certain meta containers
            if re.search(r'class=["\'][^"\']*(?:breadcrumb|tag_|author|copyright|ads|social|comment)[^"\']*["\']', raw_p, re.IGNORECASE):
                continue
            text = self._html_to_text(raw_p)
            if text and text not in seen:
                seen.add(text)
                result.append(text)
        return result

    def _image_urls(self, body: str) -> list[str]:
        urls = []
        for match in re.finditer(r"<img[^>]+>", body, flags=re.IGNORECASE):
            tag = match.group(0)
            src = self._attr(tag, "data-src") or self._attr(tag, "src")
            if src and not src.startswith("data:") and "svg" not in src and not self._is_blocked_image(src):
                urls.append(html.unescape(src))
        return self._dedupe_links(urls)

    def _is_blocked_image(self, url: str) -> bool:
        clean_url = html.unescape(url).split("?")[0].split("#")[0].lower()
        return any(clean_url.endswith(f"/{name}") or clean_url.endswith(name) for name in self.blocked_image_names)

    def _video_urls(self, body: str) -> list[str]:
        urls = []
        for pattern in [
            r'https?:\\?/\\?/[^"\'\s<>]+?(?:\.m3u8|\.mp4)[^"\'\s<>]*',
            r"data-video-src=[\"']([^\"']+)[\"']",
            r"data-file=[\"']([^\"']+)[\"']",
            r"<iframe[^>]+src=[\"']([^\"']+)[\"']",
        ]:
            urls.extend(re.findall(pattern, body, flags=re.IGNORECASE))
        return self._dedupe_links([html.unescape(url).replace("\\/", "/") for url in urls])

    def _first_match(self, body: str, patterns: list[str]) -> str | None:
        for pattern in patterns:
            match = re.search(pattern, body, flags=re.IGNORECASE | re.DOTALL)
            if match:
                return match.group(1)
        return None

    def _meta_content(self, body: str, name: str) -> str | None:
        patterns = [
            rf"<meta[^>]+name=[\"']{re.escape(name)}[\"'][^>]+content=[\"']([^\"']+)[\"']",
            rf"<meta[^>]+property=[\"']og:{re.escape(name)}[\"'][^>]+content=[\"']([^\"']+)[\"']",
            rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+name=[\"']{re.escape(name)}[\"']",
            rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']og:{re.escape(name)}[\"']",
        ]
        return self._first_match(body, patterns)

    def _published_at(self, body: str) -> str | None:
        return self._first_match(
            body,
            [
                r"<meta[^>]+property=[\"']article:published_time[\"'][^>]+content=[\"']([^\"']+)[\"']",
                r"<span[^>]*class=[\"'][^\"']*date[^\"']*[\"'][^>]*>(.*?)</span>",
                r"<p[^>]*class=[\"'][^\"']*date[^\"']*[\"'][^>]*>(.*?)</p>",
            ],
        )

    def _category(self, body: str) -> str | None:
        category = self._meta_content(body, "section") or self._first_match(
            body,
            [
                r"<ul[^>]*class=[\"'][^\"']*breadcrumb[^\"']*[\"'][^>]*>.*?<a[^>]*>(.*?)</a>",
                r"<a[^>]*data-medium=[\"']Menu-[^\"']*[\"'][^>]*>(.*?)</a>",
            ],
        )
        return self._html_to_text(category) if category else None

    def _tags(self, body: str) -> list[str]:
        keywords = self._meta_content(body, "keywords")
        if keywords:
            return [item.strip() for item in keywords.split(",") if item.strip()]
        tag_matches = re.findall(r"<a[^>]+class=[\"'][^\"']*tag_item[^\"']*[\"'][^>]*>(.*?)</a>", body, flags=re.IGNORECASE | re.DOTALL)
        return [self._html_to_text(tag) for tag in tag_matches if self._html_to_text(tag)]

    def _attr(self, tag: str, attr: str) -> str | None:
        match = re.search(rf"{attr}=[\"']([^\"']+)[\"']", tag, flags=re.IGNORECASE)
        return match.group(1) if match else None

    def _looks_like_article(self, url: str) -> bool:
        return bool(re.search(r"https?://vnexpress\.net/.+-\d+\.html", url))

    def _dedupe_links(self, links: list[str]) -> list[str]:
        deduped = []
        seen = set()
        for link in links:
            normalized = link.split("#")[0].strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                deduped.append(normalized)
        return deduped

    def _external_id(self, url: str | None) -> str:
        if not url:
            return hashlib.sha256(str(datetime.now(timezone.utc)).encode("utf-8")).hexdigest()
        match = re.search(r"-(\d+)\.html", url)
        return match.group(1) if match else hashlib.sha256(url.encode("utf-8")).hexdigest()

    def _limit(self, configuration: dict[str, Any]) -> int:
        value = configuration.get("max_items", configuration.get("limit", 10))
        return max(1, min(int(value or 10), 30))

    def _terms(self, value: Any) -> list[str]:
        if isinstance(value, str):
            return [part.strip().lower() for part in value.split(",") if part.strip()]
        if isinstance(value, list):
            return [str(part).strip().lower() for part in value if str(part).strip()]
        return []

    def _headers(self, configuration: dict[str, Any]) -> dict[str, str]:
        return {
            "Referer": "https://vnexpress.net/",
            "User-Agent": configuration.get(
                "user_agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            ),
        }
