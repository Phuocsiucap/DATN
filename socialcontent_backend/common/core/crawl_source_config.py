"""Compatibility defaults for reusable crawl sources created before job options."""
from copy import deepcopy


def effective_source_configuration(source_type: str, configuration: dict | None) -> dict:
    result = deepcopy(configuration or {})
    if "job_options" not in result:
        result["job_options"] = {
            "VNEXPRESS": ["source_url", "keywords", "rss_feed_keys"],
            "BILIBILI": ["source_url", "keywords"],
        }.get(source_type, [])
    return result
