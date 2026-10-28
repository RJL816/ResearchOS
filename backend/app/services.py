"""Domain operations shared by routers, the seed script and the importers.

These functions own the invariants (unique titles, version numbering, evidence
project consistency, idempotent upserts) so that every caller gets the same
behavior. They raise fastapi.HTTPException so the API surfaces explicit errors.
"""

from __future__ import annotations

import json
import uuid
from collections import Counter

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from . import schemas
from .models import (
    EvidenceLink,
    ExperimentRun,
    Idea,
    IdeaEdge,
    IdeaVersion,
    MetricPoint,
    Project,
    ResearchNote,
    ResearchIdea,
)
from .utils import utcnow


def get_object_or_404(db: Session, model, obj_id: int, label: str):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=f"{label} {obj_id} not found")
    return obj


# ---------------------------------------------------------------- ideas
def create_idea_with_version(db: Session, project_id: int, data: schemas.IdeaCreate) -> Idea:
    get_object_or_404(db, Project, project_id, "Project")
    validate_research_idea(db, project_id, data.research_idea_id)
    duplicate = db.scalar(
        select(Idea).where(Idea.project_id == project_id, Idea.title == data.title)
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Idea title already exists in this project: {data.title!r}",
        )
    idea = Idea(project_id=project_id, title=data.title, research_idea_id=data.research_idea_id)
    db.add(idea)
    db.flush()
    version = IdeaVersion(
        idea_id=idea.id, version_number=1, body=data.body, change_reason=data.change_reason
    )
    db.add(version)
    db.flush()
    idea.current_version_id = version.id
    db.commit()
    db.refresh(idea)
    return idea


def add_idea_version(db: Session, idea_id: int, data: schemas.IdeaVersionCreate) -> IdeaVersion:
    idea = get_object_or_404(db, Idea, idea_id, "Idea")
    last_number = db.scalar(
        select(IdeaVersion.version_number)
        .where(IdeaVersion.idea_id == idea_id)
        .order_by(IdeaVersion.version_number.desc())
        .limit(1)
    )
    version = IdeaVersion(
        idea_id=idea_id,
        version_number=(last_number or 0) + 1,
        body=data.body,
        change_reason=data.change_reason,
    )
    db.add(version)
    db.flush()
    previous_id = idea.current_version_id
    if previous_id is not None and previous_id != version.id:
        db.add(
            IdeaEdge(
                src_version_id=previous_id,
                dst_version_id=version.id,
                relation="revision",
                note=data.change_reason,
            )
        )
    idea.current_version_id = version.id
    db.commit()
    db.refresh(version)
    return version


def create_idea_edge(db: Session, data: schemas.IdeaEdgeCreate) -> IdeaEdge:
    src = get_object_or_404(db, IdeaVersion, data.src_version_id, "IdeaVersion")
    dst = get_object_or_404(db, IdeaVersion, data.dst_version_id, "IdeaVersion")
    if src.idea.project_id != dst.idea.project_id:
        raise HTTPException(
            status_code=422,
            detail="Evolution edges must connect versions of ideas in the same project",
        )
    if data.src_version_id == data.dst_version_id:
        raise HTTPException(status_code=422, detail="An edge cannot point from a version to itself")
    existing = db.scalar(
        select(IdeaEdge).where(
            IdeaEdge.src_version_id == data.src_version_id,
            IdeaEdge.dst_version_id == data.dst_version_id,
            IdeaEdge.relation == data.relation,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="This edge (src, dst, relation) already exists",
        )
    edge = IdeaEdge(
        src_version_id=data.src_version_id,
        dst_version_id=data.dst_version_id,
        relation=data.relation,
        note=data.note,
    )
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return edge


# ---------------------------------------------------------------- runs
def upsert_run(db: Session, project_id: int, data: schemas.RunCreate) -> tuple[ExperimentRun, bool]:
    """Create or update a run keyed by (project, external_source, external_key).

    Returns (run, created). Re-submitting the same key updates mutable fields
    and keeps the original id — the idempotency importers rely on.
    """
    get_object_or_404(db, Project, project_id, "Project")
    external_key = data.external_key or f"{data.external_source}-{uuid.uuid4().hex[:12]}"
    validate_run_target(db, project_id, data.target_version_id)
    validate_research_idea(db, project_id, data.research_idea_id)
    run = db.scalar(
        select(ExperimentRun).where(
            ExperimentRun.project_id == project_id,
            ExperimentRun.external_source == data.external_source,
            ExperimentRun.external_key == external_key,
        )
    )
    created = run is None
    if run is None:
        run = ExperimentRun(
            project_id=project_id,
            external_source=data.external_source,
            external_key=external_key,
        )
        db.add(run)
    run.name = data.name
    if created or "research_idea_id" in data.model_fields_set:
        run.research_idea_id = data.research_idea_id
    if created or "target_version_id" in data.model_fields_set:
        run.target_version_id = data.target_version_id
    run.status = data.status
    run.git_commit = data.git_commit
    run.dataset = data.dataset
    run.eval_protocol = data.eval_protocol
    run.params_json = (
        json.dumps(data.params, ensure_ascii=False, sort_keys=True)
        if data.params is not None
        else None
    )
    run.notes = data.notes
    run.started_at = data.started_at
    run.finished_at = data.finished_at
    db.commit()
    db.refresh(run)
    return run, created


def validate_run_target(db: Session, project_id: int, version_id: int | None) -> None:
    if version_id is not None:
        version = get_object_or_404(db, IdeaVersion, version_id, "IdeaVersion")
        if version.idea.project_id != project_id:
            raise HTTPException(status_code=422, detail="实验验证目标必须属于当前项目")


def validate_research_idea(db: Session, project_id: int, research_idea_id: int | None) -> None:
    if research_idea_id is not None:
        idea = get_object_or_404(db, ResearchIdea, research_idea_id, "ResearchIdea")
        if idea.project_id != project_id:
            raise HTTPException(status_code=422, detail="研究 Idea 必须属于当前项目")


def upsert_metrics(
    db: Session, run_id: int, points: list[schemas.MetricPointCreate]
) -> tuple[int, int]:
    """Insert or update (run, name, step) points. Returns (inserted, updated)."""
    get_object_or_404(db, ExperimentRun, run_id, "ExperimentRun")
    existing = {
        (name, step)
        for name, step in db.execute(
            select(MetricPoint.name, MetricPoint.step).where(MetricPoint.run_id == run_id)
        ).all()
    }
    inserted = updated = 0
    for point in points:
        timestamp = point.timestamp or utcnow()
        stmt = (
            sqlite_insert(MetricPoint)
            .values(
                run_id=run_id,
                name=point.name,
                step=point.step,
                value=point.value,
                timestamp=timestamp,
            )
            .on_conflict_do_update(
                index_elements=[MetricPoint.run_id, MetricPoint.name, MetricPoint.step],
                set_={"value": point.value, "timestamp": timestamp},
            )
        )
        db.execute(stmt)
        if (point.name, point.step) in existing:
            updated += 1
        else:
            inserted += 1
            existing.add((point.name, point.step))
    db.commit()
    return inserted, updated


# ---------------------------------------------------------------- evidence
def upsert_evidence_link(
    db: Session, data: schemas.EvidenceLinkCreate
) -> tuple[EvidenceLink, bool]:
    version = get_object_or_404(db, IdeaVersion, data.idea_version_id, "IdeaVersion")
    run = get_object_or_404(db, ExperimentRun, data.run_id, "ExperimentRun")
    version_project_id = db.scalar(select(Idea.project_id).where(Idea.id == version.idea_id))
    if version_project_id != run.project_id:
        raise HTTPException(
            status_code=422,
            detail="Idea version and run belong to different projects; "
            "evidence links must stay within one project",
        )
    link = db.scalar(
        select(EvidenceLink).where(
            EvidenceLink.idea_version_id == data.idea_version_id,
            EvidenceLink.run_id == data.run_id,
        )
    )
    created = link is None
    if link is None:
        link = EvidenceLink(idea_version_id=data.idea_version_id, run_id=data.run_id)
        db.add(link)
    link.verdict = data.verdict
    link.note = data.note
    db.commit()
    db.refresh(link)
    return link, created


# ---------------------------------------------------------------- notes
def create_note(db: Session, project_id: int, data: schemas.ResearchNoteCreate) -> ResearchNote:
    get_object_or_404(db, Project, project_id, "Project")
    if data.idea_id is not None:
        idea = get_object_or_404(db, Idea, data.idea_id, "Idea")
        if idea.project_id != project_id:
            raise HTTPException(status_code=422, detail="idea_id does not belong to this project")
    if data.run_id is not None:
        run = get_object_or_404(db, ExperimentRun, data.run_id, "ExperimentRun")
        if run.project_id != project_id:
            raise HTTPException(status_code=422, detail="run_id does not belong to this project")
    note = ResearchNote(
        project_id=project_id,
        title=data.title,
        content=data.content,
        idea_id=data.idea_id,
        run_id=data.run_id,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


# ---------------------------------------------------------------- idea graph (Phase 2)
SUMMARY_LENGTH = 140


def summarize_body(body: str, limit: int = SUMMARY_LENGTH) -> str:
    """Compact one-line summary for graph nodes; full text lives in details API."""
    text = " ".join(body.split())
    return text[:limit].rstrip() + ("…" if len(text) > limit else "")


def get_project_idea_graph(
    db: Session, project_id: int
) -> tuple[list[schemas.GraphNode], list[schemas.GraphEdgeData]]:
    """Whole-project evolution graph: one node per IdeaVersion, one edge per IdeaEdge."""
    project = get_object_or_404(db, Project, project_id, "Project")
    version_ids: set[int] = set()
    nodes: list[schemas.GraphNode] = []
    for idea in project.ideas:
        for version in idea.versions:
            version_ids.add(version.id)
            links = version.evidence_links
            verdicts = Counter(link.verdict for link in links)
            nodes.append(
                schemas.GraphNode(
                    id=version.id,
                    idea_id=idea.id,
                    title=idea.title,
                    summary=summarize_body(version.body),
                    status=idea.status,
                    version=version.version_number,
                    change_reason=version.change_reason,
                    evidence_count=len(links),
                    run_count=len({link.run_id for link in links}),
                    supports_count=verdicts.get("supports", 0),
                    refutes_count=verdicts.get("refutes", 0),
                    created_at=version.created_at,
                )
            )
    nodes.sort(key=lambda node: (node.idea_id, node.version))
    candidate_edges = db.scalars(
        select(IdeaEdge).where(
            or_(IdeaEdge.src_version_id.in_(version_ids), IdeaEdge.dst_version_id.in_(version_ids))
        )
    ).all()
    edges = [
        schemas.GraphEdgeData(
            id=edge.id,
            source=edge.src_version_id,
            target=edge.dst_version_id,
            relation=edge.relation,
            reason=edge.note,
            created_at=edge.created_at,
        )
        for edge in candidate_edges
        if edge.src_version_id in version_ids and edge.dst_version_id in version_ids
    ]
    edges.sort(key=lambda edge: edge.id)
    return nodes, edges


def summarize_run_metrics(run: ExperimentRun, limit: int = 5) -> list[schemas.RunMetricBrief]:
    """Last value per metric name (relationship is ordered by step), capped for payloads."""
    last_by_name: dict[str, MetricPoint] = {}
    for point in run.metrics:
        last_by_name[point.name] = point
    return [
        schemas.RunMetricBrief(name=name, last_step=point.step, last_value=point.value)
        for name, point in sorted(last_by_name.items())[:limit]
    ]


def get_version_details(db: Session, version_id: int) -> schemas.IdeaVersionDetails:
    version = get_object_or_404(db, IdeaVersion, version_id, "IdeaVersion")
    idea = version.idea

    def brief(v: IdeaVersion) -> schemas.GraphVersionBrief:
        return schemas.GraphVersionBrief(
            id=v.id,
            idea_id=v.idea_id,
            title=v.idea.title,
            version_number=v.version_number,
            status=v.idea.status,
        )

    previous = db.scalar(
        select(IdeaVersion).where(
            IdeaVersion.idea_id == idea.id,
            IdeaVersion.version_number == version.version_number - 1,
        )
    )
    incoming_edges = db.scalars(
        select(IdeaEdge).where(IdeaEdge.dst_version_id == version_id).order_by(IdeaEdge.id)
    ).all()
    outgoing_edges = db.scalars(
        select(IdeaEdge).where(IdeaEdge.src_version_id == version_id).order_by(IdeaEdge.id)
    ).all()
    evidence = [
        schemas.EvidenceDetailItem(
            id=link.id,
            verdict=link.verdict,
            note=link.note,
            created_at=link.created_at,
            run_id=link.run.id,
            run_name=link.run.name,
            run_status=link.run.status,
            run_metrics=summarize_run_metrics(link.run),
        )
        for link in version.evidence_links
    ]
    notes = db.scalars(
        select(ResearchNote)
        .where(ResearchNote.idea_id == idea.id)
        .order_by(ResearchNote.created_at.desc())
    ).all()
    return schemas.IdeaVersionDetails(
        version=schemas.IdeaVersionRead.model_validate(version),
        idea=schemas.IdeaDetailBrief(
            id=idea.id,
            project_id=idea.project_id,
            title=idea.title,
            status=idea.status,
            created_at=idea.created_at,
            updated_at=idea.updated_at,
        ),
        previous_version=(
            schemas.IdeaVersionRead.model_validate(previous) if previous is not None else None
        ),
        incoming=[
            schemas.GraphRelationLink(
                edge_id=edge.id, relation=edge.relation, reason=edge.note, other=brief(edge.src_version)
            )
            for edge in incoming_edges
        ],
        outgoing=[
            schemas.GraphRelationLink(
                edge_id=edge.id, relation=edge.relation, reason=edge.note, other=brief(edge.dst_version)
            )
            for edge in outgoing_edges
        ],
        evidence=evidence,
        notes=[schemas.ResearchNoteRead.model_validate(note) for note in notes],
    )
