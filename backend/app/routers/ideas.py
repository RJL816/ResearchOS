from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import schemas, services
from ..database import get_db
from ..models import Idea, IdeaEdge, IdeaVersion, Project

router = APIRouter(prefix="/api", tags=["ideas"])


@router.get("/projects/{project_id}/ideas", response_model=list[schemas.IdeaRead])
def list_ideas(project_id: int, db: Session = Depends(get_db)):
    services.get_object_or_404(db, Project, project_id, "Project")
    return db.scalars(
        select(Idea).where(Idea.project_id == project_id).order_by(Idea.updated_at.desc())
    ).all()


@router.post("/projects/{project_id}/ideas", response_model=schemas.IdeaRead, status_code=201)
def create_idea(project_id: int, data: schemas.IdeaCreate, db: Session = Depends(get_db)):
    return services.create_idea_with_version(db, project_id, data)


@router.get("/ideas/{idea_id}", response_model=schemas.IdeaRead)
def get_idea(idea_id: int, db: Session = Depends(get_db)):
    return services.get_object_or_404(db, Idea, idea_id, "Idea")


@router.patch("/ideas/{idea_id}", response_model=schemas.IdeaRead)
def update_idea(idea_id: int, data: schemas.IdeaUpdate, db: Session = Depends(get_db)):
    idea = services.get_object_or_404(db, Idea, idea_id, "Idea")
    if data.title is not None and data.title != idea.title:
        duplicate = db.scalar(
            select(Idea).where(
                Idea.project_id == idea.project_id,
                Idea.title == data.title,
                Idea.id != idea.id,
            )
        )
        if duplicate is not None:
            raise HTTPException(
                status_code=409, detail=f"Idea title already exists in this project: {data.title!r}"
            )
        idea.title = data.title
    if data.status is not None:
        idea.status = data.status
    db.commit()
    db.refresh(idea)
    return idea


@router.post("/ideas/{idea_id}/versions", response_model=schemas.IdeaVersionRead, status_code=201)
def create_idea_version(
    idea_id: int, data: schemas.IdeaVersionCreate, db: Session = Depends(get_db)
):
    return services.add_idea_version(db, idea_id, data)


@router.get("/projects/{project_id}/idea-graph", response_model=schemas.ProjectIdeaGraph)
def get_project_idea_graph(project_id: int, db: Session = Depends(get_db)):
    """Whole-project evolution graph: nodes are IdeaVersions (stable DB ids)."""
    nodes, edges = services.get_project_idea_graph(db, project_id)
    return schemas.ProjectIdeaGraph(project_id=project_id, nodes=nodes, edges=edges)


@router.get("/idea-versions/{version_id}/details", response_model=schemas.IdeaVersionDetails)
def get_idea_version_details(version_id: int, db: Session = Depends(get_db)):
    """Everything the graph detail panel needs for one version."""
    return services.get_version_details(db, version_id)


@router.get("/ideas/{idea_id}/graph", response_model=schemas.IdeaGraph)
def get_idea_graph(idea_id: int, db: Session = Depends(get_db)):
    idea = services.get_object_or_404(db, Idea, idea_id, "Idea")
    version_ids = [v.id for v in idea.versions]
    edges = db.scalars(
        select(IdeaEdge).where(
            or_(
                IdeaEdge.src_version_id.in_(version_ids),
                IdeaEdge.dst_version_id.in_(version_ids),
            )
        )
    ).all()
    versions = []
    for version in idea.versions:
        detail = schemas.IdeaVersionDetail.model_validate(version)
        detail.evidence = [
            schemas.EvidenceOnVersion(
                id=link.id,
                verdict=link.verdict,
                note=link.note,
                run_id=link.run_id,
                run_name=link.run.name,
                run_status=link.run.status,
                created_at=link.created_at,
            )
            for link in version.evidence_links
        ]
        versions.append(detail)
    return schemas.IdeaGraph(
        idea=schemas.IdeaRead.model_validate(idea),
        versions=versions,
        edges=[schemas.IdeaEdgeRead.model_validate(e) for e in edges],
    )


@router.post("/idea-edges", response_model=schemas.IdeaEdgeRead, status_code=201)
def create_idea_edge(data: schemas.IdeaEdgeCreate, db: Session = Depends(get_db)):
    return services.create_idea_edge(db, data)


@router.put("/idea-versions/{version_id}")
@router.patch("/idea-versions/{version_id}")
def update_idea_version_rejected(version_id: int):
    # Explicit refusal: hypothesis versions are immutable by design.
    raise HTTPException(
        status_code=405,
        detail="IdeaVersion is immutable: create a new version via "
        "POST /api/ideas/{idea_id}/versions instead",
    )
