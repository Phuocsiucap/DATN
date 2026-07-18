from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.user_service.app.api.routes.auth import get_current_user
from backend.user_service.app.core.database import get_db
from backend.user_service.app.core.security import get_password_hash
from backend.user_service.app.models.user import RefreshToken, Role, User

router = APIRouter()

AllowedRole = Literal["user", "system"]


class AdminUserCreateRequest(BaseModel):
    email: str
    password: str
    roles: List[AllowedRole] = ["user"]
    is_active: bool = True


class AdminUserUpdateRequest(BaseModel):
    email: str | None = None
    password: str | None = None
    roles: List[AllowedRole] | None = None
    is_active: bool | None = None


def _require_system_user(current_user: User):
    if "system" not in {role.name for role in current_user.roles}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ tài khoản system mới được quản lý người dùng",
        )


def _serialize_user(user: User):
    return {
        "id": user.id,
        "email": user.email,
        "roles": [role.name for role in user.roles],
        "is_active": user.is_active,
        "created_at": user.created_at,
    }


def _get_roles(db: Session, role_names: List[str]):
    roles = db.query(Role).filter(Role.name.in_(role_names)).all()
    role_map = {role.name: role for role in roles}
    missing_roles = [role_name for role_name in role_names if role_name not in role_map]
    if missing_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Role không tồn tại: {', '.join(missing_roles)}",
        )
    return [role_map[role_name] for role_name in role_names]


def _normalized_roles(role_names: List[str] | None):
    names = role_names or ["user"]
    unique_names = []
    for role_name in names:
        if role_name not in unique_names:
            unique_names.append(role_name)
    return unique_names


@router.get("")
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_system_user(current_user)
    users = db.query(User).order_by(User.created_at.desc()).all()
    return {"items": [_serialize_user(user) for user in users]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(
    request: AdminUserCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_system_user(current_user)

    email = request.email.strip().lower()
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email không được để trống")
    if len(request.password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu phải có ít nhất 6 ký tự")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email đã tồn tại")

    user = User(
        email=email,
        hashed_password=get_password_hash(request.password),
        is_active=request.is_active,
    )
    user.roles = _get_roles(db, _normalized_roles(request.roles))
    db.add(user)
    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@router.patch("/{user_id}")
def update_user(
    user_id: int,
    request: AdminUserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_system_user(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy user")

    if request.email is not None:
        email = request.email.strip().lower()
        if not email:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email không được để trống")
        duplicate = db.query(User).filter(User.email == email, User.id != user.id).first()
        if duplicate:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email đã tồn tại")
        user.email = email

    if request.password:
        if len(request.password) < 6:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu phải có ít nhất 6 ký tự")
        user.hashed_password = get_password_hash(request.password)
        db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"is_revoked": True})

    if request.roles is not None:
        role_names = _normalized_roles(request.roles)
        if user.id == current_user.id and "system" not in role_names:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Không thể tự gỡ quyền system của chính mình",
            )
        user.roles = _get_roles(db, role_names)

    if request.is_active is not None:
        if user.id == current_user.id and not request.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Không thể tự khóa tài khoản đang đăng nhập",
            )
        user.is_active = request.is_active
        if not request.is_active:
            db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"is_revoked": True})

    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_system_user(current_user)
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không thể tự xóa tài khoản đang đăng nhập",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy user")

    db.delete(user)
    db.commit()
    return {"message": "Đã xóa user"}
