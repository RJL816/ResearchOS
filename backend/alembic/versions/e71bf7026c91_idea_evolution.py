"""Preserve complete research ideas and explicit, evidence-optional evolution."""
from alembic import op
import sqlalchemy as sa
import json
revision="e71bf7026c91"
down_revision="d53fa72823bc"
branch_labels=None
depends_on=None


def upgrade():
    op.add_column("research_ideas", sa.Column("status", sa.String(20), nullable=False, server_default="exploring"))
    for name in ("status_reason", "decision_source", "decision_time", "related_evidence"):
        op.add_column("research_ideas", sa.Column(name, sa.Text, nullable=True))
    op.create_table("research_idea_versions", sa.Column("id",sa.Integer,primary_key=True), sa.Column("research_idea_id",sa.Integer,sa.ForeignKey("research_ideas.id",ondelete="CASCADE"),nullable=False), sa.Column("version_number",sa.Integer,nullable=False), sa.Column("snapshot_json",sa.Text,nullable=False), sa.Column("change_reason",sa.Text), sa.Column("created_at",sa.DateTime,nullable=False), sa.UniqueConstraint("research_idea_id","version_number",name="uq_research_idea_version"))
    op.create_index("ix_research_idea_versions_research_idea_id","research_idea_versions",["research_idea_id"])
    op.create_table("research_evolution_edges",sa.Column("id",sa.Integer,primary_key=True),sa.Column("project_id",sa.Integer,sa.ForeignKey("projects.id",ondelete="CASCADE"),nullable=False),sa.Column("source_id",sa.Integer,sa.ForeignKey("research_ideas.id",ondelete="CASCADE"),nullable=False),sa.Column("target_id",sa.Integer,sa.ForeignKey("research_ideas.id",ondelete="CASCADE"),nullable=False),sa.Column("relation_type",sa.String(30),nullable=False),sa.Column("reason",sa.Text),sa.Column("trigger_type",sa.String(30)),sa.Column("trigger_description",sa.Text),sa.Column("source_references",sa.Text),sa.Column("linked_run_ids",sa.Text,nullable=False),sa.Column("created_at",sa.DateTime,nullable=False),sa.Column("updated_at",sa.DateTime,nullable=False),sa.CheckConstraint("source_id <> target_id",name="ck_research_evolution_no_self"))
    op.create_index("ix_research_evolution_edges_project_id","research_evolution_edges",["project_id"])
    op.create_table("research_evolution_imports",sa.Column("id",sa.Integer,primary_key=True),sa.Column("project_id",sa.Integer,sa.ForeignKey("projects.id",ondelete="CASCADE"),nullable=False),sa.Column("content_hash",sa.String(64),nullable=False),sa.Column("filename",sa.String(300),nullable=False),sa.Column("content",sa.Text,nullable=False),sa.Column("created_at",sa.DateTime,nullable=False),sa.UniqueConstraint("project_id","content_hash",name="uq_research_evolution_import"))
    op.create_index("ix_research_evolution_imports_project_id","research_evolution_imports",["project_id"])
    conn=op.get_bind()
    rows=conn.execute(sa.text("SELECT * FROM research_ideas")).mappings().all()
    fields=("title","status","status_reason","decision_source","decision_time","related_evidence","background","goal","methods","innovation","theory","results","conclusions","future_plan")
    for row in rows:
        conn.execute(sa.text("INSERT INTO research_idea_versions (research_idea_id,version_number,snapshot_json,change_reason,created_at) VALUES (:id,1,:snapshot,:reason,:created)"),{"id":row["id"],"snapshot":json.dumps({f:row[f] for f in fields},ensure_ascii=False),"reason":"迁移前已有研究思路","created":row["created_at"]})

def downgrade():
    op.drop_table("research_evolution_imports")
    op.drop_table("research_evolution_edges")
    op.drop_table("research_idea_versions")
    with op.batch_alter_table("research_ideas") as batch:
        for name in ("related_evidence","decision_time","decision_source","status_reason","status"): batch.drop_column(name)
