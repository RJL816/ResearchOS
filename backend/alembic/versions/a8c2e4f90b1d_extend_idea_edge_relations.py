"""extend idea_edges relation with challenges and supersedes

SQLite CHECK constraints are immutable, so the table is rebuilt in batch mode
(same constraint/index names, data preserved).

Revision ID: a8c2e4f90b1d
Revises: 379ef1b7f3d7
Create Date: 2026-10-27

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8c2e4f90b1d"
down_revision: Union[str, None] = "379ef1b7f3d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_RELATIONS = ("revision", "derivation", "merge")
NEW_RELATIONS = ("revision", "derivation", "merge", "challenges", "supersedes")

# Must mirror app.database.convention so rebuilt constraints keep their names.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def _relation_check(values: tuple[str, ...]) -> sa.CheckConstraint:
    literal = ", ".join(f"'{v}'" for v in values)
    return sa.CheckConstraint(f"relation IN ({literal})", name="ck_idea_edges_relation")


def _idea_edges_table(relation_check: sa.CheckConstraint) -> sa.Table:
    return sa.Table(
        "idea_edges",
        sa.MetaData(naming_convention=NAMING_CONVENTION),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "src_version_id",
            sa.Integer(),
            sa.ForeignKey("idea_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "dst_version_id",
            sa.Integer(),
            sa.ForeignKey("idea_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("relation", sa.String(length=30), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("src_version_id", "dst_version_id", "relation", name="uq_idea_edges_triple"),
        sa.CheckConstraint("src_version_id <> dst_version_id", name="ck_idea_edges_no_self_loop"),
        relation_check,
        sa.Index("ix_idea_edges_src_version_id", "src_version_id"),
        sa.Index("ix_idea_edges_dst_version_id", "dst_version_id"),
    )


def upgrade() -> None:
    old_table = _idea_edges_table(_relation_check(OLD_RELATIONS))
    with op.batch_alter_table("idea_edges", copy_from=old_table, recreate="always") as batch_op:
        batch_op.drop_constraint("ck_idea_edges_relation", type_="check")
        batch_op.create_check_constraint(
            "ck_idea_edges_relation", "relation IN ('revision', 'derivation', 'merge', 'challenges', 'supersedes')"
        )


def downgrade() -> None:
    # Rows using the new relations are deleted: downgrading is destructive for them.
    op.execute("DELETE FROM idea_edges WHERE relation IN ('challenges', 'supersedes')")
    current_table = _idea_edges_table(_relation_check(NEW_RELATIONS))
    with op.batch_alter_table("idea_edges", copy_from=current_table, recreate="always") as batch_op:
        batch_op.drop_constraint("ck_idea_edges_relation", type_="check")
        batch_op.create_check_constraint(
            "ck_idea_edges_relation", "relation IN ('revision', 'derivation', 'merge')"
        )
