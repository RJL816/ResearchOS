"""Keep incomplete research evolution imports across application restarts."""
from alembic import op
import sqlalchemy as sa

revision = "f812a91c2340"
down_revision = "e71bf7026c91"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "evolution_parse_history",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("project_id", sa.Integer, sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("filename", sa.String(300), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("result_json", sa.Text),
        sa.Column("checkpoints_json", sa.Text, nullable=False),
        sa.Column("imported", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("project_id", "content_hash", name="uq_evolution_parse_history_source"),
    )
    op.create_index("ix_evolution_parse_history_project_id", "evolution_parse_history", ["project_id"])


def downgrade():
    op.drop_table("evolution_parse_history")
