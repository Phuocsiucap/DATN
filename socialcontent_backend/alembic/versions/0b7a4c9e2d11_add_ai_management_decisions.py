"""Add AI management analysis runs and decisions."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0b7a4c9e2d11"
down_revision = ("a1b2c3d4e5f6", "e2f4a6b8c9d1")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "social_profile_strategies",
        sa.Column("ai_management_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "social_profile_strategies",
        sa.Column("ai_management_frequency_days", sa.Integer(), nullable=False, server_default="7"),
    )
    op.add_column(
        "social_profile_strategies",
        sa.Column("ai_management_last_analysis_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column("social_profile_strategies", "ai_management_enabled", server_default=None)
    op.alter_column("social_profile_strategies", "ai_management_frequency_days", server_default=None)

    op.create_table(
        "ai_analysis_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trigger_type", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("data_range_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("data_range_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("input_jsonb", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("output_jsonb", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["social_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_analysis_runs_profile_id", "ai_analysis_runs", ["profile_id"])
    op.create_index("ix_ai_analysis_runs_status", "ai_analysis_runs", ["status"])
    op.create_index("ix_ai_analysis_runs_trigger_type", "ai_analysis_runs", ["trigger_type"])

    op.create_table(
        "ai_content_decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("analysis_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("decision_type", sa.String(length=60), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("target_audience", sa.Text(), nullable=True),
        sa.Column("recommended_topics", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("recommended_posting_times", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("growth_insights", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("content_warnings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("confidence_score", sa.Float(), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["analysis_run_id"], ["ai_analysis_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["social_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_content_decisions_analysis_run_id", "ai_content_decisions", ["analysis_run_id"])
    op.create_index("ix_ai_content_decisions_decision_type", "ai_content_decisions", ["decision_type"])
    op.create_index("ix_ai_content_decisions_profile_id", "ai_content_decisions", ["profile_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_content_decisions_profile_id", table_name="ai_content_decisions")
    op.drop_index("ix_ai_content_decisions_decision_type", table_name="ai_content_decisions")
    op.drop_index("ix_ai_content_decisions_analysis_run_id", table_name="ai_content_decisions")
    op.drop_table("ai_content_decisions")

    op.drop_index("ix_ai_analysis_runs_trigger_type", table_name="ai_analysis_runs")
    op.drop_index("ix_ai_analysis_runs_status", table_name="ai_analysis_runs")
    op.drop_index("ix_ai_analysis_runs_profile_id", table_name="ai_analysis_runs")
    op.drop_table("ai_analysis_runs")

    op.drop_column("social_profile_strategies", "ai_management_last_analysis_at")
    op.drop_column("social_profile_strategies", "ai_management_frequency_days")
    op.drop_column("social_profile_strategies", "ai_management_enabled")
