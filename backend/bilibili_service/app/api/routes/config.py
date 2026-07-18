from fastapi import APIRouter, Depends

from backend.bilibili_service.app.api.deps import CurrentUser, get_current_user
from backend.bilibili_service.app.core.config import CONFIG_PATH, get_settings, update_runtime_env
from backend.bilibili_service.app.integrations.bilibili.deepseek_client import deepseek_client
from backend.bilibili_service.app.schemas.api import DeepSeekConfigRequest, DeepSeekConfigResponse


router = APIRouter()


@router.get("/deepseek", response_model=DeepSeekConfigResponse)
def get_deepseek_config(current_user: CurrentUser = Depends(get_current_user)) -> DeepSeekConfigResponse:
    _ = current_user
    settings = get_settings()
    return DeepSeekConfigResponse(
        api_key_masked=mask_secret(settings.deepseek_api_key or ""),
        has_api_key=bool(settings.deepseek_api_key),
        base_url=settings.deepseek_base_url,
        keyword_model=settings.deepseek_keyword_model,
        subtitle_model=settings.deepseek_subtitle_model,
        reasoning_effort=settings.deepseek_reasoning_effort or "",
        config_path=str(CONFIG_PATH),
    )


@router.put("/deepseek", response_model=DeepSeekConfigResponse)
def update_deepseek_config(req: DeepSeekConfigRequest, current_user: CurrentUser = Depends(get_current_user)) -> DeepSeekConfigResponse:
    values = {
        "ACD_DEEPSEEK_BASE_URL": req.base_url.strip() or "https://api.deepseek.com",
        "ACD_DEEPSEEK_KEYWORD_MODEL": req.keyword_model.strip() or "deepseek-v4-flash",
        "ACD_DEEPSEEK_SUBTITLE_MODEL": req.subtitle_model.strip() or "deepseek-v4-flash",
        "ACD_DEEPSEEK_REASONING_EFFORT": req.reasoning_effort.strip(),
        "ACD_KEYWORD_PROVIDER": "deepseek",
        "ACD_SUBTITLE_PROVIDER": "deepseek",
    }
    if req.api_key and req.api_key.strip():
        values["ACD_DEEPSEEK_API_KEY"] = req.api_key.strip()
    update_runtime_env(values)
    deepseek_client.cache_clear()
    return get_deepseek_config(current_user)


def mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 10:
        return "*" * len(value)
    return f"{value[:5]}...{value[-4:]}"
