"""add_topic_embeddings

Revision ID: a31c4d2e9b07
Revises: 8c27a845e0d1
Create Date: 2026-08-29 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

from common.db.vector import Vector


revision = "a31c4d2e9b07"
down_revision = "8c27a845e0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "topic_embeddings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("topic_key", sa.String(length=255), nullable=False),
        sa.Column("topic", sa.Text(), nullable=False),
        sa.Column("embedding_text", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(), nullable=False),
        sa.Column("model_name", sa.String(length=120), nullable=False),
        sa.Column("embedding_dim", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("topic_key", "model_name", name="uq_topic_embedding_model"),
    )
    op.create_index(op.f("ix_topic_embeddings_model_name"), "topic_embeddings", ["model_name"], unique=False)
    op.create_index(op.f("ix_topic_embeddings_topic_key"), "topic_embeddings", ["topic_key"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_topic_embeddings_topic_key"), table_name="topic_embeddings")
    op.drop_index(op.f("ix_topic_embeddings_model_name"), table_name="topic_embeddings")
    op.drop_table("topic_embeddings")
