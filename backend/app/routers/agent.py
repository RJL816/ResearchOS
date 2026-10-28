"""Agent-assisted structured import API (copy prompt -> agent -> paste JSON)."""

import json
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas, services
from ..ai.agent_prompts import PROMPTS, PROMPTS_VERSION
from ..ai.agent_parser import parse_agent_text
from ..ai.client import GlmError, GlmNotConfigured, configure_runtime_model, get_glm_client, runtime_model_status
from ..config import get_settings
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


class ModelConfigBody(BaseModel):
    api_key: str = Field(default="", max_length=4096)
    base_url: str = Field(min_length=1, max_length=2048)
    model: str = Field(min_length=1, max_length=200)


@router.get("/model-settings")
def model_settings():
    try:
        return runtime_model_status()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.put("/model-settings")
def set_model_settings(body: ModelConfigBody):
    url = urlparse(body.base_url.strip())
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise HTTPException(422, "请输入有效的模型 API 基础地址")
    if not body.model.strip():
        raise HTTPException(422, "请填写模型名称")
    try:
        configure_runtime_model(body.api_key.strip(), body.base_url.strip().rstrip("/"), body.model.strip())
    except (RuntimeError, OSError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return runtime_model_status()


@router.post("/projects/{project_id}/agent-import/parse")
def parse_import(project_id: int, body: AgentImportBody, db: Session = Depends(get_db)):
    services.get_object_or_404(db, Project, project_id, "Project")
    try:
        settings = get_settings()
        records, segments, masked_count = parse_agent_text(body.content, body.module, get_glm_client(), settings.segment_max_chars, settings.glm_json_parse_retries)
        normalized = json.dumps(records, ensure_ascii=False)
        preview = apply_agent_import(db, project_id, normalized, dry_run=True)
        return {"records": records, "normalized": normalized, "segments": segments, "masked_count": masked_count, "preview": preview.model_dump()}
    except GlmNotConfigured as exc:
        raise HTTPException(503, "请先在设置中配置模型 API，再解析内容。") from exc
    except (GlmError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


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
