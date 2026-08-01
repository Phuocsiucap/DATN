from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from common.db.models import ContentItem, CrawlTask, User
from common.db.session import get_db
from app.api.deps import get_current_user

router = APIRouter()


@router.get("/summary")
def quality_summary(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    total = db.query(func.count(ContentItem.id)).scalar() or 0
    ready = db.query(func.count(ContentItem.id)).filter(ContentItem.status == "READY").scalar() or 0
    review = db.query(func.count(ContentItem.id)).filter(ContentItem.status == "NEEDS_REVIEW").scalar() or 0
    avg_quality = db.query(func.avg(ContentItem.quality_score)).scalar() or 0
    failed_tasks = db.query(func.count(CrawlTask.id)).filter(CrawlTask.status == "FAILED").scalar() or 0
    return {"total_content": total, "ready": ready, "needs_review": review, "average_quality_score": float(avg_quality), "failed_tasks": failed_tasks}


@router.get("/issues")
def quality_issues(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    low_quality = db.query(ContentItem).filter(ContentItem.quality_score < 60).order_by(ContentItem.created_at.desc()).limit(50).all()
    failed_tasks = db.query(CrawlTask).filter(CrawlTask.status == "FAILED").order_by(CrawlTask.updated_at.desc()).limit(50).all()
    return {"low_quality_content": low_quality, "failed_tasks": failed_tasks}
