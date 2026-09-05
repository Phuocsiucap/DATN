import uuid
from collections import defaultdict
from typing import Optional
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Request
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

from common.db.models import AuditLog, PromptRun, Role, User
from common.db.session import get_db
from common.storage.config import storage_config
from app.schemas import api as schemas
from app.api.deps import get_current_user, require_admin, require_system_admin
from app.services.users import UserService, to_user_response

router = APIRouter()


def save_avatar_file(file: UploadFile, user_id: uuid.UUID, request: Request) -> str:
    """
    Save uploaded avatar file and return the full URL.
    
    Currently uses local storage, but designed to easily switch to cloud storage.
    Set STORAGE_BACKEND=s3 or STORAGE_BACKEND=gcs to use cloud storage.
    """
    # Create upload directory if it doesn't exist (local storage only)
    if storage_config.BACKEND == "local":
        storage_config.AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    
    # Validate file extension
    file_ext = Path(file.filename).suffix.lower() if file.filename else ""
    if file_ext not in storage_config.AVATAR_ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Định dạng file không được hỗ trợ. Chỉ chấp nhận: {', '.join(storage_config.AVATAR_ALLOWED_EXTENSIONS)}"
        )
    
    # Generate unique filename
    filename = f"{user_id}{file_ext}"
    
    # Read file content
    try:
        content = file.file.read()
        if len(content) > storage_config.AVATAR_MAX_SIZE:
            raise HTTPException(
                status_code=400, 
                detail=f"File quá lớn. Kích thước tối đa: {storage_config.AVATAR_MAX_SIZE // (1024*1024)}MB"
            )
        
        # Save based on storage backend
        if storage_config.BACKEND == "local":
            file_path = storage_config.AVATAR_DIR / filename
            with open(file_path, "wb") as f:
                f.write(content)
            
            # Return full URL
            base_url = str(request.base_url).rstrip('/')
            return f"{base_url}/avatars/{filename}"
        
        elif storage_config.BACKEND == "s3":
            # TODO: Implement S3 upload
            # import boto3
            # s3_client = boto3.client('s3')
            # s3_client.put_object(
            #     Bucket=storage_config.S3_BUCKET,
            #     Key=f"{storage_config.S3_AVATAR_PREFIX}{filename}",
            #     Body=content
            # )
            base_url = storage_config.get_avatar_base_url("")
            return f"{base_url}/{filename}"
        
        elif storage_config.BACKEND == "gcs":
            # TODO: Implement GCS upload
            # from google.cloud import storage
            # client = storage.Client(project=storage_config.GCS_PROJECT_ID)
            # bucket = client.bucket(storage_config.GCS_BUCKET)
            # blob = bucket.blob(f"{storage_config.GCS_AVATAR_PREFIX}{filename}")
            # blob.upload_from_string(content)
            base_url = storage_config.get_avatar_base_url("")
            return f"{base_url}/{filename}"
        
        else:
            raise HTTPException(status_code=500, detail="Unsupported storage backend")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi lưu file: {str(e)}")
    finally:
        file.file.close()


@router.post("/me/avatar", response_model=dict)
def upload_my_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    request: Request = None
):
    """Upload avatar image for current user."""
    avatar_url = save_avatar_file(file, user.id, request)
    
    # Update user's avatar_url
    user.avatar_url = avatar_url
    db.commit()
    db.refresh(user)
    
    return {"avatar_url": avatar_url, "message": "Cập nhật ảnh đại diện thành công"}


@router.get("/me/ai-usage")
def get_my_ai_usage(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get AI consumption billing and token usage breakdown for current user."""
    runs = db.query(PromptRun).filter(PromptRun.user_id == user.id).order_by(PromptRun.created_at.desc()).all()
    
    total_input = sum(r.input_tokens or 0 for r in runs)
    total_output = sum(r.output_tokens or 0 for r in runs)
    total_tokens = sum(r.total_tokens or (r.input_tokens or 0) + (r.output_tokens or 0) for r in runs)
    total_cost = sum(r.cost_usd or 0.0 for r in runs)

    recent = [
        {
            "id": str(r.id),
            "run_type": r.run_type,
            "step_name": r.step_name,
            "reference_id": str(r.reference_id) if r.reference_id else None,
            "model_provider": r.model_provider,
            "model_name": r.model_name,
            "input_tokens": r.input_tokens,
            "output_tokens": r.output_tokens,
            "total_tokens": r.total_tokens,
            "cost_usd": r.cost_usd,
            "latency_ms": r.latency_ms,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in runs[:20]
    ]

    return {
        "user_id": str(user.id),
        "email": user.email,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_tokens": total_tokens,
        "total_cost_usd": round(total_cost, 6),
        "prompt_runs_count": len(runs),
        "breakdown_by_run_type": _usage_breakdown(runs, lambda run: run.run_type or "UNKNOWN"),
        "breakdown_by_model": _usage_breakdown(runs, lambda run: f"{run.model_provider or 'unknown'}:{run.model_name or 'unknown'}"),
        "recent_runs": recent,
    }


@router.get("/ai-usage-summary")
def get_all_users_ai_usage(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Get aggregated AI usage and billing statistics across all users (Admin only)."""
    users = db.query(User).all()
    summary = []

    for u in users:
        runs = db.query(PromptRun).filter(PromptRun.user_id == u.id).all()
        in_tok = sum(r.input_tokens or 0 for r in runs)
        out_tok = sum(r.output_tokens or 0 for r in runs)
        tot_tok = sum(r.total_tokens or (r.input_tokens or 0) + (r.output_tokens or 0) for r in runs)
        cost = sum(r.cost_usd or 0.0 for r in runs)

        summary.append(
            {
                "user_id": str(u.id),
                "full_name": u.full_name,
                "email": u.email,
                "total_input_tokens": in_tok,
                "total_output_tokens": out_tok,
                "total_tokens": tot_tok,
                "total_cost_usd": round(cost, 6),
                "prompt_runs_count": len(runs),
                "breakdown_by_run_type": _usage_breakdown(runs, lambda run: run.run_type or "UNKNOWN"),
                "breakdown_by_model": _usage_breakdown(runs, lambda run: f"{run.model_provider or 'unknown'}:{run.model_name or 'unknown'}"),
            }
        )

    return {"users_ai_usage": summary}


def _usage_breakdown(runs: list[PromptRun], key_fn) -> list[dict]:
    buckets: dict[str, dict] = defaultdict(
        lambda: {
            "runs": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
        }
    )
    for run in runs:
        key = str(key_fn(run))
        bucket = buckets[key]
        bucket["runs"] += 1
        bucket["input_tokens"] += run.input_tokens or 0
        bucket["output_tokens"] += run.output_tokens or 0
        bucket["total_tokens"] += run.total_tokens or (run.input_tokens or 0) + (run.output_tokens or 0)
        bucket["cost_usd"] += run.cost_usd or 0.0

    return [
        {
            "key": key,
            "runs": value["runs"],
            "input_tokens": value["input_tokens"],
            "output_tokens": value["output_tokens"],
            "total_tokens": value["total_tokens"],
            "cost_usd": round(value["cost_usd"], 6),
        }
        for key, value in sorted(buckets.items(), key=lambda item: item[1]["cost_usd"], reverse=True)
    ]


@router.get("")
def list_users(
    search: Optional[str] = Query(None, description="Tìm theo email hoặc họ tên (case-insensitive)"),
    role: Optional[str] = Query(None, description="Lọc theo tên vai trò, vd: CREATOR, SYSTEM_ADMIN"),
    is_active: Optional[bool] = Query(None, description="Lọc theo trạng thái kích hoạt"),
    page: int = Query(1, ge=1, description="Trang hiện tại"),
    limit: int = Query(10, ge=1, le=100, description="Số lượng bản ghi trên mỗi trang"),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """List users with optional server-side search, filters, and standard pagination (Admin only)."""
    q = db.query(User).options(joinedload(User.roles))

    if search:
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                User.email.ilike(term),
                User.full_name.ilike(term),
            )
        )

    if is_active is not None:
        q = q.filter(User.is_active == is_active)

    if role:
        normalized_role = role.strip().upper()
        q = q.join(User.roles).filter(Role.name == normalized_role)

    users_list = q.order_by(User.created_at.desc()).all()
    total = len(users_list)

    def is_admin(u: User):
        return any(r.name in ["SYSTEM_ADMIN", "SYSTEM", "ADMIN"] for r in u.roles)

    # Sort users: Admins first (0), then others (1). Stable sort preserves created_at.desc()
    sorted_users = sorted(users_list, key=lambda u: 0 if is_admin(u) else 1)

    start = (page - 1) * limit
    end = start + limit
    paginated_users = sorted_users[start:end]

    return {
        "items": [to_user_response(u) for u in paginated_users],
        "total": total,
        "page": page,
        "limit": limit,
    }



@router.post("", response_model=schemas.UserResponse, status_code=201)
def create_user(payload: schemas.AdminUserCreateRequest, current_user: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email không được để trống")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu phải có ít nhất 6 ký tự")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="Email đã tồn tại")
    normalized_payload = payload.model_copy(update={"email": email})
    user = UserService().create_user_by_admin(db, normalized_payload)
    db.add(
        AuditLog(
            actor_id=current_user.id,
            action="user.created",
            target_type="user",
            target_id=str(user.id),
            metadata_json={
                "email": user.email,
                "full_name": user.full_name,
                "roles": [role.name for role in user.roles],
                "is_active": user.is_active,
            },
        )
    )
    db.commit()
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
            raise HTTPException(status_code=409, detail="Email đã tồn tại")
    if payload.password and len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu phải có ít nhất 6 ký tự")
    if payload.roles is not None and user.id == current_user.id:
        normalized_roles = UserService().normalized_roles(payload.roles)
        if "SYSTEM_ADMIN" not in normalized_roles:
            raise HTTPException(status_code=400, detail="Không thể tự gỡ quyền SYSTEM_ADMIN của chính mình")
    if payload.is_active is False and user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản đang đăng nhập")
    before = {
        "email": user.email,
        "full_name": user.full_name,
        "is_active": user.is_active,
        "roles": [role.name for role in user.roles],
    }
    updated = UserService().update_user(db, user, payload)
    after = {
        "email": updated.email,
        "full_name": updated.full_name,
        "is_active": updated.is_active,
        "roles": [role.name for role in updated.roles],
    }
    changed_fields = [key for key in before if before[key] != after[key]]
    if payload.password:
        changed_fields.append("password")
    db.add(
        AuditLog(
            actor_id=current_user.id,
            action="user.updated",
            target_type="user",
            target_id=str(updated.id),
            metadata_json={
                "changed_fields": changed_fields,
                "before": before,
                "after": after,
                "password_changed": bool(payload.password),
            },
        )
    )
    db.commit()
    return to_user_response(updated)


@router.get("/{user_id}/social-profiles", response_model=dict)
def get_user_social_profiles(user_id: uuid.UUID, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Get social profiles linked to a specific user (Admin only)."""
    from common.db.models import SocialProfile
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    profiles = (
        db.query(SocialProfile)
        .filter(SocialProfile.user_id == user_id)
        .order_by(SocialProfile.created_at.desc())
        .all()
    )

    def serialize_profile(p: SocialProfile) -> dict:
        return {
            "id": str(p.id),
            "platform": p.platform,
            "profile_name": p.profile_name,
            "username": p.username,
            "external_id": p.external_id,
            "avatar_url": p.avatar_url,
            "follower_count": p.follower_count,
            "following_count": p.following_count,
            "likes_count": p.likes_count,
            "video_count": p.video_count,
            "status": p.status,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }

    return {"items": [serialize_profile(p) for p in profiles]}


@router.get("/{user_id}/details", response_model=dict)
def get_user_details(user_id: uuid.UUID, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Get detailed user information including AI usage stats (Admin only)."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get AI usage statistics
    runs = db.query(PromptRun).filter(PromptRun.user_id == user.id).order_by(PromptRun.created_at.desc()).all()
    
    total_input = sum(r.input_tokens or 0 for r in runs)
    total_output = sum(r.output_tokens or 0 for r in runs)
    total_tokens = sum(r.total_tokens or (r.input_tokens or 0) + (r.output_tokens or 0) for r in runs)
    total_cost = sum(r.cost_usd or 0.0 for r in runs)
    
    # Get social profiles count
    profiles_count = len(user.social_profiles)
    
    # Get crawl jobs count
    crawl_jobs_count = len(user.crawl_jobs)
    
    return {
        "user": to_user_response(user).model_dump(),
        "statistics": {
            "ai_usage": {
                "total_input_tokens": total_input,
                "total_output_tokens": total_output,
                "total_tokens": total_tokens,
                "total_cost_usd": round(total_cost, 6),
                "prompt_runs_count": len(runs),
                "breakdown_by_run_type": _usage_breakdown(runs, lambda run: run.run_type or "UNKNOWN"),
                "breakdown_by_model": _usage_breakdown(runs, lambda run: f"{run.model_provider or 'unknown'}:{run.model_name or 'unknown'}"),
            },
            "resources": {
                "social_profiles_count": profiles_count,
                "crawl_jobs_count": crawl_jobs_count,
            }
        },
    }


@router.patch("/{user_id}/toggle-active")
def toggle_user_active(user_id: uuid.UUID, current_user: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    """Toggle user active status (System Admin only)."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Không thể thay đổi trạng thái tài khoản đang đăng nhập")
    
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    old_status = user.is_active
    user.is_active = not user.is_active
    
    db.add(
        AuditLog(
            actor_id=current_user.id,
            action="user.toggle_active",
            target_type="user",
            target_id=str(user.id),
            metadata_json={
                "email": user.email,
                "full_name": user.full_name,
                "old_status": old_status,
                "new_status": user.is_active,
            },
        )
    )
    db.commit()
    db.refresh(user)
    
    return {
        "message": f"Đã {'kích hoạt' if user.is_active else 'vô hiệu hóa'} tài khoản",
        "user": to_user_response(user).model_dump(),
    }


@router.delete("/{user_id}")
def delete_user(user_id: uuid.UUID, current_user: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Không thể tự xóa tài khoản đang đăng nhập")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    audit = AuditLog(
        actor_id=current_user.id,
        action="user.deleted",
        target_type="user",
        target_id=str(user.id),
        metadata_json={
            "email": user.email,
            "full_name": user.full_name,
            "roles": [role.name for role in user.roles],
        },
    )
    db.delete(user)
    db.add(audit)
    db.commit()
    return {"message": "Đã xóa user"}
