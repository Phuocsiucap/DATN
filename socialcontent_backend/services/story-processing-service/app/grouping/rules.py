import re
import unicodedata


EPISODE_RE = re.compile(r"(?:tập|tap|ep|episode|p|phần|phan)\s*0*(\d+)", re.IGNORECASE)
FULL_RE = re.compile(r"\b(full|bản đầy đủ|ban day du)\b", re.IGNORECASE)


def normalize_story_text(value: str) -> str:
    text = unicodedata.normalize("NFC", value or "").lower()
    text = re.sub(r"#[\w-]+", "", text)
    text = EPISODE_RE.sub("", text)
    text = FULL_RE.sub("", text)
    text = re.sub(r"\btruyện\s*(ma|kinh dị)?\b", "", text)
    text = re.sub(r"[-_:|]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip() or value.strip().lower()


def extract_episode_number(title: str) -> int | None:
    match = EPISODE_RE.search(title or "")
    return int(match.group(1)) if match else None


def grouping_key(title: str, author: str | None, language: str) -> str:
    return "|".join([normalize_story_text(title), (author or "").strip().lower(), language or "vi"])
