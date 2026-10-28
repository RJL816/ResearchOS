"""Agent output import: parse an assistant-produced JSON envelope and apply it.

Contract (schema mirrors app.ai.agent_prompts so prompt and parser evolve
together):
- Cross-references use short refs defined inside the document ("idea-a").
- References to ALREADY-EXISTING entities accept a numeric id or an exact
  title/name string.
- The apply is per-item: each entry reports created | skipped | error, and one
  bad item never blocks the rest. Idea/run upserts are idempotent (same title
  / same external key update in place), so re-importing the same agent output
  is safe.
"""

from __future__ import annotations

import hashlib
import json
import json
import re
from typing import Any, Literal, Optional, Union

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select, create_engine
from sqlalchemy.orm import Session

from .. import schemas, services
from ..ai.agent_prompts import PROMPTS_VERSION
from ..models import Idea, ExperimentRun

MAX_CONTENT_CHARS = 200_000

JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)

Ref = str
ExistingRef = Union[int, str]


class AgentIdea(BaseModel):
    ref: Optional[str] = None
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=50000)
    status: schemas.IdeaStatus = "exploring"
    change_reason: Optional[str] = Field(default=None, max_length=2000)

    model_config = {"extra": "ignore"}


class AgentIdeaVersion(BaseModel):
    idea: ExistingRef
    body: str = Field(min_length=1, max_length=50000)
    change_reason: Optional[str] = Field(default=None, max_length=2000)

    model_config = {"extra": "ignore"}


class AgentMetric(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    step: int = Field(ge=0)
    value: float

    model_config = {"extra": "ignore"}


class AgentRun(BaseModel):
    ref: Optional[str] = None
    name: str = Field(min_length=1, max_length=300)
    status: schemas.RunStatus = "planned"
    git_commit: Optional[str] = Field(default=None, max_length=64)
    dataset: Optional[str] = Field(default=None, max_length=200)
    eval_protocol: Optional[str] = None
    params: Optional[dict[str, Any]] = None
    notes: Optional[str] = None
    metrics: list[AgentMetric] = []

    model_config = {"extra": "ignore"}


class AgentEvidence(BaseModel):
    idea: ExistingRef
    run: ExistingRef
    verdict: schemas.Verdict
    note: Optional[str] = None

    model_config = {"extra": "ignore"}


class AgentNote(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: Optional[str] = None
    idea: Optional[ExistingRef] = None
    run: Optional[ExistingRef] = None

    model_config = {"extra": "ignore"}


class AgentEnvelope(BaseModel):
    version: int = 1
    ideas: list[AgentIdea] = []
    idea_versions: list[AgentIdeaVersion] = []
    runs: list[AgentRun] = []
    evidence: list[AgentEvidence] = []
    notes: list[AgentNote] = []

    model_config = {"extra": "ignore"}


class ImportItem(BaseModel):
    kind: str
    label: str
    status: Literal["created", "skipped", "error"]
    id: Optional[int] = None
    detail: Optional[str] = None


class AgentImportResult(BaseModel):
    ok: bool
    prompt_version: str = PROMPTS_VERSION
    created: list[ImportItem]
    skipped: list[ImportItem]
    errors: list[ImportItem]


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def parse_envelope(content: str) -> AgentEnvelope:
    if len(content) > MAX_CONTENT_CHARS:
        raise ValueError(f"内容 {len(content)} 字符超过上限 {MAX_CONTENT_CHARS}")
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    match = JSON_BLOCK.search(text)
    if not match:
        raise ValueError("未在内容中找到 JSON 对象——请确认复制的是助手的完整 JSON 输出")
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON 解析失败：{exc}") from exc
    return AgentEnvelope.model_validate(data)


# ---------------------------------------------------------------------------
# Reference resolution
# ---------------------------------------------------------------------------


def _find_idea(db: Session, project_id: int, value: ExistingRef) -> Idea | None:
    if isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
        idea = db.get(Idea, int(value))
        return idea if idea and idea.project_id == project_id else None
    return db.scalar(
        select(Idea).where(Idea.project_id == project_id, Idea.title == str(value))
    )


def _find_run(db: Session, project_id: int, value: ExistingRef) -> ExperimentRun | None:
    if isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
        run = db.get(ExperimentRun, int(value))
        return run if run and run.project_id == project_id else None
    return db.scalar(
        select(ExperimentRun).where(ExperimentRun.project_id == project_id, ExperimentRun.name == str(value))
    )


class _RefRegistry:
    """idea-a -> real Idea id; run-1 -> real Run id (within this import)."""

    def __init__(self) -> None:
        self.ideas: dict[str, int] = {}
        self.runs: dict[str, int] = {}

    def idea(self, value: Any, db: Session, project_id: int) -> tuple[int | None, str | None]:
        if isinstance(value, str) and value in self.ideas:
            return self.ideas[value], None
        idea = _find_idea(db, project_id, value)
        if idea is None:
            return None, f"引用的假设 {value!r} 不存在（既不是本文档中定义的 ref，也不是系统内的 ID/标题）"
        return idea.id, None

    def run(self, value: Any, db: Session, project_id: int) -> tuple[int | None, str | None]:
        if isinstance(value, str) and value in self.runs:
            return self.runs[value], None
        run = _find_run(db, project_id, value)
        if run is None:
            return None, f"引用的实验 {value!r} 不存在（既不是本文档中定义的 ref，也不是系统内的 ID/名称）"
        return run.id, None


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------


def apply_agent_import(
    db: Session, project_id: int, content: str, dry_run: bool = False
) -> AgentImportResult:
    if dry_run:
        # Run the real importer against an isolated snapshot. Service methods
        # commit individually; a rollback on the live session is not a preview.
        from ..database import Base
        from ..models import Project, IdeaVersion, EvidenceLink, ResearchNote, ResearchIdea

        preview_engine = create_engine("sqlite://")
        try:
            Base.metadata.create_all(preview_engine)
            with preview_engine.begin() as connection:
                for model in (Project, ResearchIdea, Idea, IdeaVersion, ExperimentRun, EvidenceLink, ResearchNote):
                    rows = list(db.execute(select(model.__table__)).mappings())
                    if rows:
                        connection.execute(model.__table__.insert(), [dict(row) for row in rows])
            with Session(preview_engine) as preview_db:
                result = apply_agent_import(preview_db, project_id, content)
                for item in result.created:
                    item.id = None
                    item.detail = "预览：" + (item.detail or "将创建")
                return result
        finally:
            preview_engine.dispose()
    services.get_object_or_404(db, __import__("app.models", fromlist=["Project"]).Project, project_id, "Project")

    try:
        envelope = parse_envelope(content)
    except (ValueError, ValidationError) as exc:
        return AgentImportResult(ok=False, created=[], skipped=[], errors=[
            ImportItem(kind="parse", label="解析", status="error", detail=str(exc))
        ])

    created: list[ImportItem] = []
    skipped: list[ImportItem] = []
    errors: list[ImportItem] = []
    registry = _RefRegistry()

    def commit() -> None:
        if not dry_run:
            db.commit()

    # -- ideas ---------------------------------------------------------------
    for index, item in enumerate(envelope.ideas):
        label = item.title
        duplicate = db.scalar(
            select(Idea).where(Idea.project_id == project_id, Idea.title == item.title)
        )
        if duplicate is not None:
            skipped.append(ImportItem(kind="idea", label=label, status="skipped",
                                      id=duplicate.id, detail="同名假设已存在，未重复创建"))
            if item.ref:
                registry.ideas[item.ref] = duplicate.id
            continue
        if dry_run:
            created.append(ImportItem(kind="idea", label=label, status="created", detail="（预演）将创建假设与 v1"))
            continue
        try:
            idea = services.create_idea_with_version(
                db, project_id, schemas.IdeaCreate(
                    title=item.title, body=item.body, change_reason=item.change_reason,
                )
            )
            if item.status != idea.status:
                idea.status = item.status
                db.commit()
            created.append(ImportItem(kind="idea", label=label, status="created", id=idea.id))
            if item.ref:
                registry.ideas[item.ref] = idea.id
        except HTTPException as exc:  # noqa: PERF203
            errors.append(ImportItem(kind="idea", label=label, status="error", detail=str(exc.detail)))

    # -- runs ---------------------------------------------------------------
    for item in envelope.runs:
        label = item.name
        # A ref is local to this document; reusing "run-1" in another import
        # must not overwrite an unrelated experiment.
        existing = db.scalar(select(ExperimentRun).where(
            ExperimentRun.project_id == project_id,
            ExperimentRun.external_source == "agent",
            ExperimentRun.name == item.name,
        ).order_by(ExperimentRun.id))
        external_key = existing.external_key if existing else f"agent:name-{hashlib.sha256(item.name.encode()).hexdigest()[:20]}"
        if dry_run:
            created.append(ImportItem(kind="run", label=label, status="created", detail="（预演）将创建/更新实验"))
            continue
        try:
            run, created_flag = services.upsert_run(
                db, project_id, schemas.RunCreate(
                    name=item.name,
                    status=item.status if "status" in item.model_fields_set or not existing else existing.status,
                    external_source="agent",
                    external_key=external_key,
                    git_commit=item.git_commit if "git_commit" in item.model_fields_set or not existing else existing.git_commit,
                    dataset=item.dataset if "dataset" in item.model_fields_set or not existing else existing.dataset,
                    eval_protocol=item.eval_protocol if "eval_protocol" in item.model_fields_set or not existing else existing.eval_protocol,
                    params=item.params if "params" in item.model_fields_set or not existing else (json.loads(existing.params_json) if existing.params_json else None),
                    notes=item.notes if "notes" in item.model_fields_set or not existing else existing.notes,
                    started_at=existing.started_at if existing else None,
                    finished_at=existing.finished_at if existing else None,
                )
            )
            if item.metrics:
                services.upsert_metrics(db, run.id, [
                    schemas.MetricPointCreate(name=m.name, step=m.step, value=m.value)
                    for m in item.metrics
                ])
            if item.ref:
                registry.runs[item.ref] = run.id
            action = "created" if created_flag else "skipped"
            target = created if created_flag else skipped
            target.append(ImportItem(
                kind="run", label=label, status=action, id=run.id,
                detail=None if created_flag else "同名实验：更新实验信息和提供的指标",
            ))
        except HTTPException as exc:
            errors.append(ImportItem(kind="run", label=label, status="error", detail=str(exc.detail)))

    # -- idea versions -------------------------------------------------------
    for item in envelope.idea_versions:
        idea_id, err = registry.idea(item.idea, db, project_id)
        if err:
            errors.append(ImportItem(kind="idea_version", label=str(item.idea), status="error", detail=err))
            continue
        if dry_run:
            created.append(ImportItem(kind="idea_version", label=str(item.idea), status="created", detail="（预演）将追加版本"))
            continue
        try:
            version = services.add_idea_version(
                db, idea_id, schemas.IdeaVersionCreate(body=item.body, change_reason=item.change_reason)
            )
            created.append(ImportItem(kind="idea_version", label=f"v{version.version_number}", status="created", id=version.id))
        except HTTPException as exc:
            errors.append(ImportItem(kind="idea_version", label=str(item.idea), status="error", detail=str(exc.detail)))

    # -- evidence ------------------------------------------------------------
    for item in envelope.evidence:
        idea_id, idea_err = registry.idea(item.idea, db, project_id)
        run_id, run_err = registry.run(item.run, db, project_id)
        if idea_err or run_err:
            errors.append(ImportItem(kind="evidence", label=f"{item.idea} × {item.run}",
                                     status="error", detail=idea_err or run_err))
            continue
        if dry_run:
            created.append(ImportItem(kind="evidence", label=f"idea#{idea_id} × run#{run_id}", status="created", detail="（预演）将创建/更新证据"))
            continue
        try:
            link, created_flag = services.upsert_evidence_link(
                db, schemas.EvidenceLinkCreate(
                    idea_version_id=_current_version(db, idea_id),
                    run_id=run_id, verdict=item.verdict, note=item.note,
                )
            )
            action = "created" if created_flag else "skipped"
            target = created if created_flag else skipped
            target.append(ImportItem(kind="evidence", label=f"idea#{idea_id} × run#{run_id}",
                                     status=action, id=link.id,
                                     detail=None if created_flag else "已有同对证据，判定已更新"))
        except HTTPException as exc:
            errors.append(ImportItem(kind="evidence", label=f"{item.idea} × {item.run}",
                                     status="error", detail=str(exc.detail)))

    # -- notes ---------------------------------------------------------------
    for item in envelope.notes:
        idea_id, idea_err = (
            registry.idea(item.idea, db, project_id) if item.idea is not None else (None, None)
        )
        run_id, run_err = (
            registry.run(item.run, db, project_id) if item.run is not None else (None, None)
        )
        if idea_err or run_err:
            errors.append(ImportItem(kind="note", label=item.title, status="error", detail=idea_err or run_err))
            continue
        if dry_run:
            created.append(ImportItem(kind="note", label=item.title, status="created", detail="（预演）将创建笔记"))
            continue
        try:
            note = services.create_note(
                db, project_id, schemas.ResearchNoteCreate(
                    title=item.title, content=item.content, idea_id=idea_id, run_id=run_id,
                )
            )
            created.append(ImportItem(kind="note", label=item.title, status="created", id=note.id))
        except HTTPException as exc:
            errors.append(ImportItem(kind="note", label=item.title, status="error", detail=str(exc.detail)))

    commit()
    return AgentImportResult(ok=len(errors) == 0, created=created, skipped=skipped, errors=errors)


class AgentImportError(Exception):
    """Raised for import-specific failures (e.g. idea without a version)."""


def _current_version(db: Session, idea_id: int) -> int:
    idea = db.get(Idea, idea_id)
    if idea is None or idea.current_version_id is None:
        raise AgentImportError(f"假设 {idea_id} 没有可用版本")
    return idea.current_version_id
