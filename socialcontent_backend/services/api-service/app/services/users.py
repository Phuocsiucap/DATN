from __future__ import annotations

from sqlalchemy.orm import Session

from common.db.models import Role, User
from common.security.passwords import hash_password
from app.schemas import api as schemas


def to_user_response(user: User) -> schemas.UserResponse:
    return schemas.UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        is_system_admin=user.is_system_admin,
        created_at=user.created_at,
        roles=[role.name for role in user.roles],
    )


class UserService:
    def create_user_by_admin(self, db: Session, payload: schemas.AdminUserCreateRequest) -> User:
        roles = self.get_roles(db, self.normalized_roles(payload.roles))
        user = User(
            email=payload.email.strip().lower(),
            full_name=payload.full_name,
            hashed_password=hash_password(payload.password),
            is_active=payload.is_active,
            is_system_admin=any(role.name == "SYSTEM_ADMIN" for role in roles),
        )
        user.roles = roles
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def create_standard_user(self, db: Session, payload: schemas.RegisterRequest) -> User:
        role = db.query(Role).filter(Role.name.in_(["CREATOR", "USER"])).first()
        user = User(email=payload.email, full_name=payload.full_name, hashed_password=hash_password(payload.password))
        if role:
            user.roles.append(role)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def create_system_admin(self, db: Session, payload: schemas.BootstrapAdminRequest) -> User:
        role = db.query(Role).filter(Role.name == "SYSTEM_ADMIN").first()
        user = User(
            email=payload.email,
            full_name=payload.full_name,
            hashed_password=hash_password(payload.password),
            is_system_admin=True,
        )
        if role:
            user.roles.append(role)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def update_user(self, db: Session, user: User, payload: schemas.UserUpdateRequest) -> User:
        if payload.email is not None:
            user.email = payload.email.strip().lower()
        if payload.password:
            user.hashed_password = hash_password(payload.password)
        if payload.full_name is not None:
            user.full_name = payload.full_name
        if payload.is_active is not None:
            user.is_active = payload.is_active
        if payload.roles is not None:
            roles = self.get_roles(db, self.normalized_roles(payload.roles))
            user.roles = roles
            user.is_system_admin = any(role.name == "SYSTEM_ADMIN" for role in roles)
        db.commit()
        db.refresh(user)
        return user

    def get_roles(self, db: Session, role_names: list[str]) -> list[Role]:
        roles = db.query(Role).filter(Role.name.in_(role_names)).all()
        role_map = {role.name: role for role in roles}
        missing = [role_name for role_name in role_names if role_name not in role_map]
        if missing:
            from fastapi import HTTPException, status

            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Role không tồn tại: {', '.join(missing)}")
        return [role_map[role_name] for role_name in role_names]

    def normalized_roles(self, role_names: list[str] | None) -> list[str]:
        names = role_names or ["CREATOR"]
        normalized: list[str] = []
        for role_name in names:
            value = role_name.strip().upper()
            if value == "USER":
                value = "CREATOR"
            elif value == "ADMIN":
                value = "SYSTEM_ADMIN"
            if value and value not in normalized:
                normalized.append(value)
        return normalized or ["CREATOR"]
