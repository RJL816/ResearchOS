"""ORM models for Research OS.

Conventions:
- Integer autoincrement primary keys; all timestamps are naive UTC (see utils.utcnow).
- IdeaVersion is immutable by design: it has created_at but no updated_at, and no
  API route ever updates its body. Evolution happens by appending new versions.
- ExperimentRun is uniquely keyed by (project_id, external_source, external_key) so
  that future file importers can upsert runs idempotently.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .utils import utcnow

PROJECT_STATUSES = ("active", "paused", "archived")
IDEA_STATUSES = ("exploring", "testing", "validated", "refuted", "parked")
EDGE_RELATIONS = ("revision", "derivation", "merge", "challenges", "supersedes")
RUN_STATUSES = ("planned", "running", "succeeded", "failed", "stopped")
EVIDENCE_VERDICTS = ("supports", "refutes", "inconclusive")

# Phase 3: conversation analysis pipeline
CONVERSATION_SOURCES = ("paste", "file_md", "file_txt", "file_json")
MESSAGE_ROLES = ("user", "assistant", "system")
JOB_STATUSES = ("pending", "parsing", "extracting", "matching", "proposing", "completed", "failed")
EVENT_TYPES = (
    "idea_created",
    "idea_refined",
    "idea_branched",
    "idea_merged",
    "idea_challenged",
    "idea_rejected",
    "research_decision",
    "open_question",
    "experiment_observation",
)
EVIDENCE_TYPES = ("user_decision", "ai_suggestion", "discussion", "experiment_result", "other")
UNCERTAINTY_LEVELS = ("low", "medium", "high")
ACTION_TYPES = (
    "create_idea",
    "create_idea_version",
    "create_idea_edge",
    "add_research_note",
    "add_open_question",
    "propose_status_change",
    "link_existing_idea",
)
REVIEW_STATUSES = ("pending", "accepted", "rejected", "needs_revision", "applied")
SOURCE_ENTITY_TYPES = ("idea", "idea_version", "idea_edge", "note")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


def _in_check(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    literal = ", ".join(f"'{v}'" for v in values)
    return CheckConstraint(f"{column} IN ({literal})", name=name)


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    __table_args__ = (_in_check("status", PROJECT_STATUSES, "ck_projects_status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

    ideas: Mapped[list[Idea]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    runs: Mapped[list[ExperimentRun]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    notes: Mapped[list[ResearchNote]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )


class ResearchIdea(Base, TimestampMixin):
    """A research direction or proposal, separate from testable hypotheses."""
    __tablename__ = "research_ideas"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="exploring", server_default="exploring")
    status_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decision_source: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decision_time: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    related_evidence: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    background: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    goal: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    methods: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    innovation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    theory: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    results: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    conclusions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    future_plan: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class ResearchIdeaVersion(Base):
    __tablename__ = "research_idea_versions"
    __table_args__ = (UniqueConstraint("research_idea_id", "version_number", name="uq_research_idea_version"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    research_idea_id: Mapped[int] = mapped_column(ForeignKey("research_ideas.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    change_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class ResearchEvolutionEdge(Base, TimestampMixin):
    __tablename__ = "research_evolution_edges"
    __table_args__ = (CheckConstraint("source_id <> target_id", name="ck_research_evolution_no_self"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("research_ideas.id", ondelete="CASCADE"), nullable=False)
    target_id: Mapped[int] = mapped_column(ForeignKey("research_ideas.id", ondelete="CASCADE"), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(30), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    trigger_type: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    trigger_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_references: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    linked_run_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")


class ResearchEvolutionImport(Base):
    __tablename__ = "research_evolution_imports"
    __table_args__ = (UniqueConstraint("project_id", "content_hash", name="uq_research_evolution_import"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class ResearchConclusion(Base, TimestampMixin):
    __tablename__ = "research_conclusions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    research_idea_id: Mapped[int] = mapped_column(ForeignKey("research_ideas.id", ondelete="CASCADE"), nullable=False, index=True)
    run_id: Mapped[Optional[int]] = mapped_column(ForeignKey("experiment_runs.id", ondelete="SET NULL"), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)


class ResearchIdeaDocument(Base, TimestampMixin):
    __tablename__ = "research_idea_documents"
    __table_args__ = (UniqueConstraint("research_idea_id", "content_hash", name="uq_research_idea_document_hash"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    research_idea_id: Mapped[int] = mapped_column(ForeignKey("research_ideas.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    extracted_json: Mapped[str] = mapped_column(Text, nullable=False)


class Idea(Base, TimestampMixin):
    """Stable identity of a research hypothesis; content lives in its versions."""

    __tablename__ = "ideas"
    __table_args__ = (
        UniqueConstraint("project_id", "title", name="uq_ideas_project_title"),
        _in_check("status", IDEA_STATUSES, "ck_ideas_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    research_idea_id: Mapped[Optional[int]] = mapped_column(ForeignKey("research_ideas.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="exploring")
    # Points at the newest version. Nullable + SET NULL because of the circular
    # reference with idea_versions.idea_id (SQLite allows forward FK references).
    current_version_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("idea_versions.id", ondelete="SET NULL"), nullable=True
    )

    project: Mapped[Project] = relationship(back_populates="ideas")
    # ideas <-> idea_versions has two FK paths (idea_versions.idea_id and
    # ideas.current_version_id), so both relationships need explicit foreign_keys.
    versions: Mapped[list[IdeaVersion]] = relationship(
        back_populates="idea",
        foreign_keys="IdeaVersion.idea_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="IdeaVersion.version_number",
    )
    current_version: Mapped[Optional[IdeaVersion]] = relationship(
        primaryjoin="Idea.current_version_id == IdeaVersion.id",
        foreign_keys=[current_version_id],
    )


class IdeaVersion(Base):
    """Immutable snapshot of a hypothesis body. Never updated in place."""

    __tablename__ = "idea_versions"
    __table_args__ = (UniqueConstraint("idea_id", "version_number", name="uq_idea_versions_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    idea_id: Mapped[int] = mapped_column(
        ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    change_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    idea: Mapped[Idea] = relationship(back_populates="versions", foreign_keys=[idea_id])
    evidence_links: Mapped[list[EvidenceLink]] = relationship(
        back_populates="idea_version", cascade="all, delete-orphan", passive_deletes=True
    )


class IdeaEdge(Base):
    """Evolution relation between two hypothesis versions (graph edge)."""

    __tablename__ = "idea_edges"
    __table_args__ = (
        UniqueConstraint("src_version_id", "dst_version_id", "relation", name="uq_idea_edges_triple"),
        CheckConstraint("src_version_id <> dst_version_id", name="ck_idea_edges_no_self_loop"),
        _in_check("relation", EDGE_RELATIONS, "ck_idea_edges_relation"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    src_version_id: Mapped[int] = mapped_column(
        ForeignKey("idea_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    dst_version_id: Mapped[int] = mapped_column(
        ForeignKey("idea_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    relation: Mapped[str] = mapped_column(String(30), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    src_version: Mapped[IdeaVersion] = relationship(
        primaryjoin="IdeaEdge.src_version_id == IdeaVersion.id",
        foreign_keys=[src_version_id],
    )
    dst_version: Mapped[IdeaVersion] = relationship(
        primaryjoin="IdeaEdge.dst_version_id == IdeaVersion.id",
        foreign_keys=[dst_version_id],
    )


class ExperimentRun(Base, TimestampMixin):
    __tablename__ = "experiment_runs"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "external_source", "external_key", name="uq_experiment_runs_external"
        ),
        _in_check("status", RUN_STATUSES, "ck_experiment_runs_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    research_idea_id: Mapped[Optional[int]] = mapped_column(ForeignKey("research_ideas.id", ondelete="SET NULL"), nullable=True)
    target_version_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("idea_versions.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    # Idempotency anchor: the same (source, key) pair always maps to one run row.
    external_source: Mapped[str] = mapped_column(String(50), nullable=False, default="manual")
    external_key: Mapped[str] = mapped_column(String(200), nullable=False)
    git_commit: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    dataset: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    eval_protocol: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    params_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    project: Mapped[Project] = relationship(back_populates="runs")
    metrics: Mapped[list[MetricPoint]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="MetricPoint.step",
    )
    evidence_links: Mapped[list[EvidenceLink]] = relationship(
        back_populates="run", cascade="all, delete-orphan", passive_deletes=True
    )


class MetricPoint(Base):
    """One (metric name, step) sample of a run, with its original timestamp."""

    __tablename__ = "metric_points"
    __table_args__ = (
        UniqueConstraint("run_id", "name", "step", name="uq_metric_points_run_name_step"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("experiment_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    step: Mapped[int] = mapped_column(Integer, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    run: Mapped[ExperimentRun] = relationship(back_populates="metrics")


class EvidenceLink(Base, TimestampMixin):
    __tablename__ = "evidence_links"
    __table_args__ = (
        UniqueConstraint("idea_version_id", "run_id", name="uq_evidence_links_version_run"),
        _in_check("verdict", EVIDENCE_VERDICTS, "ck_evidence_links_verdict"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    idea_version_id: Mapped[int] = mapped_column(
        ForeignKey("idea_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    run_id: Mapped[int] = mapped_column(
        ForeignKey("experiment_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    verdict: Mapped[str] = mapped_column(String(20), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    idea_version: Mapped[IdeaVersion] = relationship(back_populates="evidence_links")
    run: Mapped[ExperimentRun] = relationship(back_populates="evidence_links")


class ResearchNote(Base, TimestampMixin):
    __tablename__ = "research_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Optional anchors; SET NULL so deleting an idea/run keeps the note text.
    idea_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("ideas.id", ondelete="SET NULL"), nullable=True, index=True
    )
    run_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("experiment_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    is_done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    project: Mapped[Project] = relationship(back_populates="notes")


# ================================================================ Phase 3
class Conversation(Base, TimestampMixin):
    """An imported AI research conversation (immutable once imported)."""

    __tablename__ = "conversations"
    __table_args__ = (
        # Dedup anchor: importing the identical content into one project twice
        # returns the existing conversation instead of creating a copy.
        UniqueConstraint("project_id", "content_hash", name="uq_conversations_project_hash"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # paste | file_md | file_txt | file_json
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    project: Mapped[Project] = relationship()
    messages: Mapped[list[ConversationMessage]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ConversationMessage.sequence",
    )


class ConversationMessage(Base):
    """One message of an imported conversation. Content is untrusted data."""

    __tablename__ = "conversation_messages"
    __table_args__ = (UniqueConstraint("conversation_id", "sequence", name="uq_conversation_messages_seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-based global order
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user | assistant | system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class AnalysisJob(Base, TimestampMixin):
    """One AI analysis run over a conversation. Records model/prompt for reproducibility."""

    __tablename__ = "analysis_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    model: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    prompt_version: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    segment_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    events: Mapped[list[ResearchEvent]] = relationship(
        back_populates="job", cascade="all, delete-orphan", passive_deletes=True
    )
    proposals: Mapped[list[GraphChangeProposal]] = relationship(
        back_populates="job", cascade="all, delete-orphan", passive_deletes=True
    )


class ResearchEvent(Base):
    """A research-relevant event extracted from a conversation. Traceable to messages."""

    __tablename__ = "research_events"
    __table_args__ = (_in_check("event_type", EVENT_TYPES, "ck_research_events_type"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # JSON arrays of conversation_messages.id (validated: unknown ids are dropped)
    source_message_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    related_idea_version_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    reasoning: Mapped[str] = mapped_column(Text, nullable=False, default="")
    evidence_type: Mapped[str] = mapped_column(String(30), nullable=False, default="discussion")
    uncertainty: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    proposed_action: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # IdeaGraphMatcher result
    matched_idea_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    match_status: Mapped[str] = mapped_column(String(20), nullable=False, default="needs_review")
    match_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    job: Mapped[AnalysisJob] = relationship(back_populates="events")


class GraphChangeProposal(Base, TimestampMixin):
    """One AI-suggested graph change. Applied only after explicit human review."""

    __tablename__ = "graph_change_proposals"
    __table_args__ = (_in_check("action_type", ACTION_TYPES, "ck_graph_change_proposals_action"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("research_events.id", ondelete="SET NULL"), nullable=True
    )
    action_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    source_message_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    explanation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    review_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    # Proposals whose apply results this proposal depends on (e.g. an edge that
    # points at a version created by another proposal in the same changeset).
    depends_on_proposal_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # current_version_id of the target idea at proposal time; detects version
    # conflicts between review and apply.
    baseline_version_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    applied_batch_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("apply_batches.id", ondelete="SET NULL"), nullable=True
    )
    applied_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    job: Mapped[AnalysisJob] = relationship(back_populates="proposals")
    applied_batch: Mapped[Optional[ApplyBatch]] = relationship()

    @property
    def payload(self) -> dict:
        """Parsed view of payload_json for API serialization."""
        import json as _json

        try:
            return _json.loads(self.payload_json)
        except (TypeError, ValueError):
            return {}


class ApplyBatch(Base):
    """One transactional apply run; makes repeated applies idempotent and auditable."""

    __tablename__ = "apply_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    proposal_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class MessageSourceLink(Base):
    """Provenance: which conversation messages produced an applied graph entity."""

    __tablename__ = "message_source_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)  # idea | idea_version | idea_edge | note
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    message_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (
        _in_check("entity_type", SOURCE_ENTITY_TYPES, "ck_message_source_links_entity"),
        UniqueConstraint(
            "entity_type", "entity_id", "conversation_id", name="uq_message_source_links_entity_conv"
        ),
    )
