"""Conversation import + AI analysis review API (Phase 3)."""

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import analysis, schemas, services
from ..ai.client import GlmNotConfigured, get_glm_client
from ..database import get_db
from ..config import get_settings
from ..models import AnalysisJob, Conversation, ConversationMessage, Project

router = APIRouter(prefix="/api", tags=["conversations"])

ALLOWED_SUFFIXES = {".md": "file_md", ".markdown": "file_md", ".txt": "file_txt", ".json": "file_json"}


def _conversation_detail(db: Session, conversation: Conversation) -> schemas.ConversationDetail:
    detail = schemas.ConversationDetail.model_validate(conversation)
    detail.messages = [
        schemas.ConversationMessageRead.model_validate(m)
        for m in db.scalars(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conversation.id)
            .order_by(ConversationMessage.sequence)
        ).all()
    ]
    return detail


def _import(db: Session, project_id: int, data: schemas.ConversationImport):
    from ..importers.conversation import import_conversation

    return import_conversation(db, project_id, data)


@router.post("/projects/{project_id}/conversations", response_model=None)
def import_conversation(
    project_id: int, data: schemas.ConversationImport, db: Session = Depends(get_db)
):
    """Import a conversation (paste/markdown/text/json). Idempotent on content hash:
    201 new, 200 when identical content already exists."""
    detail, deduplicated, warnings = _import(db, project_id, data)
    body = jsonable_encoder(
        schemas.ConversationImportResult(conversation=detail, deduplicated=deduplicated, warnings=warnings)
    )
    return JSONResponse(status_code=200 if deduplicated else 201, content=body)


@router.post("/projects/{project_id}/conversations/upload", response_model=None)
async def upload_conversation(
    project_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    suffix = "." + (file.filename or "").lower().rsplit(".", 1)[-1]
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=422, detail=f"不支持的文件类型 {suffix}，仅支持 .md/.markdown/.txt/.json"
        )
    raw = await file.read()
    limit = get_settings().conversation_max_file_bytes
    if len(raw) > limit:
        raise HTTPException(status_code=422, detail=f"文件 {len(raw)} 字节超过上限 {limit}")
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="文件必须是 UTF-8 编码文本") from exc
    data = schemas.ConversationImport(
        title=(file.filename or "导入对话")[:300],
        source=ALLOWED_SUFFIXES[suffix],
        content=content,
    )
    detail, deduplicated, warnings = _import(db, project_id, data)
    body = jsonable_encoder(
        schemas.ConversationImportResult(conversation=detail, deduplicated=deduplicated, warnings=warnings)
    )
    return JSONResponse(status_code=200 if deduplicated else 201, content=body)


@router.get("/projects/{project_id}/conversations", response_model=list[schemas.ConversationRead])
def list_conversations(project_id: int, db: Session = Depends(get_db)):
    services.get_object_or_404(db, Project, project_id, "Project")
    return db.scalars(
        select(Conversation)
        .where(Conversation.project_id == project_id)
        .order_by(Conversation.created_at.desc())
    ).all()


@router.get("/conversations/{conversation_id}", response_model=schemas.ConversationDetail)
def get_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conversation = services.get_object_or_404(db, Conversation, conversation_id, "Conversation")
    return _conversation_detail(db, conversation)


@router.get("/conversations/{conversation_id}/payload-preview", response_model=schemas.PayloadPreview)
def payload_preview(conversation_id: int, db: Session = Depends(get_db)):
    """Exactly what would be sent to the third-party model, with secrets masked."""
    return analysis.payload_preview(db, conversation_id)


# ------------------------------------------------------------------ analysis


@router.post(
    "/conversations/{conversation_id}/analyze",
    response_model=schemas.AnalysisJobRead,
    status_code=202,
)
def start_analysis(
    conversation_id: int, background: BackgroundTasks, db: Session = Depends(get_db)
):
    conversation = services.get_object_or_404(db, Conversation, conversation_id, "Conversation")
    try:
        get_glm_client()  # fail fast with a clear message when unconfigured
    except GlmNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    job = AnalysisJob(project_id=conversation.project_id, conversation_id=conversation.id, status="pending")
    db.add(job)
    db.commit()
    db.refresh(job)
    background.add_task(_run_job_blocking, job.id)
    return job


def _run_job_blocking(job_id: int) -> None:
    from ..database import SessionLocal

    db = SessionLocal()
    try:
        analysis.run_analysis_job(db, job_id)
    finally:
        db.close()


@router.get("/analysis-jobs/{job_id}", response_model=schemas.AnalysisJobSummary)
def get_job(job_id: int, db: Session = Depends(get_db)):
    return analysis.job_summary(db, analysis.get_job_or_404(db, job_id))


@router.get("/analysis-jobs/{job_id}/events", response_model=list[schemas.ResearchEventRead])
def get_job_events(job_id: int, db: Session = Depends(get_db)):
    return analysis.list_job_events(db, job_id)


@router.get("/analysis-jobs/{job_id}/proposals", response_model=list[schemas.GraphChangeProposalRead])
def get_job_proposals(job_id: int, db: Session = Depends(get_db)):
    return analysis.list_job_proposals(db, job_id)


@router.patch("/proposals/{proposal_id}", response_model=schemas.GraphChangeProposalRead)
def review_proposal(proposal_id: int, review: schemas.ProposalReview, db: Session = Depends(get_db)):
    return analysis.review_proposal(db, proposal_id, review)


class ApplyRequest(BaseModel := __import__("pydantic").BaseModel):
    """Omit proposal_ids to apply every accepted proposal of the job."""

    proposal_ids: list[int] | None = None


@router.post("/analysis-jobs/{job_id}/apply", response_model=schemas.ApplyResult)
def apply_job_proposals(job_id: int, body: ApplyRequest | None = None, db: Session = Depends(get_db)):
    ids = body.proposal_ids if body else None
    return analysis.apply_proposals(db, job_id, ids)


@router.get("/projects/{project_id}/proposals-summary", response_model=schemas.ProposalSummary)
def proposals_summary(project_id: int, db: Session = Depends(get_db)):
    return analysis.project_proposal_summary(db, project_id)


@router.get("/idea-versions/{version_id}/sources")
def version_sources(version_id: int, db: Session = Depends(get_db)):
    return analysis.version_sources(db, version_id)
