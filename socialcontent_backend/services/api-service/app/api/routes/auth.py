import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jwt import PyJWTError
from sqlalchemy.orm import Session

from common.db.models import Role, User
from common.db.session import get_db
from common.security.jwt import create_access_token
from common.security.jwt import decode_access_token
from common.security.passwords import verify_password
from app.api.deps import get_current_user
from app.schemas import api as schemas
from app.services.users import UserService, to_user_response

router = APIRouter()

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_TOKEN_DAYS = 30


def _role_names(user: User) -> list[str]:
    return [role.name for role in user.roles]


def _create_user_access_token(user: User) -> str:
    return create_access_token(str(user.id), {"roles": _role_names(user), "is_system_admin": user.is_system_admin, "token_type": "access"})


def _create_refresh_token(user: User) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS)
    return create_access_token(
        str(user.id),
        {
            "roles": _role_names(user),
            "is_system_admin": user.is_system_admin,
            "token_type": "refresh",
            "exp": expires_at,
        },
    )


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=REFRESH_TOKEN_DAYS * 24 * 60 * 60,
        path="/api/v1/auth",
    )


@router.post("/register", response_model=schemas.UserResponse)
def register(payload: schemas.RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = UserService().create_standard_user(db, payload)
    return to_user_response(user)


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    token = _create_user_access_token(user)
    _set_refresh_cookie(response, _create_refresh_token(user))
    return schemas.TokenResponse(access_token=token)


@router.get("/me", response_model=schemas.UserResponse)
def auth_me(user: User = Depends(get_current_user)):
    return to_user_response(user)


@router.post("/refresh", response_model=schemas.TokenResponse)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
    try:
        payload = decode_access_token(token)
        if payload.get("token_type") != "refresh":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
        user_id = uuid.UUID(str(payload["sub"]))
    except (KeyError, ValueError, PyJWTError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")
    access_token = _create_user_access_token(user)
    _set_refresh_cookie(response, _create_refresh_token(user))
    return schemas.TokenResponse(access_token=access_token)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/api/v1/auth")
    return {"status": "ok"}
