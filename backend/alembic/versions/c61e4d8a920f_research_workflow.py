"""Preserve experiment targets and completion of open questions."""
from alembic import op
import sqlalchemy as sa

revision = "c61e4d8a920f"
down_revision = "b5d7f2a8c3e1"
branch_labels = None
depends_on = None


def upgrade():
    # ADD COLUMN avoids rebuilding tables referenced by existing research data.
    op.execute("ALTER TABLE experiment_runs ADD COLUMN target_version_id INTEGER "
               "REFERENCES idea_versions(id) ON DELETE SET NULL")
    op.add_column("research_notes", sa.Column("is_done", sa.Boolean(),
        nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table("experiment_runs") as batch:
        batch.drop_column("target_version_id")
    with op.batch_alter_table("research_notes") as batch:
        batch.drop_column("is_done")
