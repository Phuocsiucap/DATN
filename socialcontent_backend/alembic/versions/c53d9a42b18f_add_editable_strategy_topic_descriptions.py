"""add_editable_strategy_topic_descriptions

Revision ID: c53d9a42b18f
Revises: b42f6e18c9d2
Create Date: 2026-08-29 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "c53d9a42b18f"
down_revision = "b42f6e18c9d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "social_profile_strategies",
        sa.Column(
            "content_topic_descriptions",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "social_profile_strategies",
        sa.Column(
            "avoid_topic_descriptions",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )

    op.add_column("topic_embeddings", sa.Column("embedding_text_hash", sa.String(length=64), nullable=True))
    op.execute("UPDATE topic_embeddings SET embedding_text_hash = md5(COALESCE(embedding_text, '')) WHERE embedding_text_hash IS NULL")
    op.alter_column("topic_embeddings", "embedding_text_hash", nullable=False)
    op.execute("ALTER TABLE topic_embeddings DROP CONSTRAINT IF EXISTS uq_topic_embedding_model")
    op.create_unique_constraint(
        "uq_topic_embedding_model_text",
        "topic_embeddings",
        ["topic_key", "model_name", "embedding_text_hash"],
    )
    op.create_index(op.f("ix_topic_embeddings_embedding_text_hash"), "topic_embeddings", ["embedding_text_hash"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_topic_embeddings_embedding_text_hash"), table_name="topic_embeddings")
    op.drop_constraint("uq_topic_embedding_model_text", "topic_embeddings", type_="unique")
    op.create_unique_constraint("uq_topic_embedding_model", "topic_embeddings", ["topic_key", "model_name"])
    op.drop_column("topic_embeddings", "embedding_text_hash")
    op.drop_column("social_profile_strategies", "avoid_topic_descriptions")
    op.drop_column("social_profile_strategies", "content_topic_descriptions")
