import asyncio
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from common.core.config import get_settings
from common.db.models import MediaWorkflow, KafkaTask, SocialProfile, User
from common.db.session import SessionLocal, get_db
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import PLANNING_AI_REQUESTED
from app.api.deps import get_current_user
from app.schemas import api as schemas

router = APIRouter()


@router.post("", response_model=schemas.WorkflowRunResponse)
def create_workflow_run(
    payload: schemas.WorkflowRunCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    workflow = db.get(MediaWorkflow, payload.workflow_id)
    if not workflow or (not user.is_system_admin and workflow.user_id != user.id):
        raise HTTPException(status_code=404, detail="Media workflow not found")

    run = KafkaTask(
        reference_id=str(workflow.id),
        task_type="AI_PLANNING",
        status="PENDING",
        payload_json={"prompt": payload.prompt} if payload.prompt else {},
    )
    db.add(run)
    workflow.status = "PLANNING"
    db.add(workflow)
    db.commit()
    db.refresh(run)

    publish(
        PLANNING_AI_REQUESTED,
        build_event(
            event_type=PLANNING_AI_REQUESTED,
            source="api-service",
            payload={"workflow_id": str(workflow.id), "task_id": str(run.id)},
            correlation_id=workflow.id,
        ),
    )

    if not get_settings().KAFKA_BROKERS:
        try:
            from app.planning.services.pipeline import PlanningPipeline
            with SessionLocal() as session:
                task = session.get(KafkaTask, run.id)
                if task and task.status in {"PENDING"}:
                    PlanningPipeline().handle_workflow_run_created(session, {"job_id": str(run.id)})
        except Exception:
            pass

    return _serialize_workflow_run(run)


@router.get("", response_model=list[schemas.WorkflowRunResponse])
def list_workflow_runs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    runs_query = db.query(KafkaTask).join(MediaWorkflow, MediaWorkflow.id == KafkaTask.reference_id).filter(KafkaTask.task_type == "AI_PLANNING")
    if not user.is_system_admin:
        runs_query = runs_query.filter(MediaWorkflow.user_id == user.id)
    runs = runs_query.order_by(KafkaTask.created_at.desc()).limit(100).all()
    return [_serialize_workflow_run(run) for run in runs]


@router.get("/{run_id}", response_model=schemas.WorkflowRunResponse)
def get_workflow_run(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_workflow_run(db, run_id, user)
    if run:
        return _serialize_workflow_run(run)
    raise HTTPException(status_code=404, detail="Planning run not found")


@router.post("/{run_id}/cancel", response_model=schemas.WorkflowRunResponse)
def cancel_workflow_run(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_workflow_run(db, run_id, user)
    if not run:
        raise HTTPException(status_code=404, detail="Planning run not found")
    if run.status in {"PENDING", "PROCESSING"}:
        run.status = "FAILED"
        run.error_detail = "Cancelled by user"
        db.add(run)
        db.commit()
        db.refresh(run)
    return _serialize_workflow_run(run)


@router.post("/{run_id}/retry", response_model=schemas.WorkflowRunResponse)
def retry_workflow_run(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_workflow_run(db, run_id, user)
    if not run:
        raise HTTPException(status_code=404, detail="Planning run not found")
    if run.status in {"FAILED", "COMPLETED"}:
        run.status = "PENDING"
        run.error_detail = None
        db.add(run)
        db.commit()
        db.refresh(run)
        
        publish(
            PLANNING_AI_REQUESTED,
            build_event(
                event_type=PLANNING_AI_REQUESTED,
                source="api-service",
                payload={"workflow_id": str(run.reference_id), "task_id": str(run.id)},
                correlation_id=run.reference_id,
            ),
        )
    return _serialize_workflow_run(run)


@router.get("/{run_id}/stream")
async def stream_workflow_run(run_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_owned_workflow_run(db, run_id, user)
    if run:
        async def project_stream():
            for _ in range(90):
                with SessionLocal() as session:
                    current = session.get(KafkaTask, run_id)
                    if not current:
                        break
                    yield (
                        "data: "
                        + json.dumps(
                            {
                                "id": str(current.id),
                                "status": current.status,
                                "progress": 0,
                                "stage": "PROCESSING",
                            }
                        )
                        + "\n\n"
                    )
                    if current.status in {"FAILED", "COMPLETED"}:
                        break
                await asyncio.sleep(2)

        return StreamingResponse(project_stream(), media_type="text/event-stream")
    raise HTTPException(status_code=404, detail="Planning run not found")


def _get_owned_workflow_run(db: Session, run_id: uuid.UUID, user: User) -> KafkaTask | None:
    run = db.get(KafkaTask, run_id)
    if not run or run.task_type != "AI_PLANNING":
        return None
    workflow = db.get(MediaWorkflow, run.reference_id)
    if not workflow:
        return None
    if not user.is_system_admin and workflow.user_id != user.id:
        return None
    run.project = workflow
    return run


def _serialize_workflow_run(run: KafkaTask) -> dict:
    payload = run.payload_json if isinstance(run.payload_json, dict) else {}
    workflow = getattr(run, "project", None)
    return {
        "id": str(run.id),
        "workflow_id": str(run.reference_id),
        "run_type": run.task_type,
        "status": run.status,
        "current_stage": "PROCESSING",
        "progress_percent": 0.0,
        "error_message": run.error_detail,
        "metadata": payload,
        "project": {
            "id": str(workflow.id),
            "title": workflow.title,
            "status": workflow.status,
        } if workflow else None,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }


def _serialize_workflow_run_log(run: KafkaTask) -> dict:
    return {
        "id": run.id,
        "workflow_run_id": run.id,
        "log_level": "INFO",
        "message": "Task created",
        "created_at": run.created_at,
    }
