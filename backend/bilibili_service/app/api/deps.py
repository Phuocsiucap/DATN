from __future__ import annotations

from fastapi import Header, HTTPException, status
from pydantic import BaseModel


class CurrentUser(BaseModel):
    id: int


def get_current_user(x_user_id: int | None = Header(default=None, alias="X-User-Id")) -> CurrentUser:
    if x_user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing X-User-Id")
    return CurrentUser(id=x_user_id)

