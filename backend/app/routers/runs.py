import json

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas, services
from ..database import get_db
from ..models import ExperimentRun, MetricPoint, Project

router = APIRouter(prefix="/api", tags=["runs"])


@router.get("/projects/{project_id}/runs", response_model=list[schemas.RunRead])
def list_runs(project_id: int, db: Session = Depends(get_db)):
    services.get_object_or_404(db, Project, project_id, "Project")
    return db.scalars(
        select(ExperimentRun)
        .where(ExperimentRun.project_id == project_id)
        .order_by(ExperimentRun.created_at.desc())
    ).all()


@router.post("/projects/{project_id}/runs", response_model=None)
def create_run(project_id: int, data: schemas.RunCreate, db: Session = Depends(get_db)):
    """Upsert by (external_source, external_key): 201 when created, 200 when updated."""
    run, created = services.upsert_run(db, project_id, data)
    content = jsonable_encoder(schemas.RunRead.model_validate(run))
    return JSONResponse(status_code=201 if created else 200, content=content)


@router.get("/runs/{run_id}", response_model=schemas.RunDetail)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = services.get_object_or_404(db, ExperimentRun, run_id, "ExperimentRun")
    detail = schemas.RunDetail.model_validate(run)

    by_name: dict[str, list[MetricPoint]] = {}
    for point in run.metrics:
        by_name.setdefault(point.name, []).append(point)
    detail.metric_stats = [
        schemas.RunMetricStat(
            name=name,
            count=len(points),
            last_step=points[-1].step,  # relationship is ordered by step
            last_value=points[-1].value,
            min_value=min(p.value for p in points),
            max_value=max(p.value for p in points),
        )
        for name, points in sorted(by_name.items())
    ]
    detail.evidence = [
        schemas.EvidenceOnRun(
            id=link.id,
            verdict=link.verdict,
            note=link.note,
            idea_id=link.idea_version.idea_id,
            idea_title=link.idea_version.idea.title,
            version_number=link.idea_version.version_number,
            created_at=link.created_at,
            updated_at=link.updated_at,
        )
        for link in run.evidence_links
    ]
    return detail


@router.patch("/runs/{run_id}", response_model=schemas.RunRead)
def update_run(run_id: int, data: schemas.RunUpdate, db: Session = Depends(get_db)):
    run = services.get_object_or_404(db, ExperimentRun, run_id, "ExperimentRun")
    if "research_idea_id" in data.model_fields_set:
        services.validate_research_idea(db, run.project_id, data.research_idea_id)
        run.research_idea_id = data.research_idea_id
    if "target_version_id" in data.model_fields_set:
        services.validate_run_target(db, run.project_id, data.target_version_id)
        run.target_version_id = data.target_version_id
    if data.name is not None:
        run.name = data.name
    if data.status is not None:
        run.status = data.status
    if data.git_commit is not None:
        run.git_commit = data.git_commit
    if data.dataset is not None:
        run.dataset = data.dataset
    if data.eval_protocol is not None:
        run.eval_protocol = data.eval_protocol
    if data.params is not None:
        run.params_json = json.dumps(data.params, ensure_ascii=False, sort_keys=True)
    if data.notes is not None:
        run.notes = data.notes
    if data.started_at is not None:
        run.started_at = data.started_at
    if data.finished_at is not None:
        run.finished_at = data.finished_at
    db.commit()
    db.refresh(run)
    return run


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: int, db: Session = Depends(get_db)):
    run = services.get_object_or_404(db, ExperimentRun, run_id, "ExperimentRun")
    db.delete(run)
    db.commit()
    return None


@router.get("/runs/{run_id}/metrics", response_model=schemas.RunMetricsOut)
def get_run_metrics(
    run_id: int,
    name: str | None = None,
    limit: int = Query(default=5000, ge=1, le=50000),
    db: Session = Depends(get_db),
):
    services.get_object_or_404(db, ExperimentRun, run_id, "ExperimentRun")
    query = select(MetricPoint).where(MetricPoint.run_id == run_id)
    if name is not None:
        query = query.where(MetricPoint.name == name)
    points = db.scalars(
        query.order_by(MetricPoint.name, MetricPoint.step).limit(limit)
    ).all()
    by_name: dict[str, list[schemas.MetricPointRead]] = {}
    for point in points:
        by_name.setdefault(point.name, []).append(schemas.MetricPointRead.model_validate(point))
    return schemas.RunMetricsOut(
        run_id=run_id,
        series=[
            schemas.MetricSeries(name=n, points=pts) for n, pts in sorted(by_name.items())
        ],
    )


@router.post("/runs/{run_id}/metrics")
def add_run_metrics(
    run_id: int, data: schemas.MetricBulkCreate, db: Session = Depends(get_db)
):
    inserted, updated = services.upsert_metrics(db, run_id, data.points)
    return {"run_id": run_id, "inserted": inserted, "updated": updated}
