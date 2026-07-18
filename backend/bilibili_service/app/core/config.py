import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[4]
CONFIG_PATH = Path(os.getenv("ACD_CONFIG_PATH", PROJECT_ROOT / ".env"))


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    data_dir: Path = PROJECT_ROOT / "runtime" / "bilibili"
    max_concurrent_jobs: int = 1
    whisper_model: str = "small"
    whisper_compute_type: str = "int8"
    keyword_provider: str = "deepseek"
    subtitle_provider: str = "deepseek"
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_keyword_model: str = "deepseek-v4-flash"
    deepseek_subtitle_model: str = "deepseek-v4-flash"
    deepseek_reasoning_effort: str = "high"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def output_dir(self) -> Path:
        return self.data_dir / "outputs"

@lru_cache
def get_settings() -> Settings:
    env = {**read_env_file(CONFIG_PATH), **os.environ}
    settings = Settings(
        host=str(env.get("ACD_HOST", "127.0.0.1")),
        port=_int_env(env.get("ACD_PORT"), 8765),
        data_dir=Path(str(env.get("ACD_DATA_DIR", PROJECT_ROOT / "runtime" / "bilibili"))),
        max_concurrent_jobs=_int_env(env.get("ACD_MAX_CONCURRENT_JOBS"), 1),
        whisper_model=str(env.get("ACD_WHISPER_MODEL", "small")),
        whisper_compute_type=str(env.get("ACD_WHISPER_COMPUTE_TYPE", "int8")),
        keyword_provider=str(env.get("ACD_KEYWORD_PROVIDER", "deepseek")),
        subtitle_provider=str(env.get("ACD_SUBTITLE_PROVIDER", "deepseek")),
        deepseek_api_key=str(env.get("ACD_DEEPSEEK_API_KEY") or "") or None,
        deepseek_base_url=str(env.get("ACD_DEEPSEEK_BASE_URL", "https://api.deepseek.com")),
        deepseek_keyword_model=str(env.get("ACD_DEEPSEEK_KEYWORD_MODEL", "deepseek-v4-flash")),
        deepseek_subtitle_model=str(env.get("ACD_DEEPSEEK_SUBTITLE_MODEL", "deepseek-v4-flash")),
        deepseek_reasoning_effort=str(env.get("ACD_DEEPSEEK_REASONING_EFFORT", "high")),
    )
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    return settings


def _int_env(value: str | None, default: int) -> int:
    try:
        return int(value) if value is not None else default
    except ValueError:
        return default


def update_runtime_env(values: dict[str, str]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    current = read_env_file(CONFIG_PATH)
    current.update(values)
    lines = [f"{key}={value}" for key, value in sorted(current.items())]
    CONFIG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    get_settings.cache_clear()


def read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    data: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        data[key.strip()] = value.strip()
    return data
