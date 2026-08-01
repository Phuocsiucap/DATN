import re
import unicodedata


def clean_text(value: str | None) -> str:
    text = unicodedata.normalize("NFC", value or "")
    text = re.sub(r"<script.*?</script>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_title(value: str | None) -> str:
    text = clean_text(value).lower()
    text = re.sub(r"#[\w-]+", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()
