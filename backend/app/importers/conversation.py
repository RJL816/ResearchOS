"""Conversation import: parse pasted/uploaded AI chats into normalized messages.

Security model:
- Conversation content is UNTRUSTED DATA. It is never executed, and commands in
  it are ignored by this layer (we only store and display it).
- Before any content is sent to the third-party LLM, mask_sensitive() redacts
  credential-looking strings.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import Conversation, ConversationMessage, Project
from ..services import get_object_or_404
from ..utils import utcnow

# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

ROLE_LINE = re.compile(
    r"^\s*(?:\*\*)?(user|assistant|system|你|我|用户|助手|AI|ai|Claude|claude|ChatGPT|GLM|glm)(?:\*\*)?\s*[:：]\s?",
    re.MULTILINE,
)

ROLE_ALIASES = {
    "user": "user",
    "我": "user",
    "用户": "user",
    "你": "assistant",
    "assistant": "assistant",
    "助手": "assistant",
    "ai": "assistant",
    "claude": "assistant",
    "chatgpt": "assistant",
    "glm": "assistant",
    "system": "system",
}


def _normalize_role(raw: str) -> str:
    return ROLE_ALIASES.get(raw.strip().lower(), "assistant" if raw.strip().lower() in ROLE_ALIASES else "assistant")


def parse_plaintext(content: str) -> list[dict]:
    """Heuristic parser for pasted chat text / markdown exports.

    Role markers (`user:`, `**assistant:**`, `我：`, `AI:` ...) start a new
    message; everything else continues the current one. Fenced code blocks are
    preserved verbatim and never split.
    """
    messages: list[dict] = []
    current_role = "user"
    buffer: list[str] = []
    in_fence = False

    def flush() -> None:
        text = "\n".join(buffer).strip("\n")
        if text.strip():
            messages.append({"role": current_role, "content": text})
        buffer.clear()

    for line in content.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            buffer.append(line)
            continue
        if in_fence:
            buffer.append(line)
            continue
        match = ROLE_LINE.match(line)
        if match:
            flush()
            current_role = ROLE_ALIASES.get(match.group(1).lower(), "assistant")
            buffer.append(line[match.end():])
        else:
            buffer.append(line)
    flush()
    return messages


def parse_structured_json(content: str) -> tuple[list[dict], str | None]:
    """Validate and normalize structured JSON imports.

    Accepted shapes: [ {role, content, created_at?}, ... ] or
    {"title": "...", "messages": [...]}. Raises ValueError on invalid input.
    """
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON 解析失败：{exc}") from exc

    if isinstance(data, dict):
        title = data.get("title")
        messages = data.get("messages")
        if messages is None:
            raise ValueError("JSON 对象缺少 messages 字段")
    elif isinstance(data, list):
        title = None
        messages = data
    else:
        raise ValueError("JSON 顶层必须是数组或含 messages 的对象")
    if not isinstance(messages, list) or not messages:
        raise ValueError("messages 必须是非空数组")

    normalized: list[dict] = []
    for index, item in enumerate(messages):
        if not isinstance(item, dict) or "content" not in item:
            raise ValueError(f"messages[{index}] 缺少 content 字段")
        role = ROLE_ALIASES.get(str(item.get("role", "user")).strip().lower(), "assistant")
        created = item.get("created_at") or item.get("timestamp")
        sent_at = None
        if isinstance(created, str) and created.strip():
            try:
                sent_at = datetime.fromisoformat(created.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                sent_at = None  # keep importing; timestamps are optional metadata
        normalized.append({"role": role, "content": str(item["content"]), "sent_at": sent_at})
    return normalized, (str(title) if title else None)


def parse_conversation(content: str, source: str) -> tuple[list[dict], str | None, list[str]]:
    """Returns (messages, json_title, warnings)."""
    warnings: list[str] = []
    if source == "file_json":
        try:
            messages, title = parse_structured_json(content)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return messages, title, warnings

    messages = parse_plaintext(content)
    # A markdown file whose whole body matches structured JSON is still valid —
    # try JSON first when the content clearly looks like JSON.
    if not messages and content.lstrip().startswith(("[", "{")):
        try:
            messages, title = parse_structured_json(content)
            return messages, title, warnings
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    if len(messages) == 1:
        warnings.append("未识别到角色标记（如 user: / assistant:），整段文本按 1 条消息导入")
    return messages, None, warnings


# ---------------------------------------------------------------------------
# Sensitive-data masking (outbound only)
# ---------------------------------------------------------------------------

MASK_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9_-]{8,}"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._-]{8,}"),
    re.compile(r"\b[0-9a-fA-F]{32,64}\b"),
    re.compile(r"\b[A-Za-z0-9]{12,}\.[A-Za-z0-9]{16,}\b"),  # glm-style id.secret keys
]


def mask_sensitive(text: str) -> tuple[str, int]:
    masked = text
    count = 0
    for pattern in MASK_PATTERNS:
        masked, n = pattern.subn("[REDACTED]", masked)
        count += n
    return masked, count


# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------

def build_segments(
    messages: list[tuple[int, str, str]], max_chars: int
) -> list[list[tuple[int, str, str]]]:
    """Split (sequence, role, content) triples into LLM-sized segments.

    Preserves global order and original sequence ids; oversized single messages
    become their own segment (never silently dropped or truncated).
    """
    segments: list[list[tuple[int, str, str]]] = []
    current: list[tuple[int, str, str]] = []
    current_chars = 0
    for message in messages:
        size = len(message[2])
        if current and current_chars + size > max_chars:
            segments.append(current)
            current = []
            current_chars = 0
        current.append(message)
        current_chars += size
    if current:
        segments.append(current)
    return segments


# ---------------------------------------------------------------------------
# Import service
# ---------------------------------------------------------------------------

def content_hash_of(content: str) -> str:
    return hashlib.sha256(content.strip().encode("utf-8")).hexdigest()


def import_conversation(db: Session, project_id: int, data: schemas.ConversationImport) -> tuple[schemas.ConversationDetail, bool, list[str]]:
    get_object_or_404(db, Project, project_id, "Project")

    settings = _settings()
    warnings: list[str] = []
    content = data.content
    if not content.strip():
        raise HTTPException(status_code=422, detail="对话内容为空")
    if len(content) > settings.conversation_max_chars:
        raise HTTPException(
            status_code=422,
            detail=f"对话内容 {len(content)} 字符超过上限 {settings.conversation_max_chars}，请分段导入",
        )

    digest = content_hash_of(content)
    existing = db.scalar(
        select(Conversation).where(
            Conversation.project_id == project_id, Conversation.content_hash == digest
        )
    )
    if existing is not None:
        detail = schemas.ConversationDetail.model_validate(existing)
        detail.messages = [
            schemas.ConversationMessageRead.model_validate(m)
            for m in db.scalars(
                select(ConversationMessage)
                .where(ConversationMessage.conversation_id == existing.id)
                .order_by(ConversationMessage.sequence)
            ).all()
        ]
        return detail, True, ["内容与已有导入完全相同，已返回原会话（幂等去重）"]

    messages, json_title, parse_warnings = parse_conversation(content, data.source)
    warnings.extend(parse_warnings)
    if len(messages) > settings.conversation_max_messages:
        raise HTTPException(
            status_code=422,
            detail=f"解析出 {len(messages)} 条消息，超过上限 {settings.conversation_max_messages}",
        )

    title = (data.title or json_title or _default_title(messages))[:300]
    conversation = Conversation(
        project_id=project_id,
        title=title,
        source=data.source,
        content_hash=digest,
        message_count=len(messages),
        char_count=sum(len(m["content"]) for m in messages),
    )
    db.add(conversation)
    db.flush()
    now = utcnow()
    for index, message in enumerate(messages, start=1):
        db.add(
            ConversationMessage(
                conversation_id=conversation.id,
                sequence=index,
                role=message["role"],
                content=message["content"],
                sent_at=message.get("sent_at"),
            )
        )
    db.commit()
    db.refresh(conversation)
    detail = schemas.ConversationDetail.model_validate(conversation)
    detail.messages = [
        schemas.ConversationMessageRead.model_validate(m)
        for m in db.scalars(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conversation.id)
            .order_by(ConversationMessage.sequence)
        ).all()
    ]
    return detail, False, warnings


def _default_title(messages: list[dict]) -> str:
    first = messages[0]["content"] if messages else "导入对话"
    text = " ".join(first.split())
    return text[:40].rstrip() + ("…" if len(text) > 40 else "")


def _settings():
    from ..config import get_settings

    return get_settings()
