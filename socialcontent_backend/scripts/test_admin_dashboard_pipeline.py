import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.api.routes import admin as admin_routes
from app.services import admin_dashboard
from app.services.admin_dashboard import build_pipeline_counts


class AdminDashboardPipelineTests(unittest.TestCase):
    def test_groups_active_tasks_by_operational_stage(self):
        result = build_pipeline_counts(
            {
                "CRAWL_URL": 2,
                "NORMALIZE": 1,
                "GENERATE_VIDEO_SCRIPT": 3,
                "GENERATE_VIDEO_REVIEW": 1,
                "GENERATE_VIDEO_VOICE": 4,
                "GENERATE_VIDEO_RENDER": 2,
                "UNCLASSIFIED_TASK": 1,
            },
            publishing=2,
            active_crawl_jobs=2,
        )

        self.assertEqual(result["crawl"], 3)
        self.assertEqual(result["draft"], 4)
        self.assertEqual(result["voice"], 4)
        self.assertEqual(result["render"], 2)
        self.assertEqual(result["publishing"], 2)
        self.assertEqual(result["crawl_jobs"], 2)
        self.assertEqual(result["other"], 1)
        self.assertEqual(result["total"], 16)

    def test_empty_pipeline_stays_zero(self):
        self.assertEqual(
            build_pipeline_counts({}, publishing=0, active_crawl_jobs=0),
            {
                "crawl": 0,
                "draft": 0,
                "voice": 0,
                "render": 0,
                "publishing": 0,
                "crawl_jobs": 0,
                "other": 0,
                "total": 0,
            },
        )


class AdminDashboardServiceHealthTests(unittest.IsolatedAsyncioTestCase):
    async def test_scheduler_is_not_reported_as_a_child_service(self):
        probe = {
            "key": "probe",
            "name": "Probe",
            "kind": "service",
            "status": "online",
            "latency_ms": 1,
            "detail": "OK",
        }
        db = MagicMock()

        with (
            patch.object(admin_dashboard, "_probe_mongo", AsyncMock(return_value=probe)),
            patch.object(admin_dashboard, "_probe_kafka", AsyncMock(return_value=probe)),
            patch.object(admin_dashboard, "_probe_http", AsyncMock(return_value=probe)),
        ):
            services = await admin_dashboard._service_health_snapshot(db)

        self.assertNotIn("scheduler", {service["key"] for service in services})


class AdminDashboardRouteTests(unittest.TestCase):
    def test_dashboard_exposes_independent_section_endpoints(self):
        paths = {route.path for route in admin_routes.router.routes}

        self.assertTrue({
            "/system/dashboard/summary",
            "/system/dashboard/pipeline",
            "/system/dashboard/errors",
            "/system/dashboard/services",
        }.issubset(paths))


if __name__ == "__main__":
    unittest.main()
