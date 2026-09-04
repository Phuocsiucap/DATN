from __future__ import annotations

import hashlib
import html
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

from app.crawler.crawlers.base import BaseCrawler
from app.normalization.cleaners.text import clean_text, normalize_title
from app.normalization.validators.quality import score_quality, status_from_score
from common.core.vnexpress_rss import resolve_vnexpress_rss_feeds


class VNExpressCrawler(BaseCrawler):
    name = "vnexpress-crawler"
    content_type = "ARTICLE"
    outputs_normalized = True
    latest_rss_url = "https://vnexpress.net/rss/tin-moi-nhat.rss"
    homepage_url = "https://vnexpress.net/"
    blocked_image_names = {"nguonuutien.jpg"}
    vietnam_timezone = timezone(timedelta(hours=7))

    def __init__(self) -> None:
        self.last_errors: list[dict[str, Any]] = []
        self.last_skipped_existing: list[str] = []

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
        excluded_urls = {
            self._source_url_key(value)
            for value in configuration.get("excluded_source_urls") or []
            if self._source_url_key(value)
        }
        excluded_external_ids = {
            str(value).strip().casefold()
            for value in configuration.get("excluded_source_external_ids") or []
            if str(value).strip()
        }

        self.last_errors = []
        self.last_skipped_existing = []
        with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
            links = self.discover_links(client, source_url=source_url, limit=max(limit * 5, limit), configuration=configuration)
            seen: set[str] = set()
            documents: list[dict[str, Any]] = []
            for link in links:
                if not link or link in seen:
                    continue
                seen.add(link)
                if self._is_excluded_source(link, excluded_urls, excluded_external_ids):
                    self.last_skipped_existing.append(link)
                    continue
                if len(documents) >= limit:
                    break
                try:
                    article = self.fetch_article(client, link)
                except Exception as exc:
                    self.last_errors.append({"url": link, "stage": "FETCH_ARTICLE", "error": str(exc)})
                    continue
                article_url = str(article.get("link") or link)
                if self._is_excluded_source(article_url, excluded_urls, excluded_external_ids):
                    self.last_skipped_existing.append(article_url)
                    continue
                if not self.matches_terms(article, topics):
                    continue
                if exclude_keywords and self.matches_terms(article, exclude_keywords):
                    continue
                documents.append(self.to_processed_document(job_id, source_type, article))
            return documents

    def discover_links(self, client: httpx.Client, *, source_url: str | None, limit: int, configuration: dict[str, Any] | None = None) -> list[str]:
        if source_url and self._looks_like_article(source_url):
            return [source_url]

        rss_urls = []
        rss_urls.extend(feed["url"] for feed in resolve_vnexpress_rss_feeds(configuration))
        if source_url and self._looks_like_rss(source_url):
            rss_urls.append(source_url)
        category_rss_url = self._rss_url_from_source_url(source_url)
        if category_rss_url:
            rss_urls.append(category_rss_url)
        if not rss_urls:
            rss_urls.append(self.latest_rss_url)

        links: list[str] = []
        for url in self._dedupe_links(rss_urls):
            if len(links) >= limit:
                break
            try:
                response = client.get(url)
                response.raise_for_status()
            except Exception as exc:
                self.last_errors.append({"url": url, "stage": "DISCOVER_RSS", "error": str(exc)})
                continue
            links.extend(self._parse_rss_links(response.text))
        return self._dedupe_links(links)[:limit]

    def fetch_article(self, client: httpx.Client, url: str) -> dict[str, Any]:
        response = client.get(url)
        response.raise_for_status()
        body = response.text
        parsed = self.parse_article_html(body, str(response.url))
        parsed["crawled_at"] = datetime.now(timezone.utc).isoformat()
        parsed["http"] = {
            "status_code": response.status_code,
            "headers": dict(response.headers),
            "response_time_ms": int(response.elapsed.total_seconds() * 1000) if response.elapsed else None,
        }
        parsed["html"] = body
        parsed["status"] = "crawled"
        return parsed

    def parse_article_html(self, body: str, url: str) -> dict[str, Any]:
        title = self._first_match(
            body,
            [
                r"<h1[^>]*class=[\"'][^\"']*title-detail[^\"']*[\"'][^>]*>(.*?)</h1>",
                r"<title[^>]*>(.*?)</title>",
            ],
        )
        lead = self._first_match(body, [r"<p[^>]*class=[\"'][^\"']*description[^\"']*[\"'][^>]*>(.*?)</p>"])
        content = self._article_paragraphs(body)
        json_ld_videos = self._json_ld_videos(body)
        videos = self._normalize_videos([*json_ld_videos, *self._dom_videos(body), *self._regex_videos(body)])
        video_thumbnail_fps = {
            self._image_fingerprint(video.get("thumbnail") or "")
            for video in videos
            if video.get("thumbnail")
        }
        images = [
            image
            for image in self._dedupe_dicts([*self._metadata_images(body), *self._image_objects(body, url)], "src")
            if self._image_fingerprint(image.get("src") or "") not in video_thumbnail_fps
        ]

        return {
            "link": url,
            "title": self._html_to_text(title) if title else url,
            "description": self._html_to_text(lead or self._meta_content(body, "description") or ""),
            "author": self._html_to_text(
                self._first_match(body, [r"<p[^>]*class=[\"'][^\"']*author[^\"']*[\"'][^>]*>(.*?)</p>"]) or ""
            ),
            "published_at": self._published_at(body),
            "category": self._category(body),
            "tags": self._tags(body),
            "article_id": self._meta_content(body, "tt_article_id") or self._external_id(url),
            "category_id": self._meta_content(body, "tt_category_id"),
            "site_id": self._meta_content(body, "tt_site_id"),
            "content": content,
            "images": images,
            "videos": videos,
        }

    def to_processed_document(self, job_id: str, source_type: str, article: dict[str, Any]) -> dict[str, Any]:
        content_text = "\n\n".join(article.get("content") or [])
        media = self._media_from_article(article)
        normalized = {
            "title": clean_text(article.get("title")),
            "normalized_title": normalize_title(article.get("title")),
            "description": clean_text(article.get("description")),
            "author": clean_text(article.get("author")),
            "published_at": article.get("published_at"),
            "language": "vi",
            "content": clean_text(content_text, preserve_newlines=True),
            "transcript": "",
            "media": media,
            "source_url": article.get("link"),
            "source_external_id": self._external_id(article.get("link")),
            "content_type": self.content_type,
            "duration_seconds": None,
            "thumbnail_url": self._primary_thumbnail(article),
            "embed_url": self._primary_embed_url(article),
            "review_count": None,
            "danmaku_count": None,
            "metadata_only": False,
            "aid": None,
            "bvid": None,
            "cid": None,
            "season_id": None,
            "season_title": None,
            "series_title": None,
            "series_source": None,
            "episode_count": None,
            "episodes": [],
            "related": [],
            "category": article.get("category"),
            "tags": article.get("tags") or [],
            "article_id": article.get("article_id"),
            "category_id": article.get("category_id"),
            "site_id": article.get("site_id"),
            "images": article.get("images") or [],
            "videos": article.get("videos") or [],
        }
        body_for_hash = " ".join([normalized["normalized_title"], normalized["content"], normalized["transcript"]])
        normalized["content_hash"] = hashlib.sha256(body_for_hash.encode("utf-8")).hexdigest()
        normalized["title_hash"] = hashlib.sha256(normalized["normalized_title"].encode("utf-8")).hexdigest()
        normalized["transcript_hash"] = None
        score, missing, warnings = score_quality(normalized)

        return {
            "job_id": job_id,
            "source_type": source_type,
            "normalizer_version": "vnexpress-direct-1.0.0",
            "normalized": normalized,
            "quality": {
                "is_valid": score >= 60,
                "score": score,
                "status": status_from_score(score),
                "missing_fields": missing,
                "warnings": warnings,
            },
            "crawler": {
                "name": self.name,
                "version": self.version,
                "direct_normalization": True,
                "http": article.get("http") or {"status_code": 200, "headers": {}, "response_time_ms": None},
            },
            "checksum": self.checksum(normalized),
            "processed_at": datetime.now(timezone.utc).isoformat(),
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

    def _article_paragraphs(self, body: str) -> list[str]:
        scope = self._article_scope(body)
        # Capture the full <p ...>...</p> to inspect tag attributes (e.g. class="description")
        paragraphs_full = re.findall(r"(<p[^>]*>)(.*?)</p>", scope, flags=re.IGNORECASE | re.DOTALL)

        result = []
        seen = set()
        for p_tag, raw_p in paragraphs_full:
            # Skip structural/UI elements by inner content class
            if re.search(r'class=["\'][^"\']*(?:breadcrumb|tag_|author|copyright|ads|social|comment)[^"\']*["\']', raw_p, re.IGNORECASE):
                continue
            # Skip the description/sapo paragraph — it is already stored separately
            if re.search(r'class=["\'][^"\']*\bdescription\b[^"\']*["\']', p_tag, re.IGNORECASE):
                continue
            text = self._html_to_text(raw_p)
            if not text or text in seen:
                continue
            # Skip paragraphs that are purely related-article links (>> prefix)
            if re.match(r"^>{1,2}\s", text) or text.startswith(">>"):
                continue
            # Skip "Xem thêm" / "xem thêm" navigation CTA paragraphs
            if re.match(r"^>{0,2}\s*[Xx]em thêm\b", text):
                continue
            # Skip very short right-aligned paragraphs (byline/author artifacts)
            if len(text) <= 5 and re.search(r'text-align\s*:\s*right', p_tag, re.IGNORECASE):
                continue
            seen.add(text)
            result.append(text)
        return result

    def _image_objects(self, body: str, base_url: str) -> list[dict[str, str]]:
        images: list[dict[str, str]] = []
        scope = self._article_scope(body)
        for attrs, container in self._image_candidate_attrs(scope):
            if re.search(r"box_embed_video_parent|\bdata-vid=", container, flags=re.IGNORECASE):
                continue

            for src in self._image_urls_from_attrs(attrs):
                if self._is_blocked_image(src):
                    continue
                images.append(
                    {
                        "src": urljoin(base_url, src),
                        "alt": self._html_to_text(self._attr(attrs, "alt") or ""),
                        "caption": self._image_caption(attrs, container),
                    }
                )
        return self._dedupe_dicts(images, "src")

    def _image_candidate_attrs(self, scope: str) -> list[tuple[str, str]]:
        candidates: list[tuple[str, str]] = []
        container_patterns = [
            r"<div\b[^>]*class=[\"'][^\"']*item_slide_show[^\"']*[\"'][^>]*>.*?(?=<div\b[^>]*class=[\"'][^\"']*item_slide_show|\Z)",
            r"<div\b[^>]*class=[\"'][^\"']*item_gallery_new[^\"']*[\"'][^>]*>.*?</div>",
            r"<div\b[^>]+data-component-type=[\"']image-flip[\"'][^>]*>.*?</div>",
            r"<figure\b[^>]*>.*?</figure>",
        ]
        for pattern in container_patterns:
            for container_match in re.finditer(pattern, scope, flags=re.IGNORECASE | re.DOTALL):
                container = container_match.group(0)
                for tag in re.findall(r"<(?:img|source|div)\b([^>]*)>", container, flags=re.IGNORECASE | re.DOTALL):
                    if self._image_urls_from_attrs(tag):
                        candidates.append((tag, container))

        for tag_match in re.finditer(r"<img\b([^>]*)>", scope, flags=re.IGNORECASE | re.DOTALL):
            attrs = tag_match.group(1)
            if self._image_urls_from_attrs(attrs):
                candidates.append((attrs, tag_match.group(0)))
        return candidates

    def _image_urls_from_attrs(self, attrs: str) -> list[str]:
        urls = []
        for name in [
            "data-component-value1",
            "data-component-value2",
            "data-component-front",
            "data-component-back",
            "data-desktop-src",
            "data-mobile-src",
            "data-src",
            "data-original",
            "src",
        ]:
            src = self._clean_url(self._attr(attrs, name))
            if self._looks_like_image_url(src):
                urls.append(src)

        for name in ["data-srcset", "srcset"]:
            for src in self._srcset_urls(self._attr(attrs, name) or ""):
                if self._looks_like_image_url(src):
                    urls.append(src)
        return self._dedupe_urls(urls)

    def _srcset_urls(self, value: str) -> list[str]:
        urls = []
        for item in html.unescape(value or "").split(","):
            src = item.strip().split(" ")[0]
            if src:
                urls.append(self._clean_url(src))
        return urls

    def _looks_like_image_url(self, src: str) -> bool:
        if not src or src.startswith("data:"):
            return False
        return bool(re.search(r"\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$", src, flags=re.IGNORECASE))

    def _image_caption(self, attrs: str, container: str) -> str:
        caption = (
            self._attr(attrs, "data-caption")
            or self._attr(attrs, "data-component-caption")
            or self._first_match(container, [r"<figcaption\b[^>]*>(.*?)</figcaption>"])
            or self._first_match(container, [r"<div[^>]+class=[\"'][^\"']*(?:desc_cation|caption-gallery)[^\"']*[\"'][^>]*>(.*?)</div>"])
            or ""
        )
        return self._html_to_text(self._decode_jsonish_string(caption).strip("\"'"))

    def _metadata_images(self, body: str) -> list[dict[str, str]]:
        images = []
        og_image = self._meta_content(body, "image")
        if og_image:
            images.append(
                {
                    "src": self._clean_url(og_image),
                    "alt": self._html_to_text(self._meta_content(body, "image:alt") or ""),
                    "caption": self._html_to_text(self._meta_content(body, "image:alt") or ""),
                }
            )
        images.extend(self._json_ld_images(body))
        return [image for image in images if image.get("src") and ".svg" not in image.get("src", "").lower()]

    def _json_ld_images(self, body: str) -> list[dict[str, str]]:
        images: list[dict[str, str]] = []
        scripts = re.findall(
            r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
            body,
            flags=re.IGNORECASE | re.DOTALL,
        )
        for raw in scripts:
            text = html.unescape(raw).strip()
            if not text:
                continue
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                continue
            images.extend(self._collect_image_objects(parsed))
        return images

    def _collect_image_objects(self, node: Any) -> list[dict[str, str]]:
        if isinstance(node, list):
            found: list[dict[str, str]] = []
            for item in node:
                found.extend(self._collect_image_objects(item))
            return found
        if not isinstance(node, dict):
            return []

        found = []
        node_type = node.get("@type")
        is_image = str(node_type or "").lower() == "imageobject"
        url = self._clean_url(node.get("url"))
        if is_image and url:
            caption = self._html_to_text(str(node.get("caption") or ""))
            if not self._is_blocked_image(url):
                found.append({"src": url, "alt": caption, "caption": caption})

        for value in node.values():
            if isinstance(value, (dict, list)):
                found.extend(self._collect_image_objects(value))
        return found

    def _json_ld_videos(self, body: str) -> list[dict[str, Any]]:
        videos: list[dict[str, Any]] = []
        scripts = re.findall(
            r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
            body,
            flags=re.IGNORECASE | re.DOTALL,
        )
        for raw in scripts:
            text = html.unescape(raw).strip()
            if not text:
                continue
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                continue
            for video in self._collect_video_objects(parsed):
                videos.append(
                    {
                        "source": "json-ld",
                        "name": video.get("name") or "",
                        "description": video.get("description") or "",
                        "thumbnailUrl": self._clean_url(self._first_value(video.get("thumbnailUrl"))),
                        "uploadDate": video.get("uploadDate") or "",
                        "duration": video.get("duration") or "",
                        "contentUrl": self._clean_url(self._first_value(video.get("contentUrl"))),
                        "embedUrl": self._clean_url(self._first_value(video.get("embedUrl"))),
                    }
                )
        return videos

    def _collect_video_objects(self, node: Any) -> list[dict[str, Any]]:
        if isinstance(node, list):
            found: list[dict[str, Any]] = []
            for item in node:
                found.extend(self._collect_video_objects(item))
            return found
        if not isinstance(node, dict):
            return []

        found = []
        node_type = node.get("@type")
        if isinstance(node_type, list):
            is_video = any(str(item).lower() == "videoobject" for item in node_type)
        else:
            is_video = str(node_type or "").lower() == "videoobject"
        if is_video:
            found.append(node)

        for value in node.values():
            if isinstance(value, (dict, list)):
                found.extend(self._collect_video_objects(value))
        return found

    def _dom_videos(self, body: str) -> list[dict[str, Any]]:
        videos: list[dict[str, Any]] = []
        scope = self._article_scope(body)

        for match in re.finditer(r"<video\b([^>]*)>(.*?)</video>", scope, flags=re.IGNORECASE | re.DOTALL):
            attrs = match.group(1)
            inner = match.group(2)
            block = scope[max(0, match.start() - 2500) : min(len(scope), match.end() + 1000)]
            src = self._clean_url(self._attr(attrs, "src") or self._attr(attrs, "data-src"))
            if src and not src.startswith("blob:"):
                videos.append(
                    {
                        "source": "video-tag",
                        "src": src,
                        "type": self._attr(attrs, "type") or "",
                        "poster": self._clean_url(
                            self._attr(attrs, "poster")
                            or self._attr(attrs, "data-poster")
                            or self._video_poster_url(block)
                        ),
                        "modes": self._attr(attrs, "data-mode") or "",
                        "maxMode": self._attr(attrs, "max-mode") or "",
                        "videoId": self._video_id(attrs, block),
                        "name": self._dom_video_title(block),
                        "duration": self._attr(attrs, "duration") or self._attr(block, "data-duration") or "",
                    }
                )
            for source_attrs in re.findall(r"<source\b([^>]*)>", inner, flags=re.IGNORECASE | re.DOTALL):
                source_src = self._clean_url(self._attr(source_attrs, "src") or self._attr(source_attrs, "data-src"))
                if source_src:
                    videos.append(
                        {
                            "source": "video-source",
                            "src": source_src,
                            "type": self._attr(source_attrs, "type") or "",
                            "videoId": self._video_id(attrs, block),
                            "poster": self._clean_url(self._video_poster_url(block)),
                            "name": self._dom_video_title(block),
                        }
                    )

        for match in re.finditer(r"<iframe\b([^>]*)>", scope, flags=re.IGNORECASE | re.DOTALL):
            attrs = match.group(1)
            src = self._clean_url(self._attr(attrs, "src") or self._attr(attrs, "data-src"))
            if src:
                videos.append(
                    {
                        "source": "iframe",
                        "embedUrl": src,
                        "title": self._attr(attrs, "title") or self._nearby_video_title(scope, match.start()),
                    }
                )

        for tag in re.findall(r"<[^>]+>", scope, flags=re.IGNORECASE | re.DOTALL):
            for name in ["data-video-src", "data-file", "data-url", "data-source", "data-src"]:
                src = self._clean_url(self._attr(tag, name))
                if src and re.search(r"\.(?:m3u8|mp4)(?:[?#].*)?$", src, flags=re.IGNORECASE):
                    videos.append({"source": f"data-attr:{name}", "src": src})

        return videos

    def _first_image_url(self, html_fragment: str) -> str:
        for tag in re.findall(r"<(?:img|source|div)\b([^>]*)>", html_fragment, flags=re.IGNORECASE | re.DOTALL):
            for src in self._image_urls_from_attrs(tag):
                if src and not self._is_blocked_image(src):
                    return src
        return ""

    def _video_poster_url(self, html_fragment: str) -> str:
        for attrs in re.findall(
            r"<img\b([^>]*class=[\"'][^\"']*thumb-above-video[^\"']*[\"'][^>]*)>",
            html_fragment,
            flags=re.IGNORECASE | re.DOTALL,
        ):
            for src in self._image_urls_from_attrs(attrs):
                if src and not self._is_blocked_image(src):
                    return src
        return self._first_image_url(html_fragment)

    def _video_id(self, attrs: str, container: str) -> str:
        for value in [self._attr(attrs, "data-vid"), self._attr(container, "data-vid"), self._attr(attrs, "id")]:
            if not value:
                continue
            match = re.search(r"(\d{3,})", value)
            if match:
                return match.group(1)
        return ""

    def _dom_video_title(self, container: str) -> str:
        title = self._first_match(
            container,
            [
                r"<div[^>]+class=[\"'][^\"']*parser_title[^\"']*[\"'][^>]*>(.*?)</div>",
                r"<p[^>]+class=[\"'][^\"']*Normal[^\"']*[\"'][^>]*>(.*?)</p>",
            ],
        )
        if not title:
            return ""
        title = re.sub(r"\bVideo:\s*.*$", "", title, flags=re.IGNORECASE | re.DOTALL)
        return self._html_to_text(title)

    def _regex_videos(self, body: str) -> list[dict[str, str]]:
        videos = []
        pattern = re.compile(r'https?:\\?/\\?/[^"\'\s<>]+?\.(?:m3u8|mp4)(?:[^"\'\s<>]*)?', flags=re.IGNORECASE)
        for match in pattern.finditer(body):
            videos.append({"source": "regex", "src": self._clean_url(match.group(0))})
        return videos

    def _normalize_videos(self, raw_videos: list[dict[str, Any]]) -> list[dict[str, Any]]:
        by_url: dict[str, dict[str, Any]] = {}
        for raw_video in raw_videos:
            video = self._normalize_video(raw_video)
            url = video.get("url")
            if not url:
                continue
            if url in by_url:
                by_url[url] = self._merge_video_data(by_url[url], video)
            else:
                by_url[url] = video
        return list(by_url.values())

    def _normalize_video(self, raw_video: dict[str, Any]) -> dict[str, Any]:
        raw_url = self._clean_url(
            raw_video.get("contentUrl")
            or raw_video.get("src")
            or raw_video.get("embedUrl")
            or raw_video.get("url")
            or ""
        )
        embed_data = self._parse_embed_video_url(raw_url)
        url = embed_data["playback_url"]
        qualities = [item.strip() for item in str(raw_video.get("modes") or "").split("|") if item.strip()]
        return {
            "url": url,
            "kind": self._detect_video_kind(url),
            "mimeType": self._detect_mime_type(url, str(raw_video.get("type") or "")),
            "embedUrl": embed_data["embed_url"] or self._clean_url(raw_video.get("embedUrl") or ""),
            "provider": embed_data["provider"],
            "title": raw_video.get("name") or raw_video.get("title") or "",
            "description": raw_video.get("description") or "",
            "thumbnail": self._clean_url(raw_video.get("thumbnailUrl") or raw_video.get("poster") or embed_data["thumbnail"]),
            "uploadDate": raw_video.get("uploadDate") or "",
            "duration": raw_video.get("duration") or "",
            "qualities": qualities,
            "maxQuality": raw_video.get("maxMode") or "",
            "videoId": raw_video.get("videoId") or "",
            "extractionSource": raw_video.get("source") or "",
        }

    def _merge_video_data(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        sources = []
        for value in [existing.get("extractionSource"), incoming.get("extractionSource")]:
            for source in str(value or "").split(","):
                source = source.strip()
                if source and source not in sources:
                    sources.append(source)
        return {
            "url": existing.get("url") or incoming.get("url"),
            "kind": existing.get("kind") or incoming.get("kind"),
            "mimeType": existing.get("mimeType") or incoming.get("mimeType"),
            "embedUrl": existing.get("embedUrl") or incoming.get("embedUrl"),
            "provider": existing.get("provider") or incoming.get("provider"),
            # DOM player captions are usually more specific than the page-level
            # JSON-LD VideoObject name, which may repeat the article headline.
            "title": incoming.get("title") or existing.get("title"),
            "description": existing.get("description") or incoming.get("description"),
            "thumbnail": existing.get("thumbnail") or incoming.get("thumbnail"),
            "uploadDate": existing.get("uploadDate") or incoming.get("uploadDate"),
            "duration": existing.get("duration") or incoming.get("duration"),
            "qualities": existing.get("qualities") or incoming.get("qualities") or [],
            "maxQuality": existing.get("maxQuality") or incoming.get("maxQuality"),
            "videoId": incoming.get("videoId") or existing.get("videoId"),
            "extractionSource": ",".join(sources),
        }

    def _parse_embed_video_url(self, raw_url: str) -> dict[str, str]:
        result = {"playback_url": raw_url, "embed_url": "", "thumbnail": "", "provider": ""}
        try:
            parsed = urlparse(raw_url)
            result["provider"] = parsed.netloc
            params = parse_qs(parsed.query)
            file_url = self._clean_url(self._first_value(params.get("file")))
            poster = self._clean_url(self._first_value(params.get("poster")))
            if file_url:
                result["playback_url"] = file_url
                result["embed_url"] = raw_url
            if poster:
                result["thumbnail"] = poster
        except Exception:
            pass
        return result

    def _media_from_article(self, article: dict[str, Any]) -> list[dict[str, Any]]:
        media: list[dict[str, Any]] = []
        for image in article.get("images") or []:
            src = image.get("src") if isinstance(image, dict) else image
            if not src:
                continue
            item = {"media_type": "IMAGE", "source_url": src}
            if isinstance(image, dict):
                item["alt"] = image.get("alt")
                item["caption"] = image.get("caption")
            media.append(item)

        for video in article.get("videos") or []:
            src = video.get("url") if isinstance(video, dict) else video
            if not src:
                continue
            item = {"media_type": "VIDEO", "source_url": src}
            if isinstance(video, dict):
                item.update(
                    {
                        "format": video.get("kind"),
                        "mime_type": video.get("mimeType"),
                        "embed_url": video.get("embedUrl"),
                        "provider": video.get("provider"),
                        "thumbnail_url": video.get("thumbnail"),
                        "title": video.get("title"),
                        "description": video.get("description"),
                        "upload_date": video.get("uploadDate"),
                        "duration": video.get("duration"),
                        "qualities": video.get("qualities") if isinstance(video.get("qualities"), list) else [],
                        "max_quality": video.get("maxQuality"),
                        "video_id": video.get("videoId"),
                        "extraction_source": video.get("extractionSource"),
                    }
                )
            media.append(item)
        return media

    def _primary_thumbnail(self, article: dict[str, Any]) -> str | None:
        for video in article.get("videos") or []:
            if isinstance(video, dict) and video.get("thumbnail"):
                return video["thumbnail"]
        for image in article.get("images") or []:
            if isinstance(image, dict) and image.get("src"):
                return image["src"]
            if isinstance(image, str) and image:
                return image
        return None

    def _primary_embed_url(self, article: dict[str, Any]) -> str | None:
        for video in article.get("videos") or []:
            if isinstance(video, dict) and video.get("embedUrl"):
                return video["embedUrl"]
        return None

    def _article_scope(self, body: str) -> str:
        article_match = re.search(
            r'<(?P<tag>article|section|div)[^>]*class=["\'][^"\']*fck_detail[^"\']*["\'][^>]*>(.*?)</(?P=tag)>',
            body,
            flags=re.IGNORECASE | re.DOTALL,
        )
        return article_match.group(2) if article_match else body

    def _nearby_video_title(self, scope: str, offset: int) -> str:
        before = scope[:offset]
        paragraphs = re.findall(r"<p\b[^>]*>(.*?)</p>", before, flags=re.IGNORECASE | re.DOTALL)
        for paragraph in reversed(paragraphs[-5:]):
            if re.search(r"<strong\b", paragraph, flags=re.IGNORECASE):
                title = self._html_to_text(paragraph)
                if title:
                    return title
        return ""

    def _detect_video_kind(self, url: str) -> str:
        if re.search(r"\.m3u8(?:[?#]|$)", url, flags=re.IGNORECASE):
            return "hls"
        if re.search(r"\.mp4(?:[?#]|$)", url, flags=re.IGNORECASE):
            return "mp4"
        return "embed"

    def _detect_mime_type(self, url: str, fallback: str = "") -> str:
        if fallback:
            return fallback
        if re.search(r"\.m3u8(?:[?#]|$)", url, flags=re.IGNORECASE):
            return "application/x-mpegURL"
        if re.search(r"\.mp4(?:[?#]|$)", url, flags=re.IGNORECASE):
            return "video/mp4"
        return ""

    def _first_match(self, body: str, patterns: list[str]) -> str | None:
        for pattern in patterns:
            match = re.search(pattern, body, flags=re.IGNORECASE | re.DOTALL)
            if match:
                return match.group(1)
        return None

    def _meta_content(self, body: str, name: str) -> str | None:
        for attrs in re.findall(r"<meta\b([^>]*)>", body, flags=re.IGNORECASE | re.DOTALL):
            content = self._attr(attrs, "content")
            if not content:
                continue
            attr_name = self._attr(attrs, "name")
            property_name = self._attr(attrs, "property")
            itemprop = self._attr(attrs, "itemprop")
            if attr_name == name or itemprop == name or property_name == f"og:{name}":
                return content

        patterns = [
            rf"<meta[^>]+name=[\"']{re.escape(name)}[\"'][^>]+content=[\"']([^\"']+)[\"']",
            rf"<meta[^>]+property=[\"']og:{re.escape(name)}[\"'][^>]+content=[\"']([^\"']+)[\"']",
            rf"<meta[^>]+itemprop=[\"']{re.escape(name)}[\"'][^>]+content=[\"']([^\"']+)[\"']",
            rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+name=[\"']{re.escape(name)}[\"']",
            rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']og:{re.escape(name)}[\"']",
            rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+itemprop=[\"']{re.escape(name)}[\"']",
        ]
        return self._first_match(body, patterns)

    def _meta_property_content(self, body: str, property_name: str) -> str | None:
        for attrs in re.findall(r"<meta\b([^>]*)>", body, flags=re.IGNORECASE | re.DOTALL):
            content = self._attr(attrs, "content")
            if content and self._attr(attrs, "property") == property_name:
                return content
        return self._first_match(
            body,
            [
                rf"<meta[^>]+property=[\"']{re.escape(property_name)}[\"'][^>]+content=[\"']([^\"']+)[\"']",
                rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']{re.escape(property_name)}[\"']",
            ],
        )

    def _published_at(self, body: str) -> str | None:
        published_at = (
            self._meta_property_content(body, "article:published_time")
            or self._meta_content(body, "datePublished")
            or self._meta_content(body, "pubdate")
            or self._json_ld_first(body, "datePublished")
            or self._first_match(
                body,
                [
                    r"<span[^>]*class=[\"'][^\"']*date[^\"']*[\"'][^>]*>(.*?)</span>",
                    r"<p[^>]*class=[\"'][^\"']*date[^\"']*[\"'][^>]*>(.*?)</p>",
                ],
            )
        )
        return self._normalize_datetime_text(published_at)

    def _normalize_datetime_text(self, value: str | None) -> str | None:
        text = self._html_to_text(value or "")
        if not text:
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
        except ValueError:
            pass

        match = re.search(
            r"(\d{1,2})/(\d{1,2})/(\d{4})\s*,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?",
            text,
        )
        if not match:
            return text
        day, month, year, hour, minute, second = match.groups()
        dt = datetime(
            int(year),
            int(month),
            int(day),
            int(hour),
            int(minute),
            int(second or 0),
            tzinfo=self.vietnam_timezone,
        )
        return dt.isoformat()

    def _json_ld_first(self, body: str, key: str) -> str | None:
        for parsed in self._json_ld_documents(body):
            value = self._find_json_key(parsed, key)
            if value not in (None, ""):
                return str(value)
        return None

    def _json_ld_documents(self, body: str) -> list[Any]:
        documents = []
        scripts = re.findall(
            r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
            body,
            flags=re.IGNORECASE | re.DOTALL,
        )
        for raw in scripts:
            text = html.unescape(raw).strip()
            if not text:
                continue
            try:
                documents.append(json.loads(text))
            except json.JSONDecodeError:
                continue
        return documents

    def _find_json_key(self, node: Any, key: str) -> Any:
        if isinstance(node, list):
            for item in node:
                value = self._find_json_key(item, key)
                if value not in (None, ""):
                    return value
            return None
        if not isinstance(node, dict):
            return None
        if key in node:
            return node[key]
        for value in node.values():
            if isinstance(value, (dict, list)):
                found = self._find_json_key(value, key)
                if found not in (None, ""):
                    return found
        return None

    def _category(self, body: str) -> str | None:
        category = self._meta_content(body, "section") or self._first_match(
            body,
            [
                r"<ul[^>]*class=[\"'][^\"']*breadcrumb[^\"']*[\"'][^>]*>.*?<a[^>]*>(.*?)</a>",
                r"<a[^>]*data-medium=[\"']Menu-[^\"']*[\"'][^>]*>(.*?)</a>",
                r"<meta[^>]+name=[\"']tt_site_id_detail[\"'][^>]+catename=[\"']([^\"']+)[\"']",
                r"<meta[^>]+catename=[\"']([^\"']+)[\"'][^>]+name=[\"']tt_site_id_detail[\"']",
            ],
        )
        if not category:
            folder_names = self._meta_content(body, "tt_list_folder_name")
            if folder_names:
                names = [name.strip() for name in folder_names.split(",") if name.strip() and name.strip().lower() != "vnexpress"]
                category = names[-1] if names else None
        return self._html_to_text(category) if category else None

    def _tags(self, body: str) -> list[str]:
        title = self._html_to_text(
            self._first_match(
                body,
                [
                    r"<h1[^>]*class=[\"'][^\"']*title-detail[^\"']*[\"'][^>]*>(.*?)</h1>",
                    r"<title[^>]*>(.*?)</title>",
                ],
            )
            or ""
        )
        for raw_tags in [
            self._meta_property_content(body, "article:tag"),
            ",".join(self._json_ld_tags(body)),
            self._meta_content(body, "news_keywords"),
            self._meta_content(body, "keywords"),
        ]:
            tags = self._clean_tags(raw_tags, title)
            if tags:
                return tags
        tag_matches = re.findall(r"<a[^>]+class=[\"'][^\"']*tag_item[^\"']*[\"'][^>]*>(.*?)</a>", body, flags=re.IGNORECASE | re.DOTALL)
        return self._dedupe_texts([self._html_to_text(tag) for tag in tag_matches if self._html_to_text(tag)])

    def _json_ld_tags(self, body: str) -> list[str]:
        tags: list[str] = []
        for parsed in self._json_ld_documents(body):
            value = self._find_json_key(parsed, "about")
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        tags.append(item)
                    elif isinstance(item, dict) and item.get("name"):
                        tags.append(str(item["name"]))
            elif isinstance(value, str):
                tags.append(value)
        return tags

    def _clean_tags(self, raw_tags: str | None, title: str) -> list[str]:
        if not raw_tags:
            return []
        tags = []
        for item in raw_tags.split(","):
            tag = self._html_to_text(item)
            if tag and not self._is_noise_tag(tag, title):
                tags.append(tag)
        return self._dedupe_texts(tags)

    def _is_noise_tag(self, tag: str, title: str) -> bool:
        normalized_tag = normalize_title(tag)
        normalized_title = normalize_title(title)
        return (
            not normalized_tag
            or normalized_tag == normalized_title
            or normalized_tag == f"{normalized_title} - vnexpress"
            or normalized_tag.endswith(" - vnexpress")
        )

    def _dedupe_texts(self, items: list[str]) -> list[str]:
        deduped = []
        seen = set()
        for item in items:
            text = item.strip()
            key = normalize_title(text)
            if text and key not in seen:
                seen.add(key)
                deduped.append(text)
        return deduped

    def _decode_jsonish_string(self, value: str) -> str:
        text = html.unescape(value or "").strip()
        if not text:
            return ""
        if text[0] in {"\"", "'"}:
            try:
                return str(json.loads(text))
            except json.JSONDecodeError:
                pass
        if "\\u" in text or "\\/" in text:
            try:
                return bytes(text, "utf-8").decode("unicode_escape").replace("\\/", "/")
            except UnicodeDecodeError:
                pass
        return text

    def _attr(self, tag: str, attr: str) -> str | None:
        match = re.search(rf"\b{re.escape(attr)}\s*=\s*([\"'])(.*?)\1", tag, flags=re.IGNORECASE | re.DOTALL)
        return html.unescape(match.group(2)).strip() if match else None

    def _clean_url(self, value: Any) -> str:
        if not value:
            return ""
        url = html.unescape(str(value)).replace("\\/", "/").strip()
        if url.startswith("//"):
            return f"https:{url}"
        return url

    def _first_value(self, value: Any) -> str:
        if isinstance(value, list):
            return str(value[0]) if value else ""
        return str(value or "")

    def _looks_like_article(self, url: str) -> bool:
        return bool(re.search(r"https?://vnexpress\.net/.+-\d+\.html", url))

    def _looks_like_rss(self, url: str) -> bool:
        parsed = urlparse(url)
        return parsed.netloc.endswith("vnexpress.net") and (parsed.path.endswith(".rss") or "/rss/" in parsed.path)

    def _rss_url_from_source_url(self, url: str | None) -> str | None:
        if not url:
            return None
        parsed = urlparse(url)
        if not parsed.netloc.endswith("vnexpress.net") or self._looks_like_article(url) or self._looks_like_rss(url):
            return None
        slug = parsed.path.strip("/").split("/")[-1]
        return f"https://vnexpress.net/rss/{slug}.rss" if slug else None

    def _dedupe_links(self, links: list[str]) -> list[str]:
        deduped = []
        seen = set()
        for link in links:
            normalized = self._clean_url(link).split("#")[0].strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                deduped.append(normalized)
        return deduped

    def _dedupe_urls(self, urls: list[str]) -> list[str]:
        deduped = []
        seen = set()
        for url in urls:
            normalized = self._clean_url(url).strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                deduped.append(normalized)
        return deduped

    def _image_fingerprint(self, url: str) -> str:
        if not url:
            return ""
        clean = url.split("?")[0].split("#")[0].lower()
        parsed = urlparse(clean)
        return parsed.path.rsplit("/", 1)[-1] or re.sub(r"https?://i\d+-", "https://i-", clean)

    def _dedupe_dicts(self, items: list[dict[str, str]], key: str) -> list[dict[str, str]]:
        deduped = []
        seen = set()
        for item in items:
            value = item.get(key)
            if not value:
                continue
            fp = self._image_fingerprint(value) if key in ("src", "url", "source_url") else value
            if fp not in seen:
                seen.add(fp)
                deduped.append(item)
        return deduped

    def _is_blocked_image(self, url: str) -> bool:
        clean_url = self._clean_url(url).split("?")[0].split("#")[0].lower()
        return (
            clean_url.endswith(".svg")
            or "/logos/" in clean_url
            or "/graphics/logo" in clean_url
            or any(clean_url.endswith(f"/{name}") or clean_url.endswith(name) for name in self.blocked_image_names)
        )

    def _external_id(self, url: str | None) -> str:
        if not url:
            return hashlib.sha256(str(datetime.now(timezone.utc)).encode("utf-8")).hexdigest()
        match = re.search(r"-(\d+)\.html", url)
        return match.group(1) if match else hashlib.sha256(url.encode("utf-8")).hexdigest()

    def _is_excluded_source(
        self,
        url: str,
        excluded_urls: set[str],
        excluded_external_ids: set[str],
    ) -> bool:
        return (
            self._source_url_key(url) in excluded_urls
            or self._external_id(url).strip().casefold() in excluded_external_ids
        )

    def _source_url_key(self, value: Any) -> str:
        return self._clean_url(value).split("#", 1)[0].rstrip("/").casefold()

    def _limit(self, configuration: dict[str, Any]) -> int:
        value = configuration.get("max_items", configuration.get("limit", 10))
        return max(1, min(int(value or 10), 200))

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
