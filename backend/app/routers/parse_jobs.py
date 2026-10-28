"""In-memory background parsing jobs that survive frontend page navigation."""
import hashlib
import logging
import threading
import time
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, sessionmaker

from .. import services
from ..database import get_db
from ..ai import progress
from ..models import Project, ResearchIdea
from . import agent, research_evolution, research_ideas

router = APIRouter(prefix="/api/parse-jobs", tags=["parse-jobs"])
logger = logging.getLogger(__name__)
_workers = threading.BoundedSemaphore(3)
_lock = threading.Lock()
_jobs: dict[str, dict] = {}
_TTL = 12 * 60 * 60
_MAX_JOBS = 32


class JobRequest(BaseModel):
    job_id: UUID
    kind: Literal["evolution", "proposal", "agent", "agent_auto"]
    target_id: int = Field(gt=0)
    content: str = Field(min_length=1, max_length=200000)
    filename: str = Field(default="报告.md", min_length=1, max_length=300)
    module: Literal["session", "idea", "run", "evidence", "note"] = "session"


def _run(job_id: str, body: JobRequest, factory: sessionmaker) -> None:
    with _workers:
        _execute(job_id, body, factory)


def _execute(job_id: str, body: JobRequest, factory: sessionmaker) -> None:
    def update(completed: int, total: int, stage: str) -> None:
        with _lock:
            _jobs[job_id].update(completed=completed, total=total, stage=stage)
    with progress.observe(update):
        _execute_observed(job_id, body, factory)


def _execute_observed(job_id: str, body: JobRequest, factory: sessionmaker) -> None:
    with _lock:
        _jobs[job_id]["status"] = "running"
    try:
        with factory() as db:
            if body.kind == "evolution":
                result = research_evolution.parse(body.target_id, research_evolution.ParseBody(filename=body.filename, content=body.content), db)
            elif body.kind == "proposal":
                result = research_ideas.parse_document(body.target_id, research_ideas.SourceBody(filename=body.filename, content=body.content), db)
            else:
                parsed = agent.parse_import(body.target_id, agent.AgentImportBody(module=body.module, content=body.content, dry_run=True), db)
                imported = None
                records = parsed["records"]
                has_records = any(isinstance(v, list) and v for k, v in records.items() if k != "version")
                if body.kind == "agent_auto" and parsed["preview"]["ok"] and has_records:
                    with _lock:
                        _jobs[job_id]["stage"] = "正在导入已解析记录"
                    imported = agent.agent_import(body.target_id, agent.AgentImportBody(module=body.module, content=parsed["normalized"]), db)
                result = {"parsed": parsed, "imported": imported}
        with _lock:
            _jobs[job_id].update(status="completed", result=result, finished=time.time())
    except HTTPException as exc:
        with _lock:
            _jobs[job_id].update(status="failed", error=str(exc.detail), finished=time.time())
    except Exception:
        logger.exception("Background parse job failed")
        with _lock:
            _jobs[job_id].update(status="failed", error="解析过程中出现错误，请重试或检查服务日志。", finished=time.time())


@router.post("", status_code=202)
def start_job(body: JobRequest, db: Session = Depends(get_db)):
    model = ResearchIdea if body.kind == "proposal" else Project
    services.get_object_or_404(db, model, body.target_id, model.__name__)
    job_id = str(body.job_id)
    fingerprint = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    with _lock:
        now = time.time()
        for key in [key for key, value in _jobs.items() if value.get("finished") and now - value["finished"] > _TTL]:
            del _jobs[key]
        if job_id in _jobs:
            if _jobs[job_id]["fingerprint"] != fingerprint:
                raise HTTPException(409, "任务编号已用于其他内容")
            return {"job_id": job_id}
        if len(_jobs) >= _MAX_JOBS:
            completed = sorted(((v["finished"], k) for k, v in _jobs.items() if v.get("finished")))
            if not completed:
                raise HTTPException(429, "解析任务过多，请稍后重试")
            del _jobs[completed[0][1]]
        _jobs[job_id] = {"status": "queued", "kind": body.kind, "target_id": body.target_id, "fingerprint": fingerprint, "completed": 0, "total": None, "stage": "等待解析"}
        try:
            threading.Thread(target=_run, args=(job_id, body, sessionmaker(bind=db.get_bind(), autoflush=False, expire_on_commit=False)), daemon=True, name=f"research-parse-{job_id[:8]}").start()
        except Exception:
            del _jobs[job_id]
            raise
    return {"job_id": job_id}


@router.get("/{job_id}")
def get_job(job_id: UUID):
    with _lock:
        job = _jobs.get(str(job_id))
        if not job:
            raise HTTPException(404, "找不到解析任务，可能是应用已关闭或任务已过期。原文仍在草稿中，请重新解析。")
        return {key: job[key] for key in ("status", "kind", "target_id", "result", "error", "completed", "total", "stage") if key in job}
