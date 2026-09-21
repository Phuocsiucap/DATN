"""Helpers for reusable crawl source configuration."""
from copy import deepcopy


def effective_source_configuration(source_type: str, configuration: dict | None) -> dict:
    result = deepcopy(configuration or {})
    if "job_options" not in result:
        result["job_options"] = []
    return result
