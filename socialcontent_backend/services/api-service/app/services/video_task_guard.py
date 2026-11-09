from fastapi import HTTPException
from sqlalchemy.orm import Session

from common.db.models import KafkaTask, MediaWorkflow


ACTIVE_VIDEO_TASK_STATUSES = frozenset({"PENDING", "RUNNING", "PROCESSING"})
PRE_RENDER_TASK_TYPES = frozenset({
    "GENERATE_VIDEO_SCRIPT",
    "GENERATE_VIDEO_EDIT",
    "GENERATE_VIDEO_REVIEW",
    "GENERATE_VIDEO_VOICE",
})


def ensure_no_active_video_task(
    db: Session,
    workflow: MediaWorkflow,
    *,
    allow_rejected: bool = False,
) -> None:
    if workflow.status == "REJECTED" and not allow_rejected:
        raise HTTPException(status_code=409, detail="Workflow đã bị từ chối. Hãy mở lại workflow trước khi tiếp tục.")
    blocking = db.query(KafkaTask.id).filter(
        KafkaTask.reference_id == workflow.id,
        KafkaTask.task_type.in_(PRE_RENDER_TASK_TYPES | {"GENERATE_VIDEO_RENDER"}),
        KafkaTask.status.in_(ACTIVE_VIDEO_TASK_STATUSES),
    ).first()
    if blocking:
        raise HTTPException(status_code=409, detail="Workflow đang xử lý. Hãy đợi task hiện tại hoàn tất trước khi thay đổi hoặc duyệt draft.")
