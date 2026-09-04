from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str | None
    is_active: bool
    is_system_admin: bool
    created_at: datetime
    roles: list[str] = []


class UserUpdateRequest(BaseModel):
    email: str | None = None
    password: str | None = None
    full_name: str | None = None
    is_active: bool | None = None
    roles: list[str] | None = None


class MyProfileUpdateRequest(BaseModel):
    full_name: str | None = None
    password: str | None = None


class AdminUserCreateRequest(BaseModel):
    email: str
    password: str
    full_name: str | None = None
    roles: list[str] = ["USER"]
    is_active: bool = True
