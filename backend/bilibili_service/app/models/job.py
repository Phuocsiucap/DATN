from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from backend.bilibili_service.app.core.database import Base


def utc_now_dt() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class BilibiliJob(Base):
    __tablename__ = "bilibili_jobs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=True, index=True)
    status = Column(String, nullable=False, index=True)
    stage = Column(String, nullable=False, index=True)
    progress = Column(Integer, nullable=False, default=0)
    input_text = Column(Text, nullable=False)
    niche = Column(String, nullable=False)
    max_duration_seconds = Column(Integer, nullable=False, default=180)
    source_url = Column(Text, nullable=True)
    source_platform = Column(String, nullable=True)
    source_title = Column(Text, nullable=True)
    artifacts_json = Column(Text, nullable=False, default="{}")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now_dt)
    updated_at = Column(DateTime, nullable=False, default=utc_now_dt, onupdate=utc_now_dt)

