import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.api.routes import admin as admin_routes


class AdminAuditLogRouteTests(unittest.TestCase):
    def test_audit_log_endpoint_is_registered(self):
        routes = {route.path: route for route in admin_routes.router.routes}

        self.assertIn("/system/audit-logs", routes)
        self.assertIn("GET", routes["/system/audit-logs"].methods)


class AdminAuditLogSerializerTests(unittest.TestCase):
    def test_serializes_actor_target_and_metadata(self):
        actor_id = uuid.uuid4()
        log_id = uuid.uuid4()
        created_at = datetime(2026, 9, 5, 10, 30, tzinfo=timezone.utc)
        actor = SimpleNamespace(id=actor_id, email="admin@test.local", full_name="System Admin")
        log = SimpleNamespace(
            id=log_id,
            actor_id=actor_id,
            action="user.updated",
            target_type="user",
            target_id="target-user-id",
            metadata_json={"changed_fields": ["is_active"]},
            created_at=created_at,
        )

        result = admin_routes._serialize_audit_log(log, actor)

        self.assertEqual(result["id"], str(log_id))
        self.assertEqual(result["actor"]["email"], "admin@test.local")
        self.assertEqual(result["target_id"], "target-user-id")
        self.assertEqual(result["metadata"], {"changed_fields": ["is_active"]})
        self.assertEqual(result["created_at"], created_at.isoformat())

    def test_keeps_system_event_when_actor_is_missing(self):
        log = SimpleNamespace(
            id=uuid.uuid4(),
            actor_id=None,
            action="system.event",
            target_type=None,
            target_id=None,
            metadata_json=None,
            created_at=None,
        )

        result = admin_routes._serialize_audit_log(log, None)

        self.assertIsNone(result["actor_id"])
        self.assertIsNone(result["actor"])
        self.assertEqual(result["metadata"], {})
        self.assertIsNone(result["created_at"])


if __name__ == "__main__":
    unittest.main()
