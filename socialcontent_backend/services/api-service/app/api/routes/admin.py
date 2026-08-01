from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import AuditLog, Role, User
from common.db.session import get_db
from app.schemas import api as schemas
from app.api.deps import require_system_admin
from app.services.users import UserService, to_user_response

router = APIRouter()


@router.post("/system/bootstrap", response_model=schemas.UserResponse)
def bootstrap_system_admin(payload: schemas.BootstrapAdminRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    if payload.bootstrap_token != settings.system_bootstrap_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid bootstrap token")
    existing_admin = db.query(User).filter(User.is_system_admin.is_(True)).first()
    if existing_admin:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="System admin already exists")
    user = UserService().create_system_admin(db, payload)
    return to_user_response(user)


@router.get("/system/audit-logs")
def audit_logs(_: User = Depends(require_system_admin), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(100).all()
    return rows
