from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError
from sqlalchemy.orm import Session

from common.db.models import User
from common.db.session import get_db
from common.security.jwt import decode_access_token


bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = uuid.UUID(str(payload["sub"]))
    except (KeyError, ValueError, PyJWTError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    role_names = {role.name for role in user.roles}
    if user.is_system_admin or "SYSTEM_ADMIN" in role_names or "ADMIN" in role_names:
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


def require_system_admin(user: User = Depends(get_current_user)) -> User:
    role_names = {role.name for role in user.roles}
    if user.is_system_admin or "SYSTEM_ADMIN" in role_names:
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System admin access required")
