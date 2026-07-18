from fastapi import APIRouter, Depends, HTTPException

from backend.bilibili_service.app.api.deps import CurrentUser, get_current_user
from backend.bilibili_service.app.schemas.api import (
    KeywordPlanRequest,
    KeywordPlanResponse,
    SearchRequest,
    SearchResponse,
    SeriesInfoRequest,
    SeriesInfoResponse,
    TranslateTitleRequest,
    TranslateTitleResponse,
)
from backend.bilibili_service.app.services.runtime import crawler, keywords
from backend.bilibili_service.app.services.search import search_for_candidates, translate_title_to_vi


router = APIRouter()


@router.post("/keyword-plan", response_model=KeywordPlanResponse)
def create_keyword_plan(req: KeywordPlanRequest, current_user: CurrentUser = Depends(get_current_user)) -> KeywordPlanResponse:
    _ = current_user
    try:
        plan = keywords.build_plan(req.input_text, req.niche)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Keyword LLM planner failed: {exc}") from exc
    return KeywordPlanResponse(**plan.to_dict())


@router.post("/search", response_model=SearchResponse)
def search_candidates(req: SearchRequest, current_user: CurrentUser = Depends(get_current_user)) -> SearchResponse:
    _ = current_user
    try:
        return search_for_candidates(req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Không tìm được video Bilibili phù hợp: {exc}") from exc


@router.post("/series-info", response_model=SeriesInfoResponse)
def get_series_info(req: SeriesInfoRequest, current_user: CurrentUser = Depends(get_current_user)) -> SeriesInfoResponse:
    _ = current_user
    try:
        data = crawler.fetch_bilibili_series_info(url=req.url, aid=req.aid, bvid=req.bvid)
        return SeriesInfoResponse(**data)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Không lấy được thông tin series Bilibili: {exc}") from exc


@router.post("/translate-title", response_model=TranslateTitleResponse)
def translate_title(req: TranslateTitleRequest, current_user: CurrentUser = Depends(get_current_user)) -> TranslateTitleResponse:
    _ = current_user
    return translate_title_to_vi(req.title)
