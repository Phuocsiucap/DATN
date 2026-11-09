from __future__ import annotations

from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from common.db.models import PromptRun, Role, User
from common.security.passwords import hash_password
from app.schemas import api as schemas


def to_user_response(user: User) -> schemas.UserResponse:
    return schemas.UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
        is_active=user.is_active,
        is_system_admin=user.is_system_admin,
        created_at=user.created_at,
        roles=[role.name for role in user.roles],
    )


class UserService:
    def get_all_users_ai_usage(self, db: Session) -> list[dict]:
        input_tokens = func.coalesce(PromptRun.input_tokens, 0)
        output_tokens = func.coalesce(PromptRun.output_tokens, 0)
        total_tokens = case(
            (
                or_(PromptRun.total_tokens.is_(None), PromptRun.total_tokens == 0),
                input_tokens + output_tokens,
            ),
            else_=PromptRun.total_tokens,
        )

        rows = (
            db.query(
                User.id.label("user_id"),
                User.full_name.label("full_name"),
                User.email.label("email"),
                PromptRun.run_type.label("run_type"),
                PromptRun.model_provider.label("model_provider"),
                PromptRun.model_name.label("model_name"),
                func.coalesce(func.sum(input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(total_tokens), 0).label("total_tokens"),
                func.coalesce(func.sum(PromptRun.cost_usd), 0.0).label("cost_usd"),
                func.count(PromptRun.id).label("runs_count"),
            )
            .outerjoin(PromptRun, PromptRun.user_id == User.id)
            .group_by(
                User.id,
                User.full_name,
                User.email,
                PromptRun.run_type,
                PromptRun.model_provider,
                PromptRun.model_name,
            )
            .all()
        )

        users: dict[str, dict] = {}
        for row in rows:
            user_id = str(row.user_id)
            summary = users.setdefault(
                user_id,
                {
                    "user_id": user_id,
                    "full_name": row.full_name,
                    "email": row.email,
                    "total_input_tokens": 0,
                    "total_output_tokens": 0,
                    "total_tokens": 0,
                    "total_cost_usd": 0.0,
                    "prompt_runs_count": 0,
                    "breakdown_by_run_type": {},
                    "breakdown_by_model": {},
                },
            )
            summary["total_input_tokens"] += int(row.input_tokens or 0)
            summary["total_output_tokens"] += int(row.output_tokens or 0)
            summary["total_tokens"] += int(row.total_tokens or 0)
            summary["total_cost_usd"] += float(row.cost_usd or 0.0)
            summary["prompt_runs_count"] += int(row.runs_count or 0)

            if not row.runs_count:
                continue

            run_type = str(row.run_type or "UNKNOWN")
            model = f"{row.model_provider or 'unknown'}:{row.model_name or 'unknown'}"
            for key, bucket_key in (
                (run_type, "breakdown_by_run_type"),
                (model, "breakdown_by_model"),
            ):
                bucket = summary[bucket_key].setdefault(
                    key,
                    {
                        "runs": 0,
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "total_tokens": 0,
                        "cost_usd": 0.0,
                    },
                )
                bucket["runs"] += int(row.runs_count)
                bucket["input_tokens"] += int(row.input_tokens or 0)
                bucket["output_tokens"] += int(row.output_tokens or 0)
                bucket["total_tokens"] += int(row.total_tokens or 0)
                bucket["cost_usd"] += float(row.cost_usd or 0.0)

        result = []
        for summary in users.values():
            summary["total_cost_usd"] = round(summary["total_cost_usd"], 6)
            for breakdown_key in ("breakdown_by_run_type", "breakdown_by_model"):
                summary[breakdown_key] = [
                    {
                        "key": key,
                        **bucket,
                        "cost_usd": round(bucket["cost_usd"], 6),
                    }
                    for key, bucket in sorted(
                        summary[breakdown_key].items(),
                        key=lambda item: item[1]["cost_usd"],
                        reverse=True,
                    )
                ]
            result.append(summary)
        return result

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
        role = db.query(Role).filter(Role.name == "CREATOR").first()
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
        if payload.avatar_url is not None:
            user.avatar_url = payload.avatar_url
        if payload.is_active is not None:
            user.is_active = payload.is_active
        if payload.roles is not None:
            roles = self.get_roles(db, self.normalized_roles(payload.roles))
            user.roles = roles
            user.is_system_admin = any(role.name == "SYSTEM_ADMIN" for role in roles)
        db.commit()
        db.refresh(user)
        return user

    def update_my_profile(self, db: Session, user: User, payload: schemas.MyProfileUpdateRequest) -> User:
        if payload.password:
            user.hashed_password = hash_password(payload.password)
        if payload.full_name is not None:
            user.full_name = payload.full_name
        if payload.email is not None:
            user.email = payload.email.strip().lower()
        if payload.avatar_url is not None:
            user.avatar_url = payload.avatar_url
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
