"""add job_id to message_source_links

Revision ID: b5d7f2a8c3e1
Revises: 97c25f52f8f4
Create Date: 2026-10-27

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5d7f2a8c3e1"
down_revision: Union[str, None] = "97c25f52f8f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("message_source_links") as batch_op:
        batch_op.add_column(sa.Column("job_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_message_source_links_job_id_analysis_jobs",
            "analysis_jobs",
            ["job_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_message_source_links_job_id", ["job_id"])


def downgrade() -> None:
    with op.batch_alter_table("message_source_links") as batch_op:
        batch_op.drop_index("ix_message_source_links_job_id")
        batch_op.drop_constraint(
            "fk_message_source_links_job_id_analysis_jobs", type_="foreignkey"
        )
        batch_op.drop_column("job_id")
