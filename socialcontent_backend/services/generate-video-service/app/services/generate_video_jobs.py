from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.generate_video_rendering import export_final_video
from app.services.generate_video_scripting import create_story_from_raw
from app.services.generate_video_timeline import normalize_story_for_project, public_story_payload


def process_generate_video_script_run(project_run_id: uuid.UUID | str) -> None:
    from common.db.models import ProjectRun, VideoDraft
    from common.db.session import SessionLocal

    db = SessionLocal()
    try:
        run = db.get(ProjectRun, uuid.UUID(str(project_run_id)))
        if not run or run.run_type != "GENERATE_VIDEO_SCRIPT" or run.status not in {"QUEUED", "FAILED"}:
            return
        project = run.project
        metadata = run.metadata_json if isinstance(run.metadata_json, dict) else {}
        source = metadata.get("source")
        if not isinstance(source, dict):
            raise RuntimeError("Missing source payload for generate-video script run")

        run.status = "RUNNING"
        run.progress_percent = 10
        run.started_at = datetime.now(timezone.utc)
        run.error_message = None
        project.status = "SCRIPTING"
        db.add_all([run, project])
        db.commit()

        story = create_story_from_raw(source)
        story = normalize_story_for_project(story)
        story.setdefault("meta", {})
        story["meta"]["project_id"] = str(project.id)
        public_story = public_story_payload(story)
        public_story["project_status"] = "EDITING"
        _upsert_project_rendered_draft(db, VideoDraft, project, public_story)

        run.status = "COMPLETED"
        run.progress_percent = 100
        run.metadata_json = {**metadata, "story": public_story}
        run.completed_at = datetime.now(timezone.utc)
        project.status = "EDITING"
        project.progress_percent = 100
        db.add_all([run, project])
        db.commit()
        _maybe_enqueue_auto_generate_video_render(db, project, public_story, trigger="script_completed")
    except Exception as error:
        db.rollback()
        run = db.get(ProjectRun, uuid.UUID(str(project_run_id)))
        if run:
            run.status = "FAILED"
            run.error_message = str(error)[-2000:]
            run.completed_at = datetime.now(timezone.utc)
            if run.project:
                run.project.status = "FAILED"
                db.add(run.project)
            db.add(run)
            db.commit()
    finally:
        db.close()



def process_generate_video_render_run(project_run_id: uuid.UUID | str) -> None:
    _project_render_worker(str(project_run_id))



def _maybe_enqueue_auto_generate_video_render(db, project, story: dict[str, Any], *, trigger: str) -> None:
    from common.db.models import ProjectRun, SocialProfile
    from common.events.envelope import build_event
    from common.events.kafka import publish
    from common.events.topics import GENERATE_VIDEO_RENDER_REQUESTED

    profile = getattr(project, "profile", None) or db.get(SocialProfile, project.profile_id)
    strategy = getattr(profile, "strategy", None) if profile else None
    if getattr(strategy, "video_render_mode", "manual") != "auto":
        return

    existing = (
        db.query(ProjectRun)
        .filter(ProjectRun.project_id == project.id, ProjectRun.run_type == "GENERATE_VIDEO_RENDER", ProjectRun.status.in_(["QUEUED", "RUNNING"]))
        .order_by(ProjectRun.created_at.desc())
        .first()
    )
    if existing:
        return

    render_story = public_story_payload(story)
    render_story.setdefault("meta", {})
    render_story["meta"]["project_id"] = str(project.id)
    job = ProjectRun(
        project_id=project.id,
        run_type="GENERATE_VIDEO_RENDER",
        status="QUEUED",
        progress_percent=0,
        metadata_json={"story": render_story, "trigger": trigger, "video_render_mode": "auto"},
    )
    project.status = "RENDERING"
    db.add_all([job, project])
    db.commit()
    db.refresh(job)
    publish(
        GENERATE_VIDEO_RENDER_REQUESTED,
        build_event(
            event_type=GENERATE_VIDEO_RENDER_REQUESTED,
            source="generate-video-worker",
            job_id=job.id,
            payload={"project_id": str(project.id), "run_type": job.run_type, "trigger": trigger},
            correlation_id=project.id,
        ),
    )



def _project_render_worker(project_run_id: str) -> None:
    from common.db.models import ProjectArtifact, ProjectRun, VideoDraft
    from common.db.session import SessionLocal

    db = SessionLocal()
    try:
        run = db.get(ProjectRun, uuid.UUID(project_run_id))
        if not run or run.run_type != "GENERATE_VIDEO_RENDER" or run.status not in {"QUEUED", "FAILED"}:
            return
        project = run.project
        run.status = "RUNNING"
        run.progress_percent = 5
        run.started_at = datetime.now(timezone.utc)
        run.error_message = None
        project.status = "RENDERING"
        db.add_all([run, project])
        db.commit()

        metadata = run.metadata_json if isinstance(run.metadata_json, dict) else {}
        story = metadata.get("story") or _find_project_draft_story(db, VideoDraft, project)
        if not isinstance(story, dict):
            raise RuntimeError("Missing story for project render run")
        story = normalize_story_for_project(story)
        story.setdefault("meta", {})
        story["meta"]["project_id"] = str(project.id)

        result = export_final_video(story, render_job_id=str(run.id))
        result_story = result.get("story") or story
        artifact_path = str(result.get("artifact_path") or "")
        public_story = public_story_payload(result_story)
        public_story.setdefault("meta", {})
        public_story["meta"]["project_id"] = str(project.id)
        public_story["project_status"] = "RENDERED"
        if artifact_path:
            public_story.setdefault("video_artifacts", {})["final"] = artifact_path

        _upsert_project_rendered_draft(db, VideoDraft, project, public_story)
        artifact = (
            db.query(ProjectArtifact)
            .filter(ProjectArtifact.project_id == project.id, ProjectArtifact.artifact_type == "FINAL_VIDEO")
            .order_by(ProjectArtifact.updated_at.desc())
            .first()
        )
        if not artifact:
            artifact = ProjectArtifact(project_id=project.id, artifact_type="FINAL_VIDEO")
            db.add(artifact)
        artifact.uri = artifact_path
        artifact.status = "READY"
        artifact.metadata_json = {"run_id": str(run.id)}

        run.status = "RENDERED"
        run.progress_percent = 100
        run.metadata_json = {**metadata, "output_path": artifact_path, "story": public_story}
        run.completed_at = datetime.now(timezone.utc)
        project.status = "RENDERED"
        project.progress_percent = 100
        db.add_all([artifact, run, project])
        db.commit()
    except Exception as error:
        db.rollback()
        run = db.get(ProjectRun, uuid.UUID(project_run_id))
        if run:
            run.status = "FAILED"
            run.error_message = str(error)[-2000:]
            run.completed_at = datetime.now(timezone.utc)
            if run.project:
                run.project.status = "FAILED"
                db.add(run.project)
            db.add(run)
            db.commit()
    finally:
        db.close()



def _find_project_draft_story(db, video_draft_model, project) -> dict[str, Any] | None:
    if project.video_draft_id:
        draft = db.get(video_draft_model, project.video_draft_id)
        if draft and draft.user_id == project.user_id and isinstance(draft.draft_json, dict):
            return draft.draft_json
    drafts = (
        db.query(video_draft_model)
        .filter(video_draft_model.user_id == project.user_id)
        .order_by(video_draft_model.updated_at.desc())
        .limit(100)
        .all()
    )
    for draft in drafts:
        draft_json = draft.draft_json if isinstance(draft.draft_json, dict) else {}
        meta = draft_json.get("meta") if isinstance(draft_json.get("meta"), dict) else {}
        if str(meta.get("project_id") or "") == str(project.id):
            return draft_json
    return None



def _upsert_project_rendered_draft(db, video_draft_model, project, story: dict[str, Any]) -> None:
    story.setdefault("meta", {})
    story["meta"]["project_id"] = str(project.id)
    title = str(story.get("meta", {}).get("title") or project.title or f"Video {str(project.id)[:8]}")
    draft = db.get(video_draft_model, project.video_draft_id) if project.video_draft_id else None
    if draft and draft.user_id == project.user_id:
        draft.title = title
        draft.draft_json = story
        db.add(draft)
        return
    draft = video_draft_model(user_id=project.user_id, title=title, draft_json=story)
    db.add(draft)
    db.flush()
    project.video_draft_id = draft.id
