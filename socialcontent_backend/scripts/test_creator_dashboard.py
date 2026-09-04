import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.api.deps import require_creator
from app.api.routes import creator_dashboard as creator_routes
from app.services.creator_dashboard import QUEUE_STATUSES, _grouped_counts


class CreatorDashboardAuthorizationTests(unittest.TestCase):
    def test_creator_role_is_accepted(self):
        creator = SimpleNamespace(is_system_admin=False, roles=[SimpleNamespace(name="CREATOR")])

        self.assertIs(require_creator(creator), creator)

    def test_system_admin_is_not_treated_as_creator(self):
        admin = SimpleNamespace(is_system_admin=True, roles=[SimpleNamespace(name="SYSTEM_ADMIN")])

        with self.assertRaises(HTTPException) as context:
            require_creator(admin)

        self.assertEqual(context.exception.status_code, 403)


class CreatorDashboardContractTests(unittest.TestCase):
    def test_creator_dashboard_has_its_own_endpoints(self):
        paths = {route.path for route in creator_routes.router.routes}

        self.assertEqual(paths, {"/overview", "/publishing", "/projects"})

    def test_grouped_counts_normalizes_statuses(self):
        self.assertEqual(
            _grouped_counts([("READY", 2), ("published", 3), (None, 1)]),
            {"ready": 2, "published": 3, "unknown": 1},
        )

    def test_publishing_contract_contains_creator_funnel_statuses(self):
        self.assertEqual(
            QUEUE_STATUSES,
            ("needs_approval", "approved", "queued", "publishing", "published", "failed"),
        )


if __name__ == "__main__":
    unittest.main()
