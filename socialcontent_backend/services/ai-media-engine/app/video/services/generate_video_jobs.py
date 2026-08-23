from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.video.services.generate_video_rendering import export_final_video
from app.video.services.generate_video_scripting import create_story_from_raw
from app.video.services.generate_video_timeline import normalize_story_for_project, public_story_payload


def process_generate_video_script_run(workflow_run_id: uuid.UUID | str) -> None:
    from common.db.models import WorkflowRun, MediaWorkflow, VideoDraft
    from common.db.session import SessionLocal

    db = SessionLocal()
    try:
        run = db.get(WorkflowRun, uuid.UUID(str(workflow_run_id)))
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
        story["meta"]["workflow_id"] = str(project.id)
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
        run = db.get(WorkflowRun, uuid.UUID(str(workflow_run_id)))
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


def process_generate_video_edit_run(workflow_run_id: uuid.UUID | str) -> None:
    from common.db.models import WorkflowRun, MediaWorkflow, VideoDraft
    from common.db.session import SessionLocal
    from app.video.services.generate_video_llm import edit_story_with_ai

    db = SessionLocal()
    try:
        run = db.get(WorkflowRun, uuid.UUID(str(workflow_run_id)))
        if not run or run.run_type != "GENERATE_VIDEO_EDIT" or run.status not in {"QUEUED", "FAILED"}:
            return
        project = run.project
        metadata = run.metadata_json if isinstance(run.metadata_json, dict) else {}
        story = metadata.get("story")
        prompt = metadata.get("prompt") or ""
        if not isinstance(story, dict):
            raise RuntimeError("Missing story payload for generate-video edit run")

        run.status = "RUNNING"
        run.progress_percent = 20
        run.started_at = datetime.now(timezone.utc)
        run.error_message = None
        project.status = "EDITING"
        db.add_all([run, project])
        db.commit()

        edited = edit_story_with_ai(story, prompt)
        edited = normalize_story_for_project(edited)
        edited.setdefault("meta", {})
        edited["meta"]["workflow_id"] = str(project.id)
        public_story = public_story_payload(edited)
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
    except Exception as error:
        db.rollback()
        run = db.get(WorkflowRun, uuid.UUID(str(workflow_run_id)))
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


def process_generate_video_review_run(workflow_run_id: uuid.UUID | str) -> None:
    from common.db.models import WorkflowRun, MediaWorkflow, VideoDraft
    from common.db.session import SessionLocal
    from app.video.services.generate_video_llm import review_story_with_ai

    db = SessionLocal()
    try:
        run = db.get(WorkflowRun, uuid.UUID(str(workflow_run_id)))
        if not run or run.run_type != "GENERATE_VIDEO_REVIEW" or run.status not in {"QUEUED", "FAILED"}:
            return
        project = run.project
        metadata = run.metadata_json if isinstance(run.metadata_json, dict) else {}
        story = metadata.get("story")
        instructions = metadata.get("instructions")
        if not isinstance(story, dict):
            raise RuntimeError("Missing story payload for generate-video review run")

        run.status = "RUNNING"
        run.progress_percent = 20
        run.started_at = datetime.now(timezone.utc)
        run.error_message = None
        project.status = "REVIEWING"
        db.add_all([run, project])
        db.commit()

        reviewed = review_story_with_ai(story, instructions)
        reviewed = normalize_story_for_project(reviewed)
        reviewed.setdefault("meta", {})
        reviewed["meta"]["workflow_id"] = str(project.id)
        public_story = public_story_payload(reviewed)
        public_story["project_status"] = "REVIEWING"
        _upsert_project_rendered_draft(db, VideoDraft, project, public_story)

        run.status = "COMPLETED"
        run.progress_percent = 100
        run.metadata_json = {**metadata, "story": public_story, "review": (public_story.get("meta") or {}).get("ai_story_review")}
        run.completed_at = datetime.now(timezone.utc)
        project.status = "REVIEWING"
        project.progress_percent = 100
        db.add_all([run, project])
        db.commit()
    except Exception as error:
        db.rollback()
        run = db.get(WorkflowRun, uuid.UUID(str(workflow_run_id)))
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



def process_generate_video_voice_run(workflow_run_id: uuid.UUID | str) -> None:
    from common.db.models import WorkflowRun, MediaWorkflow, VideoDraft
    from common.db.session import SessionLocal
    from app.video.services.generate_video_voice import enhance_emotion_and_generate_voice
    from app.video.services.generate_video_alignment import fit_frames_with_whisper

    db = SessionLocal()
    try:
        run = db.get(WorkflowRun, uuid.UUID(str(workflow_run_id)))
        if not run or run.run_type != "GENERATE_VIDEO_VOICE" or run.status not in {"QUEUED", "FAILED"}:
            return
        project = run.project
        metadata = run.metadata_json if isinstance(run.metadata_json, dict) else {}
        story = metadata.get("story") or _find_project_draft_story(db, VideoDraft, project)
        voice_id = metadata.get("voice_id")
        voice_speed = float(metadata.get("voice_speed") or 1.0)
        voice_provider = metadata.get("voice_provider")
        if not isinstance(story, dict):
            raise RuntimeError("Missing story payload for generate-video voice run")

        run.status = "RUNNING"
        run.progress_percent = 20
        run.started_at = datetime.now(timezone.utc)
        run.error_message = None
        project.status = "EDITING"
        db.add_all([run, project])
        db.commit()

        result = enhance_emotion_and_generate_voice(story, voice_id, voice_speed, voice_provider)
        result_story = result.get("story") or {}
        fit_error = None
        try:
            fit_result = fit_frames_with_whisper(result_story)
            result_story = fit_result.get("story") or result_story
        except Exception as error:
            fit_error = str(error)

        result_story = normalize_story_for_project(result_story)
        result_story.setdefault("meta", {})
        result_story["meta"]["workflow_id"] = str(project.id)
        public_story = public_story_payload(result_story)
        _upsert_project_rendered_draft(db, VideoDraft, project, public_story)

        run.status = "COMPLETED"
        run.progress_percent = 100
        run.metadata_json = {
            **metadata,
            "story": public_story,
            "voice_id": result.get("voice_id"),
            "voice_provider": result.get("voice_provider"),
            "voice_speed": result.get("voice_speed"),
            "voice_text": result.get("voice_text"),
            "audio_url": result.get("audio_url"),
            "fit_frame_error": fit_error,
        }
        run.completed_at = datetime.now(timezone.utc)
        project.progress_percent = 100
        db.add_all([run, project])
        db.commit()
    except Exception as error:
        db.rollback()
        run = db.get(WorkflowRun, uuid.UUID(str(workflow_run_id)))
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


def process_generate_video_render_run(workflow_run_id: uuid.UUID | str) -> None:
    _project_render_worker(str(workflow_run_id))



def _maybe_enqueue_auto_generate_video_render(db, project, story: dict[str, Any], *, trigger: str) -> None:
    from common.db.models import WorkflowRun, SocialProfile
    from common.events.envelope import build_event
    from common.events.kafka import publish
    from common.events.topics import GENERATE_VIDEO_RENDER_REQUESTED

    profile = getattr(project, "profile", None) or db.get(SocialProfile, project.profile_id)
    strategy = getattr(profile, "strategy", None) if profile else None
    if getattr(strategy, "video_render_mode", "manual") != "auto":
        return

    existing = (
        db.query(WorkflowRun)
        .filter(WorkflowRun.workflow_id == project.id, WorkflowRun.run_type == "GENERATE_VIDEO_RENDER", WorkflowRun.status.in_(["QUEUED", "RUNNING"]))
        .order_by(WorkflowRun.created_at.desc())
        .first()
    )
    if existing:
        return

    render_story = public_story_payload(story)
    render_story.setdefault("meta", {})
    render_story["meta"]["workflow_id"] = str(project.id)
    job = WorkflowRun(
        workflow_id=project.id,
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
            payload={"workflow_id": str(project.id), "run_type": job.run_type, "trigger": trigger},
            correlation_id=project.id,
        ),
    )



def _project_render_worker(workflow_run_id: str) -> None:
    from common.db.models import WorkflowArtifact, WorkflowRun, MediaWorkflow, VideoDraft
    from common.db.session import SessionLocal

    db = SessionLocal()
    try:
        run = db.get(WorkflowRun, uuid.UUID(workflow_run_id))
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
        story["meta"]["workflow_id"] = str(project.id)

        result = export_final_video(story, render_job_id=str(run.id))
        result_story = result.get("story") or story
        artifact_path = str(result.get("artifact_path") or "")
        public_story = public_story_payload(result_story)
        public_story.setdefault("meta", {})
        public_story["meta"]["workflow_id"] = str(project.id)
        public_story["project_status"] = "RENDERED"
        if artifact_path:
            public_story.setdefault("video_artifacts", {})["final"] = artifact_path

        _upsert_project_rendered_draft(db, VideoDraft, project, public_story)
        artifact = (
            db.query(WorkflowArtifact)
            .filter(WorkflowArtifact.workflow_id == project.id, WorkflowArtifact.artifact_type == "FINAL_VIDEO")
            .order_by(WorkflowArtifact.updated_at.desc())
            .first()
        )
        if not artifact:
            artifact = WorkflowArtifact(workflow_id=project.id, artifact_type="FINAL_VIDEO")
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
        run = db.get(WorkflowRun, uuid.UUID(workflow_run_id))
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
        if str(meta.get("workflow_id") or "") == str(project.id):
            return draft_json
    return None



def _upsert_project_rendered_draft(db, video_draft_model, project, story: dict[str, Any]) -> None:
    story.setdefault("meta", {})
    story["meta"]["workflow_id"] = str(project.id)
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
