"""Agent-assisted structured import API (copy prompt -> agent -> paste JSON)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas, services
from ..ai.agent_prompts import PROMPTS, PROMPTS_VERSION
from ..database import get_db
from ..importers.agent_import import apply_agent_import
from ..models import Project
from typing import Literal

from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["agent-import"])


class AgentPromptInfo(BaseModel):
    key: str
    name: str
    description: str
    prompt: str


class AgentPromptsOut(BaseModel):
    version: str
    prompts: list[AgentPromptInfo]


class AgentImportBody(BaseModel):
    module: Literal["session", "idea", "run", "evidence", "note"] = "session"
    content: str = Field(min_length=1)
    dry_run: bool = False


@router.get("/agent-prompts", response_model=AgentPromptsOut)
def get_agent_prompts():
    """Single source of truth for copy-to-agent prompts."""
    return AgentPromptsOut(
        version=PROMPTS_VERSION,
        prompts=[AgentPromptInfo(key=key, **{k: v for k, v in info.items()}) for key, info in PROMPTS.items()],
    )


@router.post("/projects/{project_id}/agent-import")
def agent_import(project_id: int, body: AgentImportBody, db: Session = Depends(get_db)):
    services.get_object_or_404(db, Project, project_id, "Project")
    result = apply_agent_import(db, project_id, body.content, dry_run=body.dry_run)
    return result.model_dump()
