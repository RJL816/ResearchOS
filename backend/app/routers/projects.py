from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas, services
from ..database import get_db
from ..models import Project

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _with_counts(project: Project) -> schemas.ProjectWithCounts:
    item = schemas.ProjectWithCounts.model_validate(project)
    item.idea_count = len(project.ideas)
    item.run_count = len(project.runs)
    item.note_count = len(project.notes)
    return item


@router.get("", response_model=list[schemas.ProjectWithCounts])
def list_projects(db: Session = Depends(get_db)):
    projects = db.scalars(select(Project).order_by(Project.updated_at.desc())).all()
    return [_with_counts(p) for p in projects]


@router.post("", response_model=schemas.ProjectRead, status_code=201)
def create_project(data: schemas.ProjectCreate, db: Session = Depends(get_db)):
    exists = db.scalar(select(Project).where(Project.name == data.name))
    if exists is not None:
        raise HTTPException(status_code=409, detail=f"Project name already exists: {data.name!r}")
    project = Project(name=data.name, description=data.description, status=data.status)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=schemas.ProjectWithCounts)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = services.get_object_or_404(db, Project, project_id, "Project")
    return _with_counts(project)


@router.patch("/{project_id}", response_model=schemas.ProjectRead)
def update_project(
    project_id: int, data: schemas.ProjectUpdate, db: Session = Depends(get_db)
):
    project = services.get_object_or_404(db, Project, project_id, "Project")
    if data.name is not None and data.name != project.name:
        exists = db.scalar(select(Project).where(Project.name == data.name))
        if exists is not None:
            raise HTTPException(status_code=409, detail=f"Project name already exists: {data.name!r}")
        project.name = data.name
    if data.description is not None:
        project.description = data.description
    if data.status is not None:
        project.status = data.status
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = services.get_object_or_404(db, Project, project_id, "Project")
    db.delete(project)
    db.commit()
    return None
