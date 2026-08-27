from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_ROOT / ".env"


class Settings(BaseSettings):
    environment: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    database_url: str = "postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/socialcontent"
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "socialcontent"
    kafka_bootstrap_servers: str = "localhost:9092"
    disable_kafka: bool = False
    enable_workers: bool = True
    jwt_secret_key: str = "replace-with-at-least-32-random-bytes"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440
    system_bootstrap_token: str = "change-me-bootstrap-token"
    tiktok_client_key: str = Field(default="", validation_alias=AliasChoices("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_ID"))
    tiktok_client_secret: str = Field(default="", validation_alias=AliasChoices("TIKTOK_CLIENT_SECRET"))
    tiktok_redirect_uri: str = Field(default="", validation_alias=AliasChoices("TIKTOK_REDIRECT_URI"))
    tiktok_oauth_scopes: str = Field(
        default="user.info.basic,video.upload,video.publish",
        validation_alias=AliasChoices("TIKTOK_OAUTH_SCOPES", "TIKTOK_SCOPES"),
    )
    scheduler_poll_seconds: int = 60
    enable_scheduler: bool = True
    embedding_service_url: str = "http://localhost:8060"
    planning_orchestrator_url: str = "http://localhost:8050"
    generate_video_service_url: str = "http://localhost:8070"
    embedding_model_name: str = "embedding-service"
    embedding_similarity_threshold: float = 0.62
    openai_api_key: str = Field(default="", validation_alias=AliasChoices("OPENAI_API_KEY"))
    openai_model: str = Field(default="gpt-4o-mini", validation_alias=AliasChoices("OPENAI_MODEL"))
    deepseek_api_key: str = Field(default="", validation_alias=AliasChoices("ACD_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"))
    deepseek_base_url: str = Field(default="https://api.deepseek.com", validation_alias=AliasChoices("ACD_DEEPSEEK_BASE_URL", "DEEPSEEK_BASE_URL"))
    elevenlabs_api_key: str = Field(default="", validation_alias=AliasChoices("ELEVENLABS_API_KEY"))
    generate_video_npm_path: str = Field(
        default="",
        validation_alias=AliasChoices("GENERATE_VIDEO_NPM_PATH", "NPM_BINARY", "NPM_PATH"),
    )
    generate_video_node_path: str = Field(
        default="",
        validation_alias=AliasChoices("GENERATE_VIDEO_NODE_PATH", "NODE_BINARY", "NODE_PATH"),
    )

    model_config = SettingsConfigDict(env_file=str(ENV_FILE), env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
