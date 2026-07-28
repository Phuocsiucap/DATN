from typing import Any

from pydantic import BaseModel, Field, HttpUrl

from backend.bilibili_service.app.schemas.domain import JobStatus, Niche, PipelineStage


class CreateJobRequest(BaseModel):
    input_text: str = Field(min_length=1, max_length=600)
    niche: Niche = Niche.smart_home
    source_url: HttpUrl | None = None
    source_platform: str | None = None
    source_title: str | None = None
    max_duration_seconds: int = Field(default=7200, ge=15, le=14400)


class KeywordPlanRequest(BaseModel):
    input_text: str = Field(min_length=1, max_length=600)
    niche: Niche = Niche.smart_home


class KeywordPlanResponse(BaseModel):
    source_text_vi: str
    keyword_zh: str
    queries: list[str]
    platform_priority: list[str]
    provider: str
    inferred_niche: str = "generic"
    confidence: float = 0.0
    reasoning: str = ""


class SearchRequest(BaseModel):
    input_text: str = Field(default="", max_length=600)
    sources: list[str] = Field(default_factory=lambda: ["bilibili"])
    max_duration_seconds: int = Field(default=7200, ge=15, le=14400)
    mode: str = Field(default="keyword", pattern="^(keyword|trending|link)$")
    limit: int = Field(default=30, ge=5, le=80)


class SearchCandidateResponse(BaseModel):
    title: str
    title_vi: str | None = None
    url: str
    aid: int | None = None
    bvid: str | None = None
    platform: str
    duration_seconds: int | None = None
    query: str
    thumbnail_url: str | None = None
    description: str | None = None
    review_count: int | None = None
    danmaku_count: int | None = None
    episode_count_text: str | None = None
    embed_url: str | None = None
    preview_mode: str = "iframe"
    downloadable: bool = True
    availability_note: str | None = None
    series_key: str | None = None
    series_title: str | None = None
    episode_index: int | None = None
    playlist_size: int | None = None


class SearchResponse(BaseModel):
    keyword_plan: KeywordPlanResponse
    candidates: list[SearchCandidateResponse]


class VideoDetailItemResponse(BaseModel):
    title: str
    url: str
    aid: int | None = None
    bvid: str | None = None
    platform: str
    duration_seconds: int | None = None
    thumbnail_url: str | None = None
    description: str | None = None
    embed_url: str | None = None
    preview_mode: str = "iframe"
    downloadable: bool = True


class VideoDetailEpisodeResponse(VideoDetailItemResponse):
    query: str = "view_detail_pages"
    episode_index: int | None = None
    playlist_size: int | None = None


class VideoDetailRelatedResponse(VideoDetailItemResponse):
    query: str = "related"


class SeriesInfoRequest(BaseModel):
    url: str | None = None
    aid: int | None = None
    bvid: str | None = None


class SeriesInfoResponse(BaseModel):
    aid: int | None = None
    bvid: str | None = None
    title: str = ""
    episode_count: int = 0
    related_count: int = 0
    source: str = "view_detail"
    season_id: int | None = None
    season_title: str | None = None
    current: SearchCandidateResponse | None = None
    episodes: list[VideoDetailEpisodeResponse] = Field(default_factory=list)
    related: list[VideoDetailRelatedResponse] = Field(default_factory=list)


class PreviewUrlRequest(BaseModel):
    url: HttpUrl


class PreviewUrlResponse(BaseModel):
    url: str
    title: str | None = None
    duration_seconds: int | None = None


class TranslateTitleRequest(BaseModel):
    title: str = Field(min_length=1, max_length=500)


class TranslateTitleResponse(BaseModel):
    title: str
    title_vi: str


class TikTokMetadataResponse(BaseModel):
    title: str
    description: str
    hashtags: list[str]
    hook: str = ""
    source_summary: str = ""


class SubtitleStyleRequest(BaseModel):
    font_size: int = Field(default=16, ge=12, le=34)
    position: str = Field(default="bottom", pattern="^(bottom|middle|top)$")


class VideoFilterRequest(BaseModel):
    preset: str = Field(default="studio_bright", pattern="^(studio_bright|cinematic_dark|warm_pop|cool_clean|natural)$")
    speed: float = Field(default=1.05, ge=0.9, le=1.15)


class DeepSeekConfigRequest(BaseModel):
    api_key: str | None = Field(default=None, max_length=200)
    base_url: str = Field(default="https://api.deepseek.com", max_length=300)
    keyword_model: str = Field(default="deepseek-v4-flash", max_length=120)
    subtitle_model: str = Field(default="deepseek-v4-flash", max_length=120)
    reasoning_effort: str = Field(default="", max_length=30)


class DeepSeekConfigResponse(BaseModel):
    api_key_masked: str = ""
    has_api_key: bool = False
    base_url: str
    keyword_model: str
    subtitle_model: str
    reasoning_effort: str = ""
    config_path: str


class JobRecord(BaseModel):
    id: int
    user_id: int | None = None
    status: JobStatus
    stage: PipelineStage
    progress: int
    input_text: str
    niche: Niche
    max_duration_seconds: int = 180
    source_url: str | None = None
    artifacts: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None
    created_at: str
    updated_at: str




class MergePartsRequest(BaseModel):
    segment_indexes: list[int]

class MergeJobsRequest(BaseModel):
    job_ids: list[int]

