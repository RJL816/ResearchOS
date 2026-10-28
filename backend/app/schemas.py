"""Pydantic request/response models (API contract).

All datetimes are naive UTC (see app.utils.utcnow) and serialized as ISO-8601.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

ProjectStatus = Literal["active", "paused", "archived"]
IdeaStatus = Literal["exploring", "testing", "validated", "refuted", "parked"]
EdgeRelation = Literal["revision", "derivation", "merge", "challenges", "supersedes"]
RunStatus = Literal["planned", "running", "succeeded", "failed", "stopped"]
Verdict = Literal["supports", "refutes", "inconclusive"]


# ---------------------------------------------------------------- projects
class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    status: ProjectStatus = "active"


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    status: Optional[ProjectStatus] = None


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime


class ProjectWithCounts(ProjectRead):
    idea_count: int = 0
    run_count: int = 0
    note_count: int = 0


# ---------------------------------------------------------------- ideas
class IdeaCreate(BaseModel):
    """Creating an idea immediately produces its immutable version 1."""

    title: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=50000)
    change_reason: Optional[str] = Field(default=None, max_length=2000)


class IdeaUpdate(BaseModel):
    # Only identity-level fields are mutable; the hypothesis body lives in versions.
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    status: Optional[IdeaStatus] = None


class IdeaVersionCreate(BaseModel):
    body: str = Field(min_length=1, max_length=50000)
    change_reason: Optional[str] = Field(default=None, max_length=2000)


class IdeaVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    idea_id: int
    version_number: int
    body: str
    change_reason: Optional[str]
    created_at: datetime


class EvidenceOnVersion(BaseModel):
    """Evidence entry as shown on a hypothesis version (joins in run info)."""

    id: int
    verdict: str
    note: Optional[str]
    run_id: int
    run_name: str
    run_status: str
    created_at: datetime


class IdeaVersionDetail(IdeaVersionRead):
    evidence: list[EvidenceOnVersion] = []


class IdeaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    title: str
    status: str
    current_version_id: Optional[int]
    versions: list[IdeaVersionRead] = []
    created_at: datetime
    updated_at: datetime


class IdeaEdgeCreate(BaseModel):
    src_version_id: int
    dst_version_id: int
    relation: EdgeRelation
    note: Optional[str] = None


class IdeaEdgeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    src_version_id: int
    dst_version_id: int
    relation: str
    note: Optional[str]
    created_at: datetime


class IdeaGraph(BaseModel):
    idea: IdeaRead
    versions: list[IdeaVersionDetail]
    edges: list[IdeaEdgeRead]


# ---------------------------------------------------------------- runs
class RunCreate(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    status: RunStatus = "running"
    external_source: str = Field(default="manual", min_length=1, max_length=50)
    # Optional here: the service generates a stable key when omitted. Importers
    # must always provide both external fields (see app.importers.RunImportPayload).
    external_key: Optional[str] = Field(default=None, min_length=1, max_length=200)
    git_commit: Optional[str] = Field(default=None, max_length=64)
    dataset: Optional[str] = Field(default=None, max_length=200)
    eval_protocol: Optional[str] = None
    params: Optional[dict[str, Any]] = None
    notes: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class RunUpdate(BaseModel):
    # external_source / external_key are the run identity: not updatable here.
    name: Optional[str] = Field(default=None, min_length=1, max_length=300)
    status: Optional[RunStatus] = None
    git_commit: Optional[str] = Field(default=None, max_length=64)
    dataset: Optional[str] = Field(default=None, max_length=200)
    eval_protocol: Optional[str] = None
    params: Optional[dict[str, Any]] = None
    notes: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class RunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    name: str
    status: str
    external_source: str
    external_key: str
    git_commit: Optional[str]
    dataset: Optional[str]
    eval_protocol: Optional[str]
    notes: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    # Stored as params_json TEXT in SQLite; read back as a parsed dict.
    params: Optional[dict[str, Any]] = Field(default=None, validation_alias="params_json")

    @field_validator("params", mode="before")
    @classmethod
    def _parse_params_json(cls, v: Any) -> Any:
        if v is None or isinstance(v, dict):
            return v
        try:
            return json.loads(v)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Stored params_json is not valid JSON: {v!r}") from exc


class MetricPointCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    step: int = Field(ge=0)
    value: float
    timestamp: Optional[datetime] = None  # server defaults to utcnow when omitted


class MetricBulkCreate(BaseModel):
    points: list[MetricPointCreate] = Field(min_length=1, max_length=10000)


class MetricPointRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    step: int
    value: float
    timestamp: datetime


class MetricSeries(BaseModel):
    name: str
    points: list[MetricPointRead]


class RunMetricsOut(BaseModel):
    run_id: int
    series: list[MetricSeries]


class RunMetricStat(BaseModel):
    name: str
    count: int
    last_step: int
    last_value: float
    min_value: float
    max_value: float


class EvidenceOnRun(BaseModel):
    id: int
    verdict: str
    note: Optional[str]
    idea_id: int
    idea_title: str
    version_number: int
    created_at: datetime
    updated_at: datetime


class RunDetail(RunRead):
    metric_stats: list[RunMetricStat] = []
    evidence: list[EvidenceOnRun] = []


# ---------------------------------------------------------------- evidence
class EvidenceLinkCreate(BaseModel):
    idea_version_id: int
    run_id: int
    verdict: Verdict
    note: Optional[str] = None


class EvidenceLinkUpdate(BaseModel):
    verdict: Optional[Verdict] = None
    note: Optional[str] = None


class EvidenceLinkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    idea_version_id: int
    run_id: int
    verdict: str
    note: Optional[str]
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------- idea graph (Phase 2)
class GraphNode(BaseModel):
    """One IdeaVersion as a graph node; `id` is the stable idea_versions.id."""

    id: int
    idea_id: int
    title: str
    summary: str
    status: str  # the idea's DB status; never auto-derived from metrics
    version: int
    evidence_count: int
    run_count: int
    supports_count: int
    refutes_count: int
    created_at: datetime


class GraphEdgeData(BaseModel):
    id: int
    source: int  # src_version_id
    target: int  # dst_version_id
    relation: str  # revision | derivation | merge | challenges | supersedes
    reason: Optional[str] = None
    created_at: datetime


class ProjectIdeaGraph(BaseModel):
    project_id: int
    nodes: list[GraphNode]
    edges: list[GraphEdgeData]


class GraphVersionBrief(BaseModel):
    id: int
    idea_id: int
    title: str
    version_number: int
    status: str


class GraphRelationLink(BaseModel):
    edge_id: int
    relation: str
    reason: Optional[str]
    other: GraphVersionBrief


class RunMetricBrief(BaseModel):
    name: str
    last_step: int
    last_value: float


class EvidenceDetailItem(BaseModel):
    id: int
    verdict: str
    note: Optional[str]
    created_at: datetime
    run_id: int
    run_name: str
    run_status: str
    run_metrics: list[RunMetricBrief]


class IdeaDetailBrief(BaseModel):
    id: int
    project_id: int
    title: str
    status: str
    created_at: datetime
    updated_at: datetime


class IdeaVersionDetails(BaseModel):
    version: IdeaVersionRead
    idea: IdeaDetailBrief
    previous_version: Optional[IdeaVersionRead] = None
    incoming: list[GraphRelationLink]
    outgoing: list[GraphRelationLink]
    evidence: list[EvidenceDetailItem]
    notes: list[ResearchNoteRead]

# ---------------------------------------------------------------- conversations (Phase 3)
class ConversationImport(BaseModel):
    """Manual conversation import. Content is treated as untrusted data."""

    title: Optional[str] = Field(default=None, max_length=300)
    source: Literal["paste", "file_md", "file_txt", "file_json"] = "paste"
    content: str = Field(min_length=1)


class ConversationMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sequence: int
    role: str
    content: str
    sent_at: Optional[datetime]


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    title: str
    source: str
    content_hash: str
    message_count: int
    char_count: int
    created_at: datetime
    updated_at: datetime


class ConversationDetail(ConversationRead):
    messages: list[ConversationMessageRead] = []


class ConversationImportResult(BaseModel):
    conversation: ConversationDetail
    deduplicated: bool  # true when identical content already existed
    warnings: list[str] = []


class PayloadPreview(BaseModel):
    """Shows exactly what would be sent to the third-party model (masked)."""

    conversation_id: int
    segment_count: int
    segment_max_chars: int
    masked_chars: int
    segments: list[str]  # masked preview texts


# ---------------------------------------------------------------- analysis
class ResearchEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    sequence: int
    event_type: str
    title: str
    description: str
    source_message_ids: list[int] = []
    related_idea_version_ids: list[int] = []
    reasoning: str
    evidence_type: str
    uncertainty: str
    proposed_action: str
    matched_idea_id: Optional[int]
    match_status: str
    match_score: Optional[float]

    @field_validator("source_message_ids", "related_idea_version_ids", mode="before")
    @classmethod
    def _parse_json_list(cls, v: Any) -> Any:
        if v is None or isinstance(v, list):
            return v
        try:
            return json.loads(v)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Stored JSON list is not valid: {v!r}") from exc


class ProposalPayloadEdit(BaseModel):
    """User edits to a proposal before applying it. None fields stay unchanged."""

    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    body: Optional[str] = Field(default=None, min_length=1, max_length=50000)
    change_reason: Optional[str] = Field(default=None, max_length=2000)
    target_idea_id: Optional[int] = None
    relation: Optional[EdgeRelation] = None
    status: Optional[IdeaStatus] = None
    note_content: Optional[str] = Field(default=None, max_length=20000)


ReviewStatus = Literal["pending", "accepted", "rejected", "needs_revision", "applied"]


class ProposalReview(BaseModel):
    review_status: Optional[ReviewStatus] = None
    review_note: Optional[str] = Field(default=None, max_length=2000)
    edits: ProposalPayloadEdit = ProposalPayloadEdit()


class GraphChangeProposalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    project_id: int
    event_id: Optional[int]
    action_type: str
    target_entity_id: Optional[int]
    payload: dict[str, Any] = {}
    source_message_ids: list[int] = []
    explanation: str
    review_status: str
    depends_on_proposal_ids: list[int] = []
    baseline_version_id: Optional[int]
    review_note: Optional[str]
    applied_batch_id: Optional[int]
    applied_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    @field_validator("payload", mode="before")
    @classmethod
    def _parse_payload(cls, v: Any) -> Any:
        if v is None or isinstance(v, dict):
            return v
        try:
            return json.loads(v)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Stored payload_json is not valid JSON: {v!r}") from exc

    @field_validator("source_message_ids", "depends_on_proposal_ids", mode="before")
    @classmethod
    def _parse_json_list(cls, v: Any) -> Any:
        if v is None or isinstance(v, list):
            return v
        try:
            return json.loads(v)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Stored JSON list is not valid: {v!r}") from exc


class AnalysisJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    conversation_id: int
    status: str
    model: str
    prompt_version: str
    segment_count: int
    error: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class AnalysisJobSummary(AnalysisJobRead):
    event_count: int = 0
    proposal_count: int = 0
    pending_count: int = 0
    accepted_count: int = 0
    applied_count: int = 0


class ApplyResult(BaseModel):
    batch_id: int
    applied: list[dict[str, Any]]
    skipped: list[dict[str, Any]]  # already applied (idempotent replay)
    blocked: list[dict[str, Any]]  # marked needs_revision (version conflict etc.)
    conversation_title: Optional[str] = None


class ProposalSummary(BaseModel):
    pending_count: int
    total_count: int
    latest_job_id: Optional[int]


# ---------------------------------------------------------------- notes
class ResearchNoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: Optional[str] = None
    idea_id: Optional[int] = None
    run_id: Optional[int] = None


class ResearchNoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    content: Optional[str] = None


class ResearchNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    idea_id: Optional[int]
    run_id: Optional[int]
    title: str
    content: Optional[str]
    created_at: datetime
    updated_at: datetime
