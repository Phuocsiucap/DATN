"""move workflow link to media workflow

Revision ID: 2c41b8a5e9d7
Revises: a98fcbe25208
Create Date: 2026-09-11 00:30:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "2c41b8a5e9d7"
down_revision = "a98fcbe25208"
branch_labels = None
depends_on = None


def _fk_names(inspector, table_name: str) -> set[str]:
    return {fk["name"] for fk in inspector.get_foreign_keys(table_name)}


def _index_names(inspector, table_name: str) -> set[str]:
    return {idx["name"] for idx in inspector.get_indexes(table_name)}


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    media_columns = _column_names(inspector, "media_workflow")
    candidate_columns = _column_names(inspector, "planning_candidates")

    if "planning_candidate_id" not in media_columns:
        op.add_column(
            "media_workflow",
            sa.Column("planning_candidate_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        inspector = inspect(bind)
        media_columns = _column_names(inspector, "media_workflow")

    if "workflow_id" in candidate_columns:
        op.execute(
            """
            WITH ranked_links AS (
                SELECT
                    pc.id AS candidate_id,
                    pc.workflow_id,
                    row_number() OVER (PARTITION BY pc.workflow_id ORDER BY pc.created_at, pc.id) AS rn
                FROM planning_candidates AS pc
                WHERE pc.workflow_id IS NOT NULL
            )
            UPDATE media_workflow AS mw
            SET planning_candidate_id = ranked_links.candidate_id
            FROM ranked_links
            WHERE ranked_links.workflow_id = mw.id
              AND ranked_links.rn = 1
              AND mw.planning_candidate_id IS NULL
            """
        )

    inspector = inspect(bind)
    fk_names = _fk_names(inspector, "media_workflow")
    if "media_workflow_planning_candidate_id_fkey" not in fk_names:
        op.create_foreign_key(
            "media_workflow_planning_candidate_id_fkey",
            "media_workflow",
            "planning_candidates",
            ["planning_candidate_id"],
            ["id"],
            ondelete="SET NULL",
        )

    inspector = inspect(bind)
    index_names = _index_names(inspector, "media_workflow")
    if "ix_media_workflow_planning_candidate_id" not in index_names:
        op.create_index(
            "ix_media_workflow_planning_candidate_id",
            "media_workflow",
            ["planning_candidate_id"],
            unique=True,
        )

    inspector = inspect(bind)
    candidate_columns = _column_names(inspector, "planning_candidates")
    if "workflow_id" in candidate_columns:
        candidate_indexes = _index_names(inspector, "planning_candidates")
        if "ix_planning_candidates_workflow_id" in candidate_indexes:
            op.drop_index("ix_planning_candidates_workflow_id", table_name="planning_candidates")

        candidate_fks = _fk_names(inspector, "planning_candidates")
        if "planning_candidates_workflow_id_fkey" in candidate_fks:
            op.drop_constraint("planning_candidates_workflow_id_fkey", "planning_candidates", type_="foreignkey")

        op.drop_column("planning_candidates", "workflow_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    candidate_columns = _column_names(inspector, "planning_candidates")

    if "workflow_id" not in candidate_columns:
        op.add_column(
            "planning_candidates",
            sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.execute(
            """
            UPDATE planning_candidates AS pc
            SET workflow_id = mw.id
            FROM media_workflow AS mw
            WHERE mw.planning_candidate_id = pc.id
            """
        )
        op.create_foreign_key(
            "planning_candidates_workflow_id_fkey",
            "planning_candidates",
            "media_workflow",
            ["workflow_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_index("ix_planning_candidates_workflow_id", "planning_candidates", ["workflow_id"], unique=False)

    inspector = inspect(bind)
    media_columns = _column_names(inspector, "media_workflow")
    if "planning_candidate_id" in media_columns:
        media_indexes = _index_names(inspector, "media_workflow")
        if "ix_media_workflow_planning_candidate_id" in media_indexes:
            op.drop_index("ix_media_workflow_planning_candidate_id", table_name="media_workflow")

        media_fks = _fk_names(inspector, "media_workflow")
        if "media_workflow_planning_candidate_id_fkey" in media_fks:
            op.drop_constraint("media_workflow_planning_candidate_id_fkey", "media_workflow", type_="foreignkey")

        op.drop_column("media_workflow", "planning_candidate_id")
