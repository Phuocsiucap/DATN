from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/socialcontent"
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "socialcontent"
    kafka_bootstrap_servers: str = "localhost:9092"
    disable_kafka: bool = False
    enable_workers: bool = True
    jwt_secret_key: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440
    system_bootstrap_token: str = "change-me-bootstrap-token"
    tiktok_qr_login_url: str = "https://www.tiktok.com/login/qrcode"
    browser_channel: str = Field(
        default="chrome",
        validation_alias=AliasChoices("BROWSER_CHANNEL", "TIKTOK_QR_BROWSER_CHANNEL"),
    )
    browser_headless: bool = Field(
        default=False,
        validation_alias=AliasChoices("BROWSER_HEADLESS", "TIKTOK_QR_HEADLESS"),
    )
    scheduler_poll_seconds: int = 60
    enable_scheduler: bool = True

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
