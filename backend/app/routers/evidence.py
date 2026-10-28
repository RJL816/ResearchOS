from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import schemas, services
from ..database import get_db
from ..models import EvidenceLink, IdeaVersion

router = APIRouter(prefix="/api", tags=["evidence"])


@router.post("/evidence-links", response_model=None)
def create_evidence_link(data: schemas.EvidenceLinkCreate, db: Session = Depends(get_db)):
    """Upsert by (idea_version, run): 201 when created, 200 when verdict updated."""
    link, created = services.upsert_evidence_link(db, data)
    content = jsonable_encoder(schemas.EvidenceLinkRead.model_validate(link))
    return JSONResponse(status_code=201 if created else 200, content=content)


@router.patch("/evidence-links/{link_id}", response_model=schemas.EvidenceLinkRead)
def update_evidence_link(
    link_id: int, data: schemas.EvidenceLinkUpdate, db: Session = Depends(get_db)
):
    link = services.get_object_or_404(db, EvidenceLink, link_id, "EvidenceLink")
    if data.verdict is not None:
        link.verdict = data.verdict
    if data.note is not None:
        link.note = data.note
    db.commit()
    db.refresh(link)
    return link


@router.delete("/evidence-links/{link_id}", status_code=204)
def delete_evidence_link(link_id: int, db: Session = Depends(get_db)):
    link = services.get_object_or_404(db, EvidenceLink, link_id, "EvidenceLink")
    db.delete(link)
    db.commit()
    return None


@router.get("/idea-versions/{version_id}/evidence", response_model=list[schemas.EvidenceOnVersion])
def list_version_evidence(version_id: int, db: Session = Depends(get_db)):
    version = services.get_object_or_404(db, IdeaVersion, version_id, "IdeaVersion")
    return [
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
