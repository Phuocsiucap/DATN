from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from backend.bilibili_service.app.core.config import get_settings
from backend.bilibili_service.app.integrations.bilibili.deepseek_subtitles import translate_subtitle_window_with_deepseek
from backend.bilibili_service.app.integrations.bilibili.progress import ProgressCallback


SRT_BLOCK_RE = re.compile(
    r"(?P<idx>\d+)\s+"
    r"(?P<time>\d{2}:\d{2}:\d{2},\d{3}\s-->\s\d{2}:\d{2}:\d{2},\d{3})\s+"
    r"(?P<text>.*?)(?=\n\n|\Z)",
    re.DOTALL,
)

ZH_NORMALIZATION = {
    "餅膠": "病娇",
    "饼胶": "病娇",
    "風批": "疯批",
    "瘋批": "疯批",
    "繼父": "继父",
    "渣男": "渣男",
    "祭父": "继父",
    "總裁": "总裁",
    "霸總": "霸总",
    "霸总": "霸道总裁",
    "令人聞風喪本地飛到大陸": "令人闻风丧胆的黑道大佬",
    "令人闻风丧本地飞到大陆": "令人闻风丧胆的黑道大佬",
    "用情置身": "用情至深",
    "殉寂": "殉情",
    "聞風喪": "闻风丧",
    "變成": "变成",
    "強摘": "强制爱",
    "強制愛": "强制爱",
    "秉嬌": "病娇",
    "併嬌": "病娇",
    "病娇大牢": "病娇大佬",
    "大牢": "大佬",
    "靈魂": "灵魂",
    "這次": "这次",
    "會怕用情": "会怕用情",
    "競爭的重生": "竟然重生",
    "迅急死": "殉情死",
    "祭父": "继父",
    "害死後": "害死后",
    "女人身邊": "女人身边",
    "心愛": "心爱",
    "卻": "却",
    "喜歡": "喜欢",
    "這": "这",
    "發誓": "发誓",
    "沒想": "没想",
    "轉身": "转身",
    "不禁": "奔向",
}

PHRASE_GLOSSARY = {
    "霸道总裁": "tổng tài bá đạo",
    "病娇大佬": "đại ca bệnh kiều",
    "病娇": "bệnh kiều",
    "疯批": "kẻ điên tình",
    "黑道大佬": "ông trùm xã hội đen",
    "渣男": "tra nam",
    "继父": "cha dượng",
    "顾先生": "anh Cố",
    "顾总": "tổng giám đốc Cố",
    "傅少": "thiếu gia Phó",
    "重生": "trùng sinh",
    "强制爱": "yêu chiếm hữu",
}

SHORT_DIALOGUE_FALLBACKS = {
    "你忘了": "Anh quên rồi.",
    "你忘了吗": "Anh quên rồi sao?",
    "忘了": "Quên rồi.",
    "我忘了": "Tôi quên rồi.",
    "不要": "Đừng mà.",
    "别走": "Đừng đi.",
    "对不起": "Tôi xin lỗi.",
    "没事": "Không sao.",
    "谢谢": "Cảm ơn.",
    "闭嘴": "Im miệng.",
    "放开我": "Buông tôi ra.",
    "你干嘛": "Anh làm gì vậy?",
    "为什么": "Tại sao?",
    "我不信": "Tôi không tin.",
}

VI_POST_REPLACEMENTS = {
    "ông Cổ": "anh Cố",
    "Ông Cổ": "Anh Cố",
    "anh Qu": "anh Cố",
    "Anh Qu": "Anh Cố",
    "Giám đốc đạo diễn": "tổng tài bá đạo",
    "Tổng thống Hegel": "tổng tài bá đạo",
    "Anh chàng hư hỏng": "bệnh kiều",
    "anh chàng hư hỏng": "bệnh kiều",
    "bánh quy": "bệnh kiều",
    "Bánh quy": "Bệnh kiều",
    "sấu bệnh": "bệnh kiều",
    "Sấu bệnh": "Bệnh kiều",
    "người đàn ông cặn bã": "tra nam",
    "lũ đàn ông": "tra nam",
    "cha sau": "cha dượng",
    "Sasha Shichim": "Hạ Tĩnh Minh",
    "Sasha Shichin": "Hạ Tĩnh Minh",
    "Ánh Nam": "A Thành",
    "Tôi đã giết cậu.": "Tôi sẽ giết anh.",
    "Tôi đã giết hắn.": "Tôi sẽ giết hắn.",
    "Nếu có người sinh ra": "nếu có kiếp sau",
    "Tôi thề.": "cô thề",
    "Nhãn lên giây sau đó.": "Ngay giây sau",
    "Nhanh lên giây sau đó.": "Ngay giây sau",
    "Lý Khắc Tân": "Tạ Cẩn Thần",
    "Tạ Cẩm Thần": "Tạ Cẩn Thần",
    "Hạ Sáng Mê": "Hạ Tinh Miên",
    "Hạ Tinh Miện": "Hạ Tinh Miên",
}

class SubtitleTranslator:
    def translate_zh_to_vi(self, source_srt: Path, output_srt: Path, *, progress_callback: ProgressCallback | None = None) -> str:
        content = source_srt.read_text(encoding="utf-8")
        context = build_translation_context(content)
        blocks = []
        source_texts = []
        for match in SRT_BLOCK_RE.finditer(content):
            text = "\n".join(line.strip() for line in match.group("text").splitlines() if line.strip())
            blocks.append((match.group("idx"), match.group("time")))
            source_texts.append(text)
        translated_texts = translate_subtitle_texts(source_texts, context=context, progress_callback=progress_callback)

        with output_srt.open("w", encoding="utf-8") as f:
            for (idx, timing), text_vi in zip(blocks, translated_texts):
                f.write(f"{idx}\n{timing}\n{format_srt_subtitle_text(text_vi)}\n\n")
        context_path = output_srt.with_suffix(".context.json")
        context_path.write_text(json.dumps(context, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(output_srt)


def translate_text(text_zh: str, context: dict[str, Any] | None = None) -> str:
    return translate_subtitle_window_with_deepseek([normalize_chinese_dialogue(text_zh)], context=context)[0]


def translate_subtitle_texts(
    texts_zh: list[str],
    context: dict[str, Any] | None = None,
    *,
    progress_callback: ProgressCallback | None = None,
) -> list[str]:
    provider = get_settings().subtitle_provider.lower().strip()
    if provider == "deepseek":
        return translate_texts_with_deepseek_windows(texts_zh, context=context, progress_callback=progress_callback)
    raise RuntimeError(f"Unsupported subtitle provider: {provider}. Set ACD_SUBTITLE_PROVIDER=deepseek.")


def translate_texts_with_deepseek_windows(
    texts_zh: list[str],
    context: dict[str, Any] | None = None,
    *,
    progress_callback: ProgressCallback | None = None,
) -> list[str]:
    translated: list[str] = []
    window_size = 12
    if progress_callback:
        progress_callback({"current": 0, "total": len(texts_zh), "detail": "Đang gọi DeepSeek dịch phụ đề"})
    for start in range(0, len(texts_zh), window_size):
        window = [normalize_chinese_dialogue(text) for text in texts_zh[start:start + window_size]]
        if progress_callback:
            progress_callback({
                "current": start,
                "total": len(texts_zh),
                "detail": f"DeepSeek đang dịch dòng {start + 1}-{min(start + len(window), len(texts_zh))}",
            })
        values = translate_subtitle_window_with_deepseek(window, context=context, previous_vi=translated)
        translated.extend(validate_llm_translations(values, window, context=context, previous_vi=translated))
        if progress_callback:
            progress_callback({
                "current": min(len(translated), len(texts_zh)),
                "total": len(texts_zh),
                "detail": "DeepSeek đã trả bản dịch hợp lệ",
            })
    return [postprocess_vi_translation(text, source) for text, source in zip(translated, texts_zh)]


def validate_llm_translations(
    values: list[str],
    sources_zh: list[str],
    *,
    context: dict[str, Any] | None = None,
    previous_vi: list[str] | None = None,
) -> list[str]:
    if len(values) != len(sources_zh):
        raise RuntimeError(f"Subtitle translator returned {len(values)} lines for {len(sources_zh)} source lines.")
    cleaned: list[str] = []
    for value, source in zip(values, sources_zh):
        text = postprocess_vi_translation(value, source)
        if not is_usable_subtitle_translation(text, source):
            text = repair_low_quality_translation(source, context=context, previous_vi=[*(previous_vi or []), *cleaned])
        if not is_usable_subtitle_translation(text, source):
            raise RuntimeError(f"Low-quality subtitle translation for source: {source[:80]}")
        cleaned.append(text)
    return cleaned


def repair_low_quality_translation(
    source_zh: str,
    *,
    context: dict[str, Any] | None = None,
    previous_vi: list[str] | None = None,
) -> str:
    fallback = short_dialogue_fallback(source_zh)
    try:
        repaired = translate_subtitle_window_with_deepseek(
            [source_zh],
            context={
                **(context or {}),
                "summary_vi": (
                    (context or {}).get("summary_vi", "")
                    + " Repair subtitle: dịch sát câu thoại ngắn, tự nhiên, không giữ chữ Trung."
                ).strip(),
            },
            previous_vi=previous_vi,
        )[0]
        repaired = postprocess_vi_translation(repaired, source_zh)
        if is_usable_subtitle_translation(repaired, source_zh):
            return repaired
    except Exception:
        pass
    if fallback:
        return fallback
    return postprocess_vi_translation(source_zh, source_zh)


def short_dialogue_fallback(source_zh: str) -> str | None:
    cleaned = re.sub(r"[\s，。！？!?,.、：:；;“”\"'（）()]", "", source_zh)
    return SHORT_DIALOGUE_FALLBACKS.get(cleaned)


def is_usable_subtitle_translation(text_vi: str, source_zh: str) -> bool:
    text = text_vi.strip()
    if not text:
        return False
    if len(re.findall(r"[\u3400-\u9fff]", text)) >= 2:
        return False
    return True


def format_srt_subtitle_text(text: str) -> str:
    cleaned = re.sub(r"[ \t]+", " ", text.strip())
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    if "\n" in cleaned:
        return cleaned
    if len(cleaned) <= 34:
        return cleaned
    breakpoints = [match.start() for match in re.finditer(r"[,.!?;:，。！？；：] ", cleaned)]
    midpoint = len(cleaned) // 2
    if breakpoints:
        split_at = min(breakpoints, key=lambda value: abs(value - midpoint)) + 2
        return cleaned[:split_at].strip() + "\n" + cleaned[split_at:].strip()
    words = cleaned.split()
    if len(words) < 6:
        return cleaned
    half = len(words) // 2
    return " ".join(words[:half]) + "\n" + " ".join(words[half:])


def translation_penalty(text_vi: str, source_zh: str) -> int:
    text = postprocess_vi_translation(text_vi, source_zh)
    penalty = 0
    if "黑道" in source_zh and "xã hội đen" not in text.lower():
        penalty += 8
    if ("顾" in source_zh or "顧" in source_zh) and "Cố" not in text:
        penalty += 6
    if "霸道总裁" in source_zh and "tổng tài" not in text.lower():
        penalty += 8
    if "病娇" in source_zh and "bệnh" not in text.lower():
        penalty += 6
    if "大佬" in source_zh and not any(term in text.lower() for term in ("đại ca", "ông trùm", "tay anh chị")):
        penalty += 6
    if "强制爱" in source_zh and not any(term in text.lower() for term in ("chiếm hữu", "cưỡng ép", "điên tình")):
        penalty += 6
    if "重生" in source_zh and "trùng sinh" not in text.lower():
        penalty += 6
    return penalty + abs(len(text) - len(source_zh) * 2) // 30


def normalize_chinese_dialogue(text: str) -> str:
    normalized = text.strip()
    for source, target in ZH_NORMALIZATION.items():
        normalized = normalized.replace(source, target)
    normalized = normalize_short_drama_terms(normalized)
    return normalized


def normalize_short_drama_terms(text: str) -> str:
    normalized = text
    normalized = re.sub(r"令人闻风丧(?:本地飞到大陆|胆.*?大佬)", "令人闻风丧胆的黑道大佬", normalized)
    normalized = re.sub(r"强制爱[的地]?疯批病娇", "强制爱的疯批病娇", normalized)
    normalized = re.sub(r"病娇大佬.*用情至深", "病娇大佬用情至深", normalized)
    normalized = re.sub(r"女人(?:竞争的|竟争的)?重生", "女人竟然重生", normalized)
    normalized = re.sub(r"竟直接.*(?:殉情|迅急).*死在女人身边", "竟直接殉情死在女人身边", normalized)
    return normalized


def translate_glossary_phrase(text: str, context: dict[str, Any] | None = None) -> str | None:
    cleaned = re.sub(r"[\s，。！？!?,.、：:；;“”\"'（）()]", "", text)
    for source, target in context_glossary(context).items():
        if cleaned == source:
            return target
    if cleaned in PHRASE_GLOSSARY:
        return PHRASE_GLOSSARY[cleaned]
    return None


def postprocess_vi_translation(text_vi: str, source_zh: str) -> str:
    text = text_vi.strip()
    for source, target in VI_POST_REPLACEMENTS.items():
        text = text.replace(source, target)
    for zh_term, vi_term in PHRASE_GLOSSARY.items():
        if zh_term in source_zh and vi_term.lower() not in text.lower():
            if zh_term in {"顾先生", "顾总", "傅少"}:
                text = re.sub(r"\bông\b", "anh", text, flags=re.IGNORECASE)
            elif len(source_zh) <= len(zh_term) + 4:
                text = vi_term
    text = apply_name_postprocess(text, source_zh)
    return text


def apply_name_postprocess(text_vi: str, source_zh: str) -> str:
    name_map = {
        "夏静明": "Hạ Tĩnh Minh",
        "夏金眠": "Hạ Kim Miên",
        "夏星绵": "Hạ Tinh Miên",
        "夏星眠": "Hạ Tinh Miên",
        "谢瑾辰": "Tạ Cẩn Thần",
        "谢剑辰": "Tạ Cẩn Thần",
        "谢锦辰": "Tạ Cẩn Thần",
        "谢简陈": "Tạ Cẩn Thần",
        "阿辰": "A Thần",
        "阿成": "A Thành",
    }
    text = text_vi
    for source, target in name_map.items():
        if source in source_zh and target not in text:
            text = re.sub(r"\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}\b", target, text, count=1)
    return text


def build_translation_context(srt_content: str) -> dict[str, Any]:
    transcript = "\n".join(
        normalize_chinese_dialogue(" ".join(match.group("text").split()))
        for match in SRT_BLOCK_RE.finditer(srt_content)
    )
    glossary = dict(PHRASE_GLOSSARY)
    detected_terms = [term for term in PHRASE_GLOSSARY if term in transcript]
    names = [*detect_chinese_names(transcript), *detect_full_chinese_names(transcript)]
    for name in names:
        glossary[f"{name}先生"] = f"anh {translate_surname(name)}"
        glossary[f"{name}总"] = f"tổng giám đốc {translate_surname(name)}"
        glossary[f"{name}少"] = f"thiếu gia {translate_surname(name)}"
        translated_name = translate_chinese_name(name)
        if translated_name != name:
            glossary[name] = translated_name
    story_type = "phim ngắn ngôn tình Trung Quốc"
    if "重生" in transcript:
        story_type += ", motif trùng sinh"
    if "霸道总裁" in transcript or "总裁" in transcript:
        story_type += ", tổng tài bá đạo"
    if "病娇" in transcript:
        story_type += ", nam chính bệnh kiều/yêu chiếm hữu"
    summary = f"Câu chuyện thuộc {story_type}. Ưu tiên dịch thoại tự nhiên, đúng xưng hô và thuật ngữ phim ngắn."
    return {
        "summary_vi": summary,
        "story_type": story_type,
        "detected_terms": detected_terms,
        "names": names,
        "glossary": glossary,
    }


def detect_chinese_names(transcript: str) -> list[str]:
    common_surnames = "顾傅陆厉沈霍萧谢江秦薄韩季"
    found: list[str] = []
    for surname in common_surnames:
        if re.search(fr"{surname}(先生|总|少|少爷|承|辰|寒|霆|凌)", transcript) and surname not in found:
            found.append(surname)
    return found


def detect_full_chinese_names(transcript: str) -> list[str]:
    known = ["谢瑾辰", "谢剑辰", "谢锦辰", "谢简陈", "夏星眠", "夏星绵", "夏静明", "夏金眠", "阿辰", "阿成"]
    return [name for name in known if name in transcript]


def translate_surname(surname: str) -> str:
    return {
        "顾": "Cố",
        "傅": "Phó",
        "陆": "Lục",
        "厉": "Lệ",
        "沈": "Thẩm",
        "霍": "Hoắc",
        "萧": "Tiêu",
        "谢": "Tạ",
        "江": "Giang",
        "秦": "Tần",
        "薄": "Bạc",
        "韩": "Hàn",
        "季": "Quý",
    }.get(surname, surname)


def translate_chinese_name(name: str) -> str:
    return {
        "谢瑾辰": "Tạ Cẩn Thần",
        "谢剑辰": "Tạ Cẩn Thần",
        "谢锦辰": "Tạ Cẩn Thần",
        "谢简陈": "Tạ Cẩn Thần",
        "夏星眠": "Hạ Tinh Miên",
        "夏星绵": "Hạ Tinh Miên",
        "夏静明": "Hạ Tĩnh Minh",
        "夏金眠": "Hạ Kim Miên",
        "阿辰": "A Thần",
        "阿成": "A Thành",
    }.get(name, name)


def context_glossary(context: dict[str, Any] | None) -> dict[str, str]:
    value = (context or {}).get("glossary")
    if not isinstance(value, dict):
        return {}
    return {str(key): str(item) for key, item in value.items()}



