import re
import unicodedata


def clean_text(value: str | None, preserve_newlines: bool = False) -> str:
    text = unicodedata.normalize("NFC", value or "")
    text = re.sub(r"<script.*?</script>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    if preserve_newlines:
        text = re.sub(r"\r\n|\r", "\n", text)
        lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
        text = "\n\n".join(line for line in lines if line)
    else:
        text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_title(value: str | None) -> str:
    text = clean_text(value).lower()
    text = re.sub(r"#[\w-]+", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()
