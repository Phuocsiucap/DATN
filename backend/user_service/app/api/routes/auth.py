from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from backend.user_service.app.core.database import get_db
from backend.user_service.app.models.user import User, Role, RefreshToken
from backend.user_service.app.core.security import verify_password, get_password_hash, create_access_token, create_refresh_token
import jwt
from backend.user_service.app.core.security import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS
from datetime import datetime, timedelta
from typing import List, Literal

router = APIRouter()

class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    roles: List[Literal["user", "system"]] = ["user"]

@router.post("/login")
def login(request: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email hoặc mật khẩu không chính xác",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị khóa",
        )
    
    # Generate tokens
    roles = [role.name for role in user.roles]
    access_token = create_access_token(data={"sub": user.email, "user_id": user.id, "roles": roles})
    refresh_token = create_refresh_token()
    
    # Save Refresh Token to Database
    expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    db_refresh_token = RefreshToken(
        token=refresh_token,
        user_id=user.id,
        expires_at=expires_at
    )
    db.add(db_refresh_token)
    db.commit()
    
    # Set HTTP-only cookies
    response.set_cookie(
        key="access_token",
        value=f"Bearer {access_token}",
        httponly=True,
        samesite="lax",
        max_age=60 * ACCESS_TOKEN_EXPIRE_MINUTES,
        # secure=True # Bật lên nếu dùng HTTPS
    )
    
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * REFRESH_TOKEN_EXPIRE_DAYS,
        # secure=True
    )
    
    return {
        "message": "Đăng nhập thành công",
        "user": {
            "id": user.id,
            "email": user.email,
            "roles": roles
        }
    }

@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(key="access_token")
    response.delete_cookie(key="refresh_token")
    return {"message": "Đăng xuất thành công"}

@router.post("/refresh")
def refresh_token(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Không có refresh token")

    db_token = db.query(RefreshToken).filter(RefreshToken.token == token).first()
    if not db_token:
        raise HTTPException(status_code=401, detail="Refresh token không hợp lệ")
    
    if db_token.is_revoked or db_token.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Refresh token đã hết hạn hoặc bị thu hồi")

    user = db_token.user
    if not user.is_active:
        db_token.is_revoked = True
        db.commit()
        raise HTTPException(status_code=403, detail="Tài khoản đã bị khóa")

    roles = [role.name for role in user.roles]
    access_token = create_access_token(data={"sub": user.email, "user_id": user.id, "roles": roles})
    
    response.set_cookie(
        key="access_token",
        value=f"Bearer {access_token}",
        httponly=True,
        samesite="lax",
        max_age=60 * ACCESS_TOKEN_EXPIRE_MINUTES,
    )
    
    return {"message": "Đã làm mới token"}

# Dependency để lấy User hiện tại từ Cookie
def get_current_user(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")
    
    try:
        scheme, _, token_value = token.partition(" ")
        payload = jwt.decode(token_value, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="Token không hợp lệ")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Token không hợp lệ hoặc đã hết hạn")
        
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User không tồn tại")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Tài khoản đã bị khóa")
    return user


@router.post("/register")
def register(
    request: RegisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_roles = {role.name for role in current_user.roles}
    if "system" not in current_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chỉ tài khoản system mới được tạo user")

    email = request.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email đã tồn tại")

    user = User(email=email, hashed_password=get_password_hash(request.password))
    db.add(user)
    db.flush()

    role_names = request.roles or ["user"]
    roles = db.query(Role).filter(Role.name.in_(role_names)).all()
    if not roles:
        roles = [db.query(Role).filter(Role.name == "user").first()]

    user.roles = [role for role in roles if role is not None]
    db.commit()
    db.refresh(user)

    return {
        "message": "Tạo tài khoản thành công",
        "user": {
            "id": user.id,
            "email": user.email,
            "roles": [role.name for role in user.roles],
        },
    }


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "roles": [role.name for role in current_user.roles],
        "is_active": current_user.is_active,
        "created_at": current_user.created_at,
    }
