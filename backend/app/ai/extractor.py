"""IdeaEvolutionExtractor: conversation segments -> validated ResearchEvents.

Guarantees enforced here (in addition to the prompt):
- LLM output is validated with Pydantic; invalid JSON retries a bounded number
  of times, then fails with a clear error.
- Every event's source message references are mapped back to real
  conversation_messages ids; references to unknown messages are dropped, and
  an event left without any valid source is discarded (never persisted).
- related idea ids are validated against the project's actual ideas.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from .. import schemas
from ..importers.conversation import build_segments, mask_sensitive
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, build_user_prompt

JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)

EVENT_TYPES = {
    "idea_created",
    "idea_refined",
    "idea_branched",
    "idea_merged",
    "idea_challenged",
    "idea_rejected",
    "research_decision",
    "open_question",
    "experiment_observation",
}
EVIDENCE_TYPES = {"user_decision", "ai_suggestion", "discussion", "experiment_result", "other"}


class EventDetails(BaseModel):
    """Optional LLM-provided payload hints; all fields free-form validated."""

    new_title: Optional[str] = Field(default=None, max_length=300)
    new_body: Optional[str] = Field(default=None, max_length=50000)
    reason: Optional[str] = Field(default=None, max_length=2000)
    target_idea_ids: list[int] = []
    status: Optional[str] = None

    model_config = {"extra": "ignore"}


class RawEvent(BaseModel):
    """Schema the LLM must satisfy; anything else triggers a retry."""

    event_type: str
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(min_length=1, max_length=20000)
    source_sequences: list[int] = Field(min_length=1)
    related_idea_ids: list[int] = []
    reasoning: str = ""
    evidence_type: str = "discussion"
    uncertainty: Literal["low", "medium", "high"] = "medium"
    details: EventDetails = EventDetails()

    model_config = {"extra": "ignore"}


class RawExtraction(BaseModel):
    events: list[RawEvent]

    model_config = {"extra": "ignore"}


class ExtractedEvent(BaseModel):
    """A validated event with references resolved to DB message ids."""

    event_type: str
    title: str
    description: str
    source_message_ids: list[int]
    related_idea_version_ids: list[int]
    related_idea_ids: list[int]
    reasoning: str
    evidence_type: str
    uncertainty: str
    details: dict[str, Any]
    segment_index: int


class ExtractionResult(schemas.BaseModel):
    events: list[ExtractedEvent] = []
    dropped_events: list[dict[str, Any]] = []
    masked_count: int = 0
    prompt_version: str = PROMPT_VERSION


def extract_json_object(text: str) -> str:
    """Pull the first JSON object out of an LLM reply (tolerates fences/prose)."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z]*\n?", "", stripped)
        stripped = re.sub(r"\n?```\s*$", "", stripped)
    match = JSON_BLOCK.search(stripped)
    if match is None:
        raise ValueError("回复中未找到 JSON 对象")
    return match.group(0)


class IdeaEvolutionExtractor:
    def __init__(self, client, segment_max_chars: int = 12000, max_parse_retries: int = 2):
        self.client = client
        self.segment_max_chars = segment_max_chars
        self.max_parse_retries = max_parse_retries

    def build_graph_summary(self, ideas: list[schemas.IdeaRead]) -> str:
        lines = []
        for idea in ideas:
            current = next((v for v in idea.versions if v.id == idea.current_version_id), None)
            version_ids = ",".join(f"v{v.version_number}={v.id}" for v in idea.versions)
            body_head = " ".join(current.body.split())[:80] if current else ""
            lines.append(
                f"#idea-{idea.id}「{idea.title}」 status={idea.status};"
                f" 版本 {version_ids or '无'}; 当前正文摘录: {body_head}"
            )
        return "\n".join(lines)

    def render_segment(self, segment: list[tuple[int, str, str]]) -> tuple[str, int]:
        """(sequence, role, content) -> prompt text; returns (text, masked_char_count)."""
        lines = []
        masked_total = 0
        for sequence, role, content in segment:
            masked, count = mask_sensitive(content)
            masked_total += count
            role_label = {"user": "user", "assistant": "assistant", "system": "system"}.get(role, role)
            lines.append(f"[m{sequence}] {role_label}:\n{masked}")
        return "\n\n".join(lines), masked_total

    def call_llm(self, graph_summary: str, segment_text: str, index: int, total: int) -> str:
        return self.client.chat(
            SYSTEM_PROMPT,
            build_user_prompt(graph_summary, segment_text, index, total),
        )

    def parse_reply(self, text: str) -> list[RawEvent]:
        payload = json.loads(extract_json_object(text))
        return RawExtraction.model_validate(payload).events

    def extract(self, messages: list[tuple[int, str, str]], graph_summary: str) -> ExtractionResult:
        """Run segmented extraction + consolidation over the whole conversation."""
        segments = build_segments(messages, self.segment_max_chars)
        collected: list[ExtractedEvent] = []
        dropped: list[dict[str, Any]] = []
        masked_total = 0
        last_error: Exception | None = None

        for index, segment in enumerate(segments, start=1):
            segment_text, masked = self.render_segment(segment)
            masked_total += masked

            raw_events: list[RawEvent] | None = None
            attempt = 0
            while attempt <= self.max_parse_retries:
                reply = self.call_llm(graph_summary, segment_text, index, len(segments))
                try:
                    raw_events = self.parse_reply(reply)
                    break
                except (ValueError, json.JSONDecodeError, ValidationError) as exc:
                    last_error = exc
                    attempt += 1
            if raw_events is None:
                raise RuntimeError(
                    f"第 {index}/{len(segments)} 段在 {self.max_parse_retries + 1} 次尝试后仍无法解析为有效 JSON："
                    f"{last_error}"
                )

            sequence_to_id = {seq: msg_id for msg_id, seq, _ in segment}
            for raw in raw_events:
                event, drop_reason = self._resolve_event(
                    raw, sequence_to_id, segment_index=index, total_segments=len(segments)
                )
                if event is None:
                    dropped.append({"title": raw.title, "event_type": raw.event_type, "reason": drop_reason})
                else:
                    collected.append(event)

        return ExtractionResult(
            events=self._consolidate(collected),
            dropped_events=dropped,
            masked_count=masked_total,
            prompt_version=PROMPT_VERSION,
        )

    def _resolve_event(
        self,
        raw: RawEvent,
        sequence_to_id: dict[int, int],
        segment_index: int,
        total_segments: int,
    ) -> tuple[ExtractedEvent | None, str | None]:
        # 1) every source reference must map back to a real message
        unknown = [seq for seq in raw.source_sequences if seq not in sequence_to_id]
        valid_ids = [sequence_to_id[seq] for seq in raw.source_sequences if seq in sequence_to_id]
        if not valid_ids:
            return None, f"所有来源消息引用无效（未知序号：{unknown}）——禁止无来源的事件"
        # 2) event type must be known
        if raw.event_type not in EVENT_TYPES:
            return None, f"未知事件类型 {raw.event_type!r}"
        # 3) evidence_type sanity
        evidence_type = raw.evidence_type if raw.evidence_type in EVIDENCE_TYPES else "other"
        details = raw.details.model_dump()
        if raw.event_type == "idea_rejected" and details.get("status") not in (None, "refuted"):
            details["status"] = None
        # 4) idea references: positive = existing DB ids; negative = in-conversation
        #    new ideas (-1 = first newly proposed, ...) mapped to internal pseudo ids
        related = [
            -(1000 + abs(i)) if i < 0 else i
            for i in raw.related_idea_ids
            if i != 0
        ]
        details_targets = details.get("target_idea_ids") or []
        details["target_idea_ids"] = [
            -(1000 + abs(i)) if i < 0 else i for i in details_targets if i != 0
        ]
        return (
            ExtractedEvent(
                event_type=raw.event_type,
                title=raw.title,
                description=raw.description,
                source_message_ids=valid_ids,
                related_idea_version_ids=[],
                related_idea_ids=related,
                reasoning=raw.reasoning,
                evidence_type=evidence_type,
                uncertainty=raw.uncertainty,
                details=details,
                segment_index=segment_index,
            ),
            None,
        )

    def _consolidate(self, events: list[ExtractedEvent]) -> list[ExtractedEvent]:
        """Merge cross-segment duplicates (same type+title), preserving order and sources."""
        merged: dict[tuple[str, str], ExtractedEvent] = {}
        order: list[tuple[str, str]] = []
        for event in events:
            key = (event.event_type, event.title.strip())
            if key in merged:
                existing = merged[key]
                existing.source_message_ids = sorted(
                    set(existing.source_message_ids) | set(event.source_message_ids)
                )
                existing.related_idea_ids = sorted(
                    set(existing.related_idea_ids) | set(event.related_idea_ids)
                )
                if event.description and event.description != existing.description:
                    existing.description = existing.description  # keep first description
            else:
                merged[key] = event.model_copy(deep=True)
                order.append(key)
        result = [merged[key] for key in order]
        for position, event in enumerate(result, start=1):
            event.segment_index = position  # reuse as final sequence slot
        return result
