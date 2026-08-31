from copy import deepcopy
from datetime import datetime, timezone
import json
from types import SimpleNamespace as Row
import unittest
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Query

from app.api.routes import media_workflows as route
from app.services.video_workspace_list import build_video_workspace_list


class ReadQuery:
    """Build real SQL but return synthetic rows; never connects to a database."""
    def __init__(self, owner, entities, result):
        self.owner, self.query, self.result = owner, Query(entities), result

    def __getattr__(self, name):
        def chain(*args, **kwargs):
            self.query = getattr(self.query, name)(*args, **kwargs)
            return self
        return chain

    def finish(self):
        self.owner.statements.append(str(self.query.statement.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})))
        return self.result

    def all(self):
        return self.finish()

    def count(self):
        return self.finish()


class ReadDB:
    def __init__(self, *results):
        self.results, self.statements = iter(results), []

    def query(self, *entities):
        return ReadQuery(self, entities, next(self.results))


class VideoWorkspaceListTests(unittest.TestCase):
    def setUp(self):
        self.user = Row(id=uuid.uuid4())
        self.row = Row(
            id=uuid.uuid4(), profile_id=uuid.uuid4(), series_id=uuid.uuid4(),
            profile_name="Profile thử", profile_platform="tiktok", profile_avatar="https://example.test/avatar",
            series_title="Series thử", title="Draft thử", status="EDITING",
            current_stage="DRAFT_REVIEW_REQUIRED", progress_percent=30,
            source_category="Thế giới", source_thumbnail="https://example.test/thumb", source_image=None,
            content_media=[], created_at=datetime(2026, 8, 31, tzinfo=timezone.utc), updated_at=None,
        )

    def build(self, rows=None, tasks=None):
        return build_video_workspace_list(rows if rows is not None else [self.row], tasks or {},
            total=8, limit=2, offset=2).model_dump(mode="json", exclude_none=True)

    def test_explicit_card_contract_and_no_private_storage_fields(self):
        self.row.artifacts_jsonb = [{"private": "secret"}]
        self.row.content_summary = "secret source summary"
        self.row.draft_json = {"video": ["secret"]}
        task = {"status": "FAILED", "error_message": "secret stacktrace", "created_at": "secret"}
        payload = self.build(tasks={self.row.id: task})
        self.assertEqual(payload["schema_version"], 2)
        self.assertEqual(set(payload["items"][0]), {
            "id", "profile_id", "series_id", "title", "thumbnail_url", "category", "status",
            "current_stage", "progress_percent", "task_status", "updated_at",
        })
        self.assertNotIn("secret", json.dumps(payload))
        self.assertEqual(payload["items"][0]["task_status"], "FAILED")

    def test_catalogs_are_page_local_and_deduplicated(self):
        other = deepcopy(self.row)
        other.id = uuid.uuid4()
        payload = self.build([self.row, other])
        self.assertEqual(len(payload["items"]), 2)
        self.assertEqual(len(payload["profiles"]), 1)
        self.assertEqual(len(payload["series"]), 1)
        self.assertNotIn("id", payload["profiles"][str(self.row.profile_id)])
        self.assertEqual(json.dumps(payload).count(self.row.profile_avatar), 1)

    def test_multiple_profiles_and_series_are_not_conflated(self):
        other = deepcopy(self.row)
        other.id, other.profile_id, other.series_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        other.series_title = "Khác"
        payload = self.build([self.row, other])
        self.assertEqual(len(payload["profiles"]), 2)
        self.assertEqual(payload["series"][str(other.series_id)]["title"], "Khác")

    def test_active_task_controls_progress_even_when_zero(self):
        for status in ("PENDING", "RUNNING", "PROCESSING"):
            with self.subTest(status=status):
                task = {"status": status, "progress_percent": 0, "current_stage": "VOICE_GENERATING"}
                card = self.build(tasks={self.row.id: task})["items"][0]
                self.assertEqual(card["progress_percent"], 0)
                self.assertEqual(card["current_stage"], "VOICE_GENERATING")
                self.assertEqual(card["status"], "EDITING")

    def test_completed_task_never_overwrites_draft_review_state(self):
        task = {"status": "COMPLETED", "current_stage": "DONE", "progress_percent": 100}
        card = self.build(tasks={self.row.id: task})["items"][0]
        self.assertEqual(card["current_stage"], "DRAFT_REVIEW_REQUIRED")
        self.assertEqual(card["progress_percent"], 30)

    def test_failed_workflow_stage_falls_back_to_failed_task_type(self):
        self.row.status = "FAILED"
        self.row.current_stage = "FAILED"
        task = {"status": "FAILED", "current_stage": "FAILED", "task_type": "GENERATE_VIDEO_RENDER", "progress_percent": 30}
        card = self.build(tasks={self.row.id: task})["items"][0]
        self.assertEqual(card["status"], "FAILED")
        self.assertEqual(card["task_status"], "FAILED")
        self.assertEqual(card["current_stage"], "RENDERING_VIDEO")

    def test_active_task_without_stage_uses_workflow_stage(self):
        card = self.build(tasks={self.row.id: {"status": "RUNNING"}})["items"][0]
        self.assertEqual(card["current_stage"], self.row.current_stage)

    def test_missing_source_series_task_and_avatar_are_omitted(self):
        self.row.series_id = self.row.profile_avatar = self.row.source_category = self.row.source_thumbnail = None
        self.row.content_media = None
        payload = self.build()
        self.assertEqual(payload["series"], {})
        for key in ("thumbnail_url", "category", "task_status", "series_id"):
            self.assertNotIn(key, payload["items"][0])
        self.assertEqual(payload["items"][0]["updated_at"], "2026-08-31T00:00:00Z")

    def test_thumbnail_fallback_order_and_malformed_media(self):
        self.row.content_media = [None, {}, {"storage_url": "storage"}, {"thumbnail_url": "later"}]
        self.assertEqual(self.build()["items"][0]["thumbnail_url"], self.row.source_thumbnail)
        self.row.source_thumbnail, self.row.source_image = None, "source-image"
        self.assertEqual(self.build()["items"][0]["thumbnail_url"], "source-image")
        self.row.source_image = None
        self.assertEqual(self.build()["items"][0]["thumbnail_url"], "storage")

    def client(self, db):
        app = FastAPI()
        app.include_router(route.router, prefix="/media-workflows")
        app.dependency_overrides[route.get_current_user] = lambda: self.user
        app.dependency_overrides[route.get_db] = lambda: db
        return TestClient(app)

    def test_route_owner_filters_pagination_and_scalar_source_projection(self):
        db = ReadDB(8, [self.row], [])
        response = self.client(db).get("/media-workflows/video-workspace", params={
            "profile_id": str(self.row.profile_id), "series_id": str(self.row.series_id),
            "status": "editing, failed", "stage": "draft_review_required", "search": "keyword",
            "limit": 2, "offset": 2,
        })
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual((payload["total"], payload["limit"], payload["offset"]), (8, 2, 2))
        self.assertEqual(len(db.statements), 3)
        for sql in db.statements[:2]:
            for value in (str(self.user.id), str(self.row.profile_id), str(self.row.series_id),
                          "'EDITING'", "'FAILED'", "'DRAFT_REVIEW_REQUIRED'", "%keyword%"):
                self.assertIn(value, sql)
        sql = db.statements[1]
        self.assertIn("LIMIT 2 OFFSET 2", sql)
        for field in ("artifacts_jsonb", "content_summary", "canonical_title", "draft_json"):
            self.assertNotIn(field, sql)
        self.assertIn("AS source_thumbnail", sql)
        self.assertNotIn("AS content_sources", sql)

    def test_task_query_is_bounded_scoped_and_preserves_active_priority(self):
        db = ReadDB([Row(reference_id=self.row.id, task_type="GENERATE_VIDEO_VOICE", status="RUNNING", current_stage="VOICE", progress_percent=0)])
        result = route._latest_tasks_by_workflow(db, [self.row.id])
        sql = db.statements[0]
        self.assertIn("SELECT DISTINCT ON (kafka_tasks.reference_id)", sql)
        self.assertIn("kafka_tasks.task_type", sql)
        self.assertIn("'media_workflow'", sql)
        self.assertIn(str(self.row.id), sql)
        self.assertIn("WHEN 'RUNNING' THEN 3 WHEN 'PROCESSING' THEN 2 WHEN 'PENDING' THEN 1", sql)
        self.assertIn("kafka_tasks.created_at DESC, kafka_tasks.id DESC", sql)
        self.assertNotIn("error_message", sql)
        self.assertNotIn("GENERATE_TEXT", sql)
        self.assertEqual(result[self.row.id]["task_type"], "GENERATE_VIDEO_VOICE")
        self.assertEqual(result[self.row.id]["progress_percent"], 0)

    def test_empty_page_has_no_catalog_or_task_query(self):
        db = ReadDB(8, [])
        payload = self.client(db).get("/media-workflows/video-workspace?offset=8").json()
        self.assertEqual(payload["items"], [])
        self.assertEqual(payload["profiles"], {})
        self.assertEqual(payload["series"], {})
        self.assertEqual(payload["total"], 8)
        self.assertEqual(len(db.statements), 2)

    def test_invalid_pagination_rejected_before_query(self):
        db = ReadDB()
        client = self.client(db)
        for params in ({"limit": 101}, {"limit": 0}, {"offset": -1}):
            self.assertEqual(client.get("/media-workflows/video-workspace", params=params).status_code, 422)
        self.assertEqual(db.statements, [])


if __name__ == "__main__":
    unittest.main()
