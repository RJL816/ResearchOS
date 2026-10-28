from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas, services
from ..database import get_db
from ..models import Project, ResearchNote

router = APIRouter(prefix="/api", tags=["notes"])


@router.get("/projects/{project_id}/notes", response_model=list[schemas.ResearchNoteRead])
def list_notes(project_id: int, db: Session = Depends(get_db)):
    services.get_object_or_404(db, Project, project_id, "Project")
    return db.scalars(
        select(ResearchNote)
        .where(ResearchNote.project_id == project_id)
        .order_by(ResearchNote.created_at.desc())
    ).all()


@router.post("/projects/{project_id}/notes", response_model=schemas.ResearchNoteRead, status_code=201)
def create_note(project_id: int, data: schemas.ResearchNoteCreate, db: Session = Depends(get_db)):
    return services.create_note(db, project_id, data)


@router.patch("/notes/{note_id}", response_model=schemas.ResearchNoteRead)
def update_note(note_id: int, data: schemas.ResearchNoteUpdate, db: Session = Depends(get_db)):
    note = services.get_object_or_404(db, ResearchNote, note_id, "ResearchNote")
    if data.title is not None:
        note.title = data.title
    if data.content is not None:
        note.content = data.content
    if data.is_done is not None:
        note.is_done = data.is_done
    db.commit()
    db.refresh(note)
    return note


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int, db: Session = Depends(get_db)):
    note = services.get_object_or_404(db, ResearchNote, note_id, "ResearchNote")
    db.delete(note)
    db.commit()
    return None
