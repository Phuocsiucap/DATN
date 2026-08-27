from __future__ import annotations

import hashlib
import html
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

from app.crawler.crawlers.base import BaseCrawler
from app.normalization.cleaners.text import clean_text, normalize_title
from app.normalization.validators.quality import score_quality, status_from_score


class VNExpressCrawler(BaseCrawler):
    name = "vnexpress-crawler"
    content_type = "ARTICLE"
    outputs_normalized = True
    latest_rss_url = "https://vnexpress.net/rss/tin-moi-nhat.rss"
    homepage_url = "https://vnexpress.net/"
    blocked_image_names = {"nguonuutien.jpg"}

    def __init__(self) -> None:
        self.last_errors: list[dict[str, Any]] = []

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
            links = self.discover_links(client, source_url=source_url, limit=max(limit * 5, limit))
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
                documents.append(self.to_processed_document(job_id, source_type, article))
            return documents

    def discover_links(self, client: httpx.Client, *, source_url: str | None, limit: int) -> list[str]:
        if source_url and self._looks_like_article(source_url):
            return [source_url]

        rss_urls = []
        if source_url and self._looks_like_rss(source_url):
            rss_urls.append(source_url)
        category_rss_url = self._rss_url_from_source_url(source_url)
        if category_rss_url:
            rss_urls.append(category_rss_url)
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
        video_thumbnail_urls = {video.get("thumbnailUrl") for video in json_ld_videos if video.get("thumbnailUrl")}
        images = [
            image
            for image in self._dedupe_dicts([*self._metadata_images(body), *self._image_objects(body, url)], "src")
            if image.get("src") not in video_thumbnail_urls
        ]
        videos = self._normalize_videos([*json_ld_videos, *self._dom_videos(body), *self._regex_videos(body)])

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
        paragraphs_html = re.findall(r"<p[^>]*>(.*?)</p>", scope, flags=re.IGNORECASE | re.DOTALL)

        result = []
        seen = set()
        for raw_p in paragraphs_html:
            if re.search(r'class=["\'][^"\']*(?:breadcrumb|tag_|author|copyright|ads|social|comment)[^"\']*["\']', raw_p, re.IGNORECASE):
                continue
            text = self._html_to_text(raw_p)
            if text and text not in seen:
                seen.add(text)
                result.append(text)
        return result

    def _image_objects(self, body: str, base_url: str) -> list[dict[str, str]]:
        figures = re.findall(r"<figure\b[^>]*>(.*?)</figure>", body, flags=re.IGNORECASE | re.DOTALL)
        containers = figures or re.findall(r"<img\b[^>]*>", self._article_scope(body), flags=re.IGNORECASE | re.DOTALL)

        images: list[dict[str, str]] = []
        for container in containers:
            if re.search(r"<iframe\b|box_embed_video_parent|\bdata-vid=", container, flags=re.IGNORECASE):
                continue
            img_match = re.search(r"<img\b([^>]*)>", container, flags=re.IGNORECASE | re.DOTALL)
            attrs = img_match.group(1) if img_match else container
            src = self._clean_url(self._attr(attrs, "data-src") or self._attr(attrs, "src") or self._attr(attrs, "data-original"))
            if not src or src.startswith("data:") or "svg" in src.lower() or self._is_blocked_image(src):
                continue
            images.append(
                {
                    "src": urljoin(base_url, src),
                    "alt": self._html_to_text(self._attr(attrs, "alt") or ""),
                    "caption": self._html_to_text(
                        self._first_match(container, [r"<figcaption\b[^>]*>(.*?)</figcaption>"]) or ""
                    ),
                }
            )
        return self._dedupe_dicts(images, "src")

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
            src = self._clean_url(self._attr(attrs, "src") or self._attr(attrs, "data-src"))
            if src and not src.startswith("blob:"):
                videos.append(
                    {
                        "source": "video-tag",
                        "src": src,
                        "type": self._attr(attrs, "type") or "",
                        "poster": self._clean_url(self._attr(attrs, "poster") or self._attr(attrs, "data-poster")),
                        "modes": self._attr(attrs, "data-mode") or "",
                        "maxMode": self._attr(attrs, "max-mode") or "",
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
            "title": existing.get("title") or incoming.get("title"),
            "description": existing.get("description") or incoming.get("description"),
            "thumbnail": existing.get("thumbnail") or incoming.get("thumbnail"),
            "uploadDate": existing.get("uploadDate") or incoming.get("uploadDate"),
            "duration": existing.get("duration") or incoming.get("duration"),
            "qualities": existing.get("qualities") or incoming.get("qualities") or [],
            "maxQuality": existing.get("maxQuality") or incoming.get("maxQuality"),
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
        patterns = [
            rf"<meta[^>]+name=[\"']{re.escape(name)}[\"'][^>]+content=[\"']([^\"']+)[\"']",
            rf"<meta[^>]+property=[\"']og:{re.escape(name)}[\"'][^>]+content=[\"']([^\"']+)[\"']",
            rf"<meta[^>]+itemprop=[\"']{re.escape(name)}[\"'][^>]+content=[\"']([^\"']+)[\"']",
            rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+name=[\"']{re.escape(name)}[\"']",
            rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']og:{re.escape(name)}[\"']",
            rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+itemprop=[\"']{re.escape(name)}[\"']",
        ]
        return self._first_match(body, patterns)

    def _published_at(self, body: str) -> str | None:
        return self._first_match(
            body,
            [
                r"<meta[^>]+property=[\"']article:published_time[\"'][^>]+content=[\"']([^\"']+)[\"']",
                r"<meta[^>]+itemprop=[\"']datePublished[\"'][^>]+content=[\"']([^\"']+)[\"']",
                r"<meta[^>]+name=[\"']pubdate[\"'][^>]+content=[\"']([^\"']+)[\"']",
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
        keywords = self._meta_content(body, "keywords")
        if keywords:
            return [item.strip() for item in keywords.split(",") if item.strip()]
        tag_matches = re.findall(r"<a[^>]+class=[\"'][^\"']*tag_item[^\"']*[\"'][^>]*>(.*?)</a>", body, flags=re.IGNORECASE | re.DOTALL)
        return [self._html_to_text(tag) for tag in tag_matches if self._html_to_text(tag)]

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

    def _image_fingerprint(self, url: str) -> str:
        if not url:
            return ""
        clean = url.split("?")[0].split("#")[0].lower()
        asset_id_match = re.search(r"-(\d{7,})\.(png|jpg|jpeg|webp|gif)", clean)
        if asset_id_match:
            return f"vne_asset_{asset_id_match.group(1)}"
        return re.sub(r"https?://i\d+-", "https://i-", clean)

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
