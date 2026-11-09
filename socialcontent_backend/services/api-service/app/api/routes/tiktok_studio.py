from __future__ import annotations

import mimetypes
import os
import sys
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

# Ensure tiktok_affiliate_studio is in path
PROJECT_ROOT = Path(__file__).resolve().parents[6]
STUDIO_DIR = PROJECT_ROOT / "tiktok_affiliate_studio"
if str(STUDIO_DIR) not in sys.path:
    sys.path.insert(0, str(STUDIO_DIR))

import importlib.util

try:
    from common.constants.elevenlabs_voices import DEFAULT_ELEVENLABS_VOICE_ID, ELEVENLABS_VOICES
except ImportError:
    from elevenlabs_voices import DEFAULT_ELEVENLABS_VOICE_ID, ELEVENLABS_VOICES

# Safely import tiktok_affiliate_studio/app.py without namespace collision with api-service app
studio_app_path = STUDIO_DIR / "app.py"
spec = importlib.util.spec_from_file_location("tiktok_studio_core", str(studio_app_path))
studio_core = importlib.util.module_from_spec(spec)
sys.modules["tiktok_studio_core"] = studio_core
spec.loader.exec_module(studio_core)

router = APIRouter(prefix="/tiktok-studio", tags=["tiktok-studio"])


class PrepareProductRequest(BaseModel):
    product_id: str
    variant_index: int = 1


class CrawlProductRequest(BaseModel):
    query: str = Field(..., min_length=3)
    voice_id: str | None = None


class RenderMp4Request(BaseModel):
    product_id: str
    variant_index: int = 1
    visual_mode: str = "real_video"
    voice_id: str | None = None
    scenes: list[dict[str, Any]] = []
    caption: str = ""


class RenderBatch5Request(BaseModel):
    product_id: str
    visual_mode: str = "real_video"
    voice_id: str | None = None


class SaveKeysRequest(BaseModel):
    gemini_api_key: str | None = None
    elevenlabs_api_key: str | None = None
    openai_api_key: str | None = None


@router.get("/bootstrap")
def get_bootstrap_data():
    products = studio_core.get_all_products()
    state = studio_core.load_state()
    keys = studio_core.load_api_keys()

    # Thêm keys từ .env nếu chưa có trong api_keys.json
    if not keys.get("gemini_api_key") and os.environ.get("GEMINI_API_KEY"):
        keys["gemini_api_key"] = os.environ.get("GEMINI_API_KEY", "")
    if not keys.get("elevenlabs_api_key") and os.environ.get("ELEVENLABS_API_KEY"):
        keys["elevenlabs_api_key"] = os.environ.get("ELEVENLABS_API_KEY", "")
    if not keys.get("openai_api_key") and os.environ.get("OPENAI_API_KEY"):
        keys["openai_api_key"] = os.environ.get("OPENAI_API_KEY", "")

    # Chuẩn hóa URLs cho media
    normalized_products = []
    for p in products:
        item = dict(p)
        gallery = item.get("image_Gallery", [])
        norm_gallery = []
        for g in gallery:
            g_copy = dict(g)
            u = g_copy.get("url", "")
            if u.startswith("/assets/"):
                g_copy["url"] = f"/api/v1/tiktok-studio/media{u}"
            norm_gallery.append(g_copy)
        item["image_Gallery"] = norm_gallery
        normalized_products.append(item)

    normalized_jobs = []
    for j in state.get("jobs", []):
        j_copy = dict(j)
        for key in ("video_url", "audio_url", "script_url", "caption_url"):
            if j_copy.get(key) and not j_copy[key].startswith("/api/v1/tiktok-studio/media"):
                j_copy[key] = f"/api/v1/tiktok-studio/media{j_copy[key]}"
        normalized_jobs.append(j_copy)

    return {
        "ok": True,
        "products": normalized_products,
        "jobs": normalized_jobs,
        "voices": ELEVENLABS_VOICES,
        "default_voice_id": DEFAULT_ELEVENLABS_VOICE_ID,
        "keys_status": {
            "has_gemini": bool(keys.get("gemini_api_key")),
            "has_elevenlabs": bool(keys.get("elevenlabs_api_key")),
            "has_openai": bool(keys.get("openai_api_key")),
            "gemini_masked": studio_core.mask_key(keys.get("gemini_api_key", "")),
            "elevenlabs_masked": studio_core.mask_key(keys.get("elevenlabs_api_key", "")),
        },
    }


@router.post("/prepare-product")
def prepare_product(payload: PrepareProductRequest):
    products = studio_core.get_all_products()
    product = next((p for p in products if p["external_id"] == payload.product_id), None)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm.")

    script_pack = studio_core.build_affiliate_script(product, variant_index=payload.variant_index)

    # Chuẩn hóa image_url trong scenes
    for sc in script_pack.get("scenes", []):
        u = sc.get("image_url", "")
        if u.startswith("/assets/"):
            sc["image_url"] = f"/api/v1/tiktok-studio/media{u}"

    product_jobs = studio_core.get_product_jobs(str(payload.product_id))
    norm_jobs = []
    for j in product_jobs:
        j_copy = dict(j)
        for key in ("video_url", "audio_url", "script_url", "caption_url"):
            if j_copy.get(key) and not j_copy[key].startswith("/api/v1/tiktok-studio/media"):
                j_copy[key] = f"/api/v1/tiktok-studio/media{j_copy[key]}"
        norm_jobs.append(j_copy)

    latest_job = next(
        (j for j in norm_jobs if int(j.get("variant_index", 1)) == payload.variant_index),
        norm_jobs[0] if norm_jobs else None,
    )

    return {
        "ok": True,
        "product": product,
        "script_pack": script_pack,
        "latest_job": latest_job,
        "product_jobs": norm_jobs,
    }


@router.post("/crawl-and-create")
def crawl_and_create_product(payload: CrawlProductRequest):
    raw_query = payload.query.strip()
    if len(raw_query) < 3:
        raise HTTPException(status_code=400, detail="Vui lòng dán Link sản phẩm hoặc nhập Tên sản phẩm.")

    keys = studio_core.load_api_keys()
    if not keys.get("gemini_api_key") and os.environ.get("GEMINI_API_KEY"):
        keys["gemini_api_key"] = os.environ.get("GEMINI_API_KEY", "")
    if not keys.get("elevenlabs_api_key") and os.environ.get("ELEVENLABS_API_KEY"):
        keys["elevenlabs_api_key"] = os.environ.get("ELEVENLABS_API_KEY", "")

    ai_info = studio_core.extract_product_info_from_input(raw_query, keys)
    title = str(ai_info.get("title", raw_query)).strip()
    exact_model_q = str(ai_info.get("exact_model_query") or title).strip()
    price_vnd = int(ai_info.get("price_vnd", 159000))
    sales_7d = int(ai_info.get("sales_7d", 10500))
    specs = list(ai_info.get("verified_specs", []))
    search_kw_en = str(ai_info.get("search_keyword_en", exact_model_q))
    og_image_url = str(ai_info.get("og_image_url", ""))

    ext_id = f"KALO-{uuid.uuid4().hex[:6].upper()}"
    prefix = f"custom_{ext_id.lower()}"

    # Crawl 4 ảnh thực tế
    crawled_urls = studio_core.crawl_real_images.crawl_images_for_query(
        prefix,
        [exact_model_q, title],
        count=4,
        primary_og_image=og_image_url,
    )

    # Tải 5 video Shorts review nếu có
    video_out_path = studio_core.REAL_ASSETS_DIR / f"{prefix}_video.mp4"
    try:
        crawled_vids = studio_core.crawl_real_videos.download_multiple_short_mp4s(
            [search_kw_en, exact_model_q, title],
            prefix,
            count=5,
        )
        if crawled_vids and crawled_vids[0].exists():
            video_out_path = crawled_vids[0]
    except Exception as e:
        print(f"[tiktok-studio] Warn tải video Shorts: {e}")

    gallery = []
    if crawled_urls:
        for idx in range(4):
            img_url = crawled_urls[idx % len(crawled_urls)]
            gallery.append(
                {
                    "id": f"{prefix}_{idx + 1}",
                    "label": f"Ảnh thực tế #{idx + 1}",
                    "caption_tag": specs[min(idx, len(specs) - 1)][:38] if specs else "Ảnh thực tế",
                    "url": img_url,
                }
            )

    new_prod = {
        "external_id": ext_id,
        "source": "kalodata_crawled",
        "kalodata_rank": 1,
        "title": title,
        "category": "Sản phẩm Crawl Tự Động",
        "shop_name": "TikTok Shop VN",
        "price_vnd": price_vnd,
        "original_price_vnd": int(price_vnd * 1.4),
        "sales_7d": sales_7d,
        "gmv_7d_vnd": price_vnd * sales_7d,
        "growth_7d_pct": 85.0,
        "rating": 4.9,
        "review_count": 2400,
        "commission_rate": 18.0,
        "verified_specs": specs,
        "forbidden_claims": [],
        "image_Gallery": gallery,
        "real_video_path": str(video_out_path) if video_out_path.exists() else "",
    }

    state = studio_core.load_state()
    state.setdefault("custom_products", []).insert(0, new_prod)
    studio_core.save_state(state)

    all_prods = studio_core.get_all_products()
    scored_prod = next((p for p in all_prods if p["external_id"] == ext_id), new_prod)
    script_pack = studio_core.build_affiliate_script(scored_prod, variant_index=1)

    chosen_voice = payload.voice_id or DEFAULT_ELEVENLABS_VOICE_ID
    job = studio_core.generate_real_mp4_job(
        product=scored_prod,
        scenes=script_pack["scenes"],
        caption=script_pack["caption"],
        variant_index=1,
        visual_mode="real_video" if video_out_path.exists() else "photos_motion",
        voice_id=chosen_voice,
    )

    # Chuẩn hóa URLs cho response
    job_copy = dict(job)
    for key in ("video_url", "audio_url", "script_url", "caption_url"):
        if job_copy.get(key) and not job_copy[key].startswith("/api/v1/tiktok-studio/media"):
            job_copy[key] = f"/api/v1/tiktok-studio/media{job_copy[key]}"

    return {
        "ok": True,
        "product": scored_prod,
        "job": job_copy,
        "product_jobs": [job_copy],
    }


@router.post("/render-mp4")
def render_mp4(payload: RenderMp4Request):
    products = studio_core.get_all_products()
    product = next((p for p in products if p["external_id"] == payload.product_id), None)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm.")

    scenes = payload.scenes
    caption = payload.caption
    if not scenes:
        pack = studio_core.build_affiliate_script(product, variant_index=payload.variant_index)
        scenes = pack["scenes"]
        caption = pack["caption"]

    # Re-map URL back to relative if needed
    cleaned_scenes = []
    for sc in scenes:
        sc_copy = dict(sc)
        u = sc_copy.get("image_url", "")
        if "/api/v1/tiktok-studio/media/assets/" in u:
            sc_copy["image_url"] = u.split("/api/v1/tiktok-studio/media")[1]
        cleaned_scenes.append(sc_copy)

    try:
        job = studio_core.generate_real_mp4_job(
            product=product,
            scenes=cleaned_scenes,
            caption=caption,
            variant_index=payload.variant_index,
            visual_mode=payload.visual_mode,
            voice_id=payload.voice_id,
        )
        job_copy = dict(job)
        for key in ("video_url", "audio_url", "script_url", "caption_url"):
            if job_copy.get(key) and not job_copy[key].startswith("/api/v1/tiktok-studio/media"):
                job_copy[key] = f"/api/v1/tiktok-studio/media{job_copy[key]}"

        product_jobs = studio_core.get_product_jobs(str(payload.product_id))
        norm_jobs = []
        for j in product_jobs:
            j_c = dict(j)
            for key in ("video_url", "audio_url", "script_url", "caption_url"):
                if j_c.get(key) and not j_c[key].startswith("/api/v1/tiktok-studio/media"):
                    j_c[key] = f"/api/v1/tiktok-studio/media{j_c[key]}"
            norm_jobs.append(j_c)

        return {
            "ok": True,
            "job": job_copy,
            "product_jobs": norm_jobs,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi dựng MP4: {e}")


@router.post("/render-batch-5")
def render_batch_5(payload: RenderBatch5Request):
    products = studio_core.get_all_products()
    product = next((p for p in products if p["external_id"] == payload.product_id), None)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm.")

    try:
        studio_core.ensure_product_source_videos(product)
    except Exception as e:
        print(f"[tiktok-studio] Warn đảm bảo 5 video nguồn: {e}")

    created_jobs = []
    try:
        for v_idx in range(1, 6):
            pack = studio_core.build_affiliate_script(product, variant_index=v_idx)
            mode_for_v = payload.visual_mode if payload.visual_mode not in ("auto_diverse", "hybrid") else "real_video"
            j = studio_core.generate_real_mp4_job(
                product=product,
                scenes=pack["scenes"],
                caption=pack["caption"],
                variant_index=v_idx,
                visual_mode=mode_for_v,
                voice_id=payload.voice_id,
            )
            j_c = dict(j)
            for key in ("video_url", "audio_url", "script_url", "caption_url"):
                if j_c.get(key) and not j_c[key].startswith("/api/v1/tiktok-studio/media"):
                    j_c[key] = f"/api/v1/tiktok-studio/media{j_c[key]}"
            created_jobs.append(j_c)

        product_jobs = studio_core.get_product_jobs(str(payload.product_id))
        norm_jobs = []
        for j in product_jobs:
            j_c = dict(j)
            for key in ("video_url", "audio_url", "script_url", "caption_url"):
                if j_c.get(key) and not j_c[key].startswith("/api/v1/tiktok-studio/media"):
                    j_c[key] = f"/api/v1/tiktok-studio/media{j_c[key]}"
            norm_jobs.append(j_c)

        return {
            "ok": True,
            "jobs": created_jobs,
            "product_jobs": norm_jobs,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo 5 video: {e}")


@router.post("/save-keys")
def save_keys(payload: SaveKeysRequest):
    body = payload.model_dump(exclude_unset=True)
    keys = studio_core.save_api_keys(body)
    return {
        "ok": True,
        "keys_status": {
            "has_gemini": bool(keys.get("gemini_api_key")),
            "has_elevenlabs": bool(keys.get("elevenlabs_api_key")),
            "has_openai": bool(keys.get("openai_api_key")),
            "gemini_masked": studio_core.mask_key(keys.get("gemini_api_key", "")),
            "elevenlabs_masked": studio_core.mask_key(keys.get("elevenlabs_api_key", "")),
        },
    }


@router.get("/media/{file_path:path}")
def serve_media(file_path: str):
    """Phục vụ file video MP4, audio m4a, ảnh assets trực tiếp."""
    # Tìm trong output hoặc assets
    clean_path = file_path.lstrip("/").replace("output/", "").replace("assets/", "")
    target = (studio_core.OUTPUT_DIR / clean_path).resolve()
    if not target.exists() or not target.is_file():
        target = (studio_core.ASSETS_DIR / clean_path).resolve()
    if not target.exists() or not target.is_file():
        target = (STUDIO_DIR / file_path.lstrip("/")).resolve()

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail=f"Media file not found: {file_path}")

    ctype, _ = mimetypes.guess_type(str(target))
    if not ctype:
        if target.suffix == ".mp4":
            ctype = "video/mp4"
        elif target.suffix in (".m4a", ".aac"):
            ctype = "audio/mp4"
        elif target.suffix == ".mp3":
            ctype = "audio/mpeg"
        else:
            ctype = "application/octet-stream"

    return FileResponse(
        target,
        media_type=ctype,
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
        },
    )
