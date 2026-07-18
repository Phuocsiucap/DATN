from __future__ import annotations

from datetime import datetime

from backend.vnexpress_service.app.integrations.vnexpress.crawler import crawl_article_sync, crawl_rss_sync, crawl_vnexpress_sync
from backend.vnexpress_service.app.schemas.events import CrawlRequested


def article_text(article: dict) -> str:
    content = article.get("content") or ""
    if isinstance(content, list):
        content = " ".join(str(item) for item in content)
    return f"{article.get('title', '')}\n{content}".lower()


def matches_terms(article: dict, terms: list[str]) -> bool:
    if not terms:
        return True
    text = article_text(article)
    return any(term.lower() in text for term in terms)


def crawl_for_request(request: CrawlRequested) -> tuple[list[dict], int]:
    links = crawl_rss_sync(request.limit * 5)
    if not links:
        links = crawl_vnexpress_sync()

    seen: set[str] = set()
    articles: list[dict] = []
    skipped = 0
    excludes = [term.lower().strip() for term in request.exclude_keywords if term.strip()]
    topics = [term.lower().strip() for term in request.topics if term.strip()]

    for link in links:
        if not link or link in seen:
            continue
        seen.add(link)
        if len(articles) >= request.limit:
            break

        article = crawl_article_sync(link)
        if not article:
            skipped += 1
            continue
        if not matches_terms(article, topics):
            skipped += 1
            continue
        if excludes and matches_terms(article, excludes):
            skipped += 1
            continue

        article["crawled_at"] = datetime.utcnow().isoformat()
        article["status"] = "crawled"
        article["crawl_source"] = request.source
        article["requested_by_user_ids"] = [request.user_id] if request.user_id else []
        article["requested_topics"] = topics
        articles.append(article)

    return articles, skipped
