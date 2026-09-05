"""Exercise job creation using in-memory persistence; no services required."""
import ast
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)

class Record:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
        self.sources = []
        self.id = uuid.uuid4()

class DB:
    def __init__(self, config):
        self.config = config
        self.saved = []
    def get(self, model, id):
        return self.config if id == self.config.id else None
    def add(self, record): self.saved.append(record)
    def commit(self): pass
    def refresh(self, record): pass

def load_service():
    path = ROOT / "services/api-service/app/services/crawl_jobs.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
    # Execute actual production methods with isolated infrastructure adapters.
    namespace = dict(HTTPException=HTTPException, CrawlJob=Record,
                     CrawlJobSource=Record, CrawlSourceConfig=Record, AuditLog=Record)
    import sys
    sys.path.insert(0, str(ROOT))
    from common.core.vnexpress_rss import resolve_vnexpress_rss_feeds
    namespace["resolve_vnexpress_rss_feeds"] = resolve_vnexpress_rss_feeds
    from common.core.crawl_source_config import effective_source_configuration
    namespace["effective_source_configuration"] = effective_source_configuration
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), cls], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(path), "exec"), namespace)
    service = namespace["CrawlJobService"]()
    service.publish_created = lambda *args: None
    return service

class CrawlContractTests(unittest.TestCase):
    def setUp(self):
        self.service = load_service()
        self.config = NS(id=uuid.uuid4(), status="ACTIVE", source_type="VNEXPRESS",
                         source_url=None, keywords=["default"], configuration={
                             "rss_feed_keys": ["thoi-su", "the-gioi"],
                             "job_options": ["keywords", "rss_feed_keys"], "timeout": 12})
        self.db = DB(self.config)
        self.user = NS(id=uuid.uuid4(), is_system_admin=False, roles=[NS(name="CREATOR")])
    def create(self, **overrides):
        source = NS(source_config_id=self.config.id, source_type=None, source_url=None,
                    keywords=[], configuration={}, max_items=35, model_fields_set=set(overrides))
        source.__dict__.update(overrides)
        payload = NS(content_scope="GLOBAL", created_by_type="SYSTEM", schedule=None,
                     name="Test", crawl_mode="ONE_TIME", priority=5, sources=[source])
        return self.service.create(self.db, payload, self.user)
    def test_inherits_and_snapshots_defaults(self):
        job = self.create()
        self.assertEqual(job.content_scope, "PRIVATE")
        source = job.sources[0]
        self.assertEqual(source.keywords, ["default"])
        self.assertEqual(source.configuration["max_items"], 35)
        self.assertEqual(source.configuration["timeout"], 12)
        self.assertNotIn("max_items", self.config.configuration)
        self.assertNotIn("job_options", source.configuration)
        self.config.keywords.append("changed")
        self.assertEqual(source.keywords, ["default"])
    def test_override_can_clear_keywords_and_select_subset(self):
        source = self.create(keywords=[], configuration={"rss_feed_keys": ["thoi-su"]}).sources[0]
        self.assertEqual(source.keywords, [])
        self.assertEqual(source.configuration["rss_feed_keys"], ["thoi-su"])
        self.assertEqual(len(source.configuration["rss_feed_urls"]), 1)
    def test_rejects_unapproved_overrides(self):
        for overrides in ({"source_url": "https://example.com"}, {"configuration": {"timeout": 2}},
                          {"configuration": {"rss_feed_keys": ["unknown"]}},
                          {"configuration": {"rss_feed_keys": []}}):
            with self.subTest(overrides=overrides), self.assertRaises(HTTPException):
                self.create(**overrides)
        self.assertEqual(self.db.saved, [])
    def test_rejects_paused_missing_and_mismatched_sources(self):
        with self.assertRaises(HTTPException): self.create(source_type="BILIBILI")
        with self.assertRaises(HTTPException): self.create(source_config_id=uuid.uuid4())
        self.config.status = "PAUSED"
        with self.assertRaises(HTTPException): self.create()
    def test_multiple_sources_keep_independent_counts(self):
        original_get = self.db.get
        second = NS(**{**self.config.__dict__, "id": uuid.uuid4(), "source_type": "BILIBILI",
                       "configuration": {}, "keywords": ["video"]})
        self.db.get = lambda model, id: second if id == second.id else original_get(model, id)
        sources = [NS(source_config_id=c.id, source_type=None, source_url=None, keywords=[],
                      configuration={}, max_items=count, model_fields_set=set())
                   for c, count in [(self.config, 10), (second, 40)]]
        payload = NS(content_scope="GLOBAL", created_by_type="SYSTEM", schedule=None,
                     name="Multi", crawl_mode="ONE_TIME", priority=5, sources=sources)
        job = self.service.create(self.db, payload, self.user)
        self.assertEqual([s.configuration["max_items"] for s in job.sources], [10, 40])
        self.assertEqual([s.source_type for s in job.sources], ["VNEXPRESS", "BILIBILI"])
        payload.sources = [sources[0], sources[0]]
        with self.assertRaises(HTTPException): self.service.create(self.db, payload, self.user)

    def test_source_configuration_cannot_store_article_count(self):
        path = ROOT / "services/api-service/app/api/routes/sources.py"
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "validate_source_config")
        from common.core.vnexpress_rss import vnexpress_rss_catalog
        namespace = dict(HTTPException=HTTPException, vnexpress_rss_catalog=vnexpress_rss_catalog)
        exec(compile(ast.Module(body=[fn], type_ignores=[]), str(path), "exec"), namespace)
        validate = namespace["validate_source_config"]
        validate("VNEXPRESS", {})
        validate("VNEXPRESS", {"job_options": ["keywords"]})
        for config in ({"max_items": 10}, {"limit": 10}, {"job_options": ["max_items"]}, {"rss_feed_keys": ["invalid"]}):
            with self.subTest(config=config), self.assertRaises(HTTPException):
                validate("VNEXPRESS", config)

    def test_legacy_source_keeps_options_but_explicit_empty_disables_them(self):
        del self.config.configuration["job_options"]
        source = self.create(keywords=["news"], configuration={"rss_feed_keys": ["thoi-su"]}).sources[0]
        self.assertEqual(source.keywords, ["news"])
        self.assertNotIn("job_options", self.config.configuration)
        self.config.configuration["job_options"] = []
        with self.assertRaises(HTTPException): self.create(keywords=["news"])

    def test_rejects_unauthorized_role(self):
        self.user.roles = [NS(name="VIEWER")]
        with self.assertRaises(HTTPException) as caught: self.create()
        self.assertEqual(caught.exception.status_code, 403)

if __name__ == "__main__":
    unittest.main()
