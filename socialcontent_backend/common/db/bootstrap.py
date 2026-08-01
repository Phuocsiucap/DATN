from sqlalchemy.orm import Session

from common.db.models import Role


DEFAULT_ROLES = {
    "SYSTEM_ADMIN": "Full system access, user management, settings, all crawl data.",
    "ADMIN": "Operational admin access for crawl jobs, sources, content review.",
    "USER": "Standard user access for owned crawl jobs and content views.",
}


def ensure_roles(db: Session) -> None:
    existing = {role.name for role in db.query(Role).all()}
    for name, description in DEFAULT_ROLES.items():
        if name not in existing:
            db.add(Role(name=name, description=description))
    db.commit()
