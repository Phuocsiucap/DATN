from __future__ import annotations

from typing import Any


VNEXPRESS_RSS_FEEDS: list[dict[str, str]] = [
    {"key": "the-gioi", "label": "Thế giới", "url": "https://vnexpress.net/rss/the-gioi.rss"},
    {"key": "thoi-su", "label": "Thời sự", "url": "https://vnexpress.net/rss/thoi-su.rss"},
    {"key": "kinh-doanh", "label": "Kinh doanh", "url": "https://vnexpress.net/rss/kinh-doanh.rss"},
    {"key": "giai-tri", "label": "Giải trí", "url": "https://vnexpress.net/rss/giai-tri.rss"},
    {"key": "the-thao", "label": "Thể thao", "url": "https://vnexpress.net/rss/the-thao.rss"},
    {"key": "phap-luat", "label": "Pháp luật", "url": "https://vnexpress.net/rss/phap-luat.rss"},
    {"key": "giao-duc", "label": "Giáo dục", "url": "https://vnexpress.net/rss/giao-duc.rss"},
    {"key": "goc-nhin", "label": "Góc nhìn", "url": "https://vnexpress.net/rss/goc-nhin.rss"},
    {"key": "bat-dong-san", "label": "Bất động sản", "url": "https://vnexpress.net/rss/bat-dong-san.rss"},
    {"key": "tin-moi-nhat", "label": "Tin mới nhất", "url": "https://vnexpress.net/rss/tin-moi-nhat.rss"},
    {"key": "tin-noi-bat", "label": "Tin nổi bật", "url": "https://vnexpress.net/rss/tin-noi-bat.rss"},
    {"key": "suc-khoe", "label": "Sức khỏe", "url": "https://vnexpress.net/rss/suc-khoe.rss"},
    {"key": "gia-dinh", "label": "Đời sống", "url": "https://vnexpress.net/rss/gia-dinh.rss"},
    {"key": "du-lich", "label": "Du lịch", "url": "https://vnexpress.net/rss/du-lich.rss"},
    {"key": "khoa-hoc-cong-nghe", "label": "Khoa học công nghệ", "url": "https://vnexpress.net/rss/khoa-hoc-cong-nghe.rss"},
    {"key": "oto-xe-may", "label": "Xe", "url": "https://vnexpress.net/rss/oto-xe-may.rss"},
    {"key": "y-kien", "label": "Ý kiến", "url": "https://vnexpress.net/rss/y-kien.rss"},
    {"key": "tam-su", "label": "Tâm sự", "url": "https://vnexpress.net/rss/tam-su.rss"},
    {"key": "vne-go", "label": "VnE-GO", "url": "https://vnexpress.net/rss/vne-go.rss"},
    {"key": "thu-gian", "label": "Thư giãn", "url": "https://vnexpress.net/rss/thu-gian.rss"},
    {"key": "spotlight", "label": "Spotlight", "url": "https://vnexpress.net/rss/spotlight.rss"},
    {"key": "tin-xem-nhieu", "label": "Tin xem nhiều", "url": "https://vnexpress.net/rss/tin-xem-nhieu.rss"},
]


def vnexpress_rss_catalog() -> list[dict[str, str]]:
    return [dict(feed) for feed in VNEXPRESS_RSS_FEEDS]


def vnexpress_rss_by_key() -> dict[str, dict[str, str]]:
    return {feed["key"]: dict(feed) for feed in VNEXPRESS_RSS_FEEDS}


def vnexpress_rss_by_url() -> dict[str, dict[str, str]]:
    return {feed["url"]: dict(feed) for feed in VNEXPRESS_RSS_FEEDS}


def resolve_vnexpress_rss_feeds(configuration: dict[str, Any] | None) -> list[dict[str, str]]:
    config = configuration or {}
    by_key = vnexpress_rss_by_key()
    by_url = vnexpress_rss_by_url()
    resolved: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    for raw_key in config.get("rss_feed_keys") or []:
        key = str(raw_key or "").strip()
        feed = by_key.get(key)
        if feed and feed["url"] not in seen_urls:
            resolved.append(feed)
            seen_urls.add(feed["url"])

    for raw_url in config.get("rss_feed_urls") or []:
        url = str(raw_url or "").strip()
        feed = by_url.get(url) or {"key": url, "label": url, "url": url}
        if url and feed["url"] not in seen_urls:
            resolved.append(feed)
            seen_urls.add(feed["url"])

    return resolved
