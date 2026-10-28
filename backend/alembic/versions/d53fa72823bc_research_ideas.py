"""Add research ideas and their original documents without changing hypotheses."""
from alembic import op
import sqlalchemy as sa
revision = "d53fa72823bc"
down_revision = "c61e4d8a920f"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("research_ideas", sa.Column("id", sa.Integer, primary_key=True), sa.Column("project_id", sa.Integer, sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False), sa.Column("title", sa.String(300), nullable=False), *[sa.Column(name, sa.Text, nullable=True) for name in ("background", "goal", "methods", "innovation", "theory", "results", "conclusions", "future_plan")], sa.Column("created_at", sa.DateTime, nullable=False), sa.Column("updated_at", sa.DateTime, nullable=False))
    op.create_index("ix_research_ideas_project_id", "research_ideas", ["project_id"])
    op.create_table("research_idea_documents", sa.Column("id", sa.Integer, primary_key=True), sa.Column("research_idea_id", sa.Integer, sa.ForeignKey("research_ideas.id", ondelete="CASCADE"), nullable=False), sa.Column("filename", sa.String(300), nullable=False), sa.Column("content_hash", sa.String(64), nullable=False), sa.Column("content", sa.Text, nullable=False), sa.Column("extracted_json", sa.Text, nullable=False), sa.Column("created_at", sa.DateTime, nullable=False), sa.Column("updated_at", sa.DateTime, nullable=False), sa.UniqueConstraint("research_idea_id", "content_hash", name="uq_research_idea_document_hash"))
    op.create_index("ix_research_idea_documents_research_idea_id", "research_idea_documents", ["research_idea_id"])
    op.create_table("research_conclusions", sa.Column("id", sa.Integer, primary_key=True), sa.Column("research_idea_id", sa.Integer, sa.ForeignKey("research_ideas.id", ondelete="CASCADE"), nullable=False), sa.Column("run_id", sa.Integer, sa.ForeignKey("experiment_runs.id", ondelete="SET NULL"), nullable=True), sa.Column("content", sa.Text, nullable=False), sa.Column("created_at", sa.DateTime, nullable=False), sa.Column("updated_at", sa.DateTime, nullable=False))
    op.create_index("ix_research_conclusions_research_idea_id", "research_conclusions", ["research_idea_id"])
    op.execute("ALTER TABLE ideas ADD COLUMN research_idea_id INTEGER REFERENCES research_ideas(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE experiment_runs ADD COLUMN research_idea_id INTEGER REFERENCES research_ideas(id) ON DELETE SET NULL")


def downgrade():
    with op.batch_alter_table("experiment_runs") as batch: batch.drop_column("research_idea_id")
    with op.batch_alter_table("ideas") as batch: batch.drop_column("research_idea_id")
    op.drop_table("research_conclusions")
    op.drop_table("research_idea_documents")
    op.drop_table("research_ideas")
