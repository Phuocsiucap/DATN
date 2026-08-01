import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from common.db.models import User
from common.db.session import get_db
from app.schemas import api as schemas
from app.api.deps import get_current_user, require_admin, require_system_admin
from app.services.users import UserService, to_user_response

router = APIRouter()


@router.get("/me", response_model=schemas.UserResponse)
def me(user: User = Depends(get_current_user)):
    return to_user_response(user)


@router.get("", response_model=list[schemas.UserResponse])
def list_users(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    return [to_user_response(user) for user in db.query(User).order_by(User.created_at.desc()).all()]


@router.post("", response_model=schemas.UserResponse)
def create_user(payload: schemas.AdminUserCreateRequest, _: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email không được để trống")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu phải có ít nhất 6 ký tự")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email đã tồn tại")
    normalized_payload = payload.model_copy(update={"email": email})
    user = UserService().create_user_by_admin(db, normalized_payload)
    return to_user_response(user)


@router.patch("/{user_id}", response_model=schemas.UserResponse)
def update_user(user_id: uuid.UUID, payload: schemas.UserUpdateRequest, current_user: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.email is not None:
        email = payload.email.strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail="Email không được để trống")
        duplicate = db.query(User).filter(User.email == email, User.id != user.id).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Email đã tồn tại")
    if payload.password and len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu phải có ít nhất 6 ký tự")
    if payload.roles is not None and user.id == current_user.id:
        normalized_roles = UserService().normalized_roles(payload.roles)
        if "SYSTEM_ADMIN" not in normalized_roles:
            raise HTTPException(status_code=400, detail="Không thể tự gỡ quyền SYSTEM_ADMIN của chính mình")
    if payload.is_active is False and user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản đang đăng nhập")
    updated = UserService().update_user(db, user, payload)
    return to_user_response(updated)


@router.delete("/{user_id}")
def delete_user(user_id: uuid.UUID, current_user: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Không thể tự xóa tài khoản đang đăng nhập")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"message": "Đã xóa user"}
