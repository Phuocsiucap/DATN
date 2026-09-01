from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa


class AutoPublishMigrationTests(unittest.TestCase):
    def test_upgrade_preserves_effective_opt_in_for_every_legacy_combination(self):
        migration_path = Path(__file__).resolve().parents[1] / "alembic/versions/e64f0a7c2b93_unify_profile_auto_publish_toggle.py"
        spec = importlib.util.spec_from_file_location("auto_publish_migration", migration_path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        engine = sa.create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        metadata = sa.MetaData()
        table = sa.Table(
            "social_profile_strategies", metadata,
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("schedule_enabled", sa.Boolean, nullable=False),
            sa.Column("auto_publish_enabled", sa.Boolean, nullable=False),
            sa.Column("schedule_times", sa.String, nullable=False),
        )
        with engine.begin() as connection:
            metadata.create_all(connection)
            combinations = [(False, False), (False, True), (True, False), (True, True)]
            connection.execute(table.insert(), [
                {"id": index, "schedule_enabled": scheduled, "auto_publish_enabled": publish, "schedule_times": "08:30,20:30"}
                for index, (scheduled, publish) in enumerate(combinations)
            ])
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            columns = {column["name"] for column in sa.inspect(connection).get_columns(table.name)}
            self.assertNotIn("schedule_enabled", columns)
            rows = connection.execute(sa.text("SELECT id, auto_publish_enabled, schedule_times FROM social_profile_strategies ORDER BY id")).all()
            self.assertEqual([bool(row.auto_publish_enabled) for row in rows], [False, False, False, True])
            self.assertTrue(all(row.schedule_times == "08:30,20:30" for row in rows))


if __name__ == "__main__":
    unittest.main()
