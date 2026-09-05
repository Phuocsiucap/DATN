"""
Storage configuration for file uploads (avatars, media, etc.)

This module provides a centralized configuration for file storage.
Easy to switch between local storage and cloud storage (S3, GCS, etc.)
"""

import os
from pathlib import Path
from typing import Literal

StorageBackend = Literal["local", "s3", "gcs"]


class StorageConfig:
    """Storage configuration"""
    
    # Storage backend (local, s3, gcs)
    BACKEND: StorageBackend = os.getenv("STORAGE_BACKEND", "local")
    
    # Local storage configuration
    LOCAL_ROOT = Path(__file__).parent.parent.parent / "runtime"
    
    # Avatar storage
    AVATAR_DIR = LOCAL_ROOT / "avatars"
    AVATAR_MAX_SIZE = 5 * 1024 * 1024  # 5MB
    AVATAR_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
    
    # S3 configuration (for future use)
    S3_BUCKET = os.getenv("S3_BUCKET", "")
    S3_REGION = os.getenv("S3_REGION", "ap-southeast-1")
    S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "")
    S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "")
    S3_AVATAR_PREFIX = "avatars/"
    
    # GCS configuration (for future use)
    GCS_BUCKET = os.getenv("GCS_BUCKET", "")
    GCS_PROJECT_ID = os.getenv("GCS_PROJECT_ID", "")
    GCS_AVATAR_PREFIX = "avatars/"
    
    @classmethod
    def get_avatar_base_url(cls, request_base_url: str) -> str:
        """Get base URL for avatars based on storage backend"""
        if cls.BACKEND == "local":
            return f"{request_base_url.rstrip('/')}/avatars"
        elif cls.BACKEND == "s3":
            return f"https://{cls.S3_BUCKET}.s3.{cls.S3_REGION}.amazonaws.com/{cls.S3_AVATAR_PREFIX}"
        elif cls.BACKEND == "gcs":
            return f"https://storage.googleapis.com/{cls.GCS_BUCKET}/{cls.GCS_AVATAR_PREFIX}"
        return request_base_url


# Storage configuration instance
storage_config = StorageConfig()
