"""Analysis pipeline orchestration: parse -> extract -> match -> propose -> review -> apply.

The apply step is fully transactional (single commit, rollback on failure),
idempotent for replays, resolves cross-proposal references, and refuses to
apply stale proposals whose target idea has moved forward since review.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import schemas, services
from .ai.extractor import IdeaEvolutionExtractor
from .ai.matcher import match_event
from .ai.proposals import build_proposals_for_event
from .config import get_settings
from .importers.conversation import build_segments, mask_sensitive
from .models import (
    AnalysisJob,
    ApplyBatch,
    Conversation,
    ConversationMessage,
    GraphChangeProposal,
    Idea,
    MessageSourceLink,
    Project,
    ResearchEvent,
)
from .utils import utcnow

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def get_job_or_404(db: Session, job_id: int) -> AnalysisJob:
    job = db.get(AnalysisJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"AnalysisJob {job_id} not found")
    return job


def _load_project_ideas(db: Session, project_id: int) -> list[schemas.IdeaRead]:
    ideas = db.scalars(select(Idea).where(Idea.project_id == project_id)).all()
    return [schemas.IdeaRead.model_validate(idea) for idea in ideas]


def job_summary(db: Session, job: AnalysisJob) -> schemas.AnalysisJobSummary:
    summary = schemas.AnalysisJobSummary.model_validate(job)
    summary.event_count = len(job.events)
    summary.proposal_count = len(job.proposals)
    summary.pending_count = sum(1 for p in job.proposals if p.review_status == "pending")
    summary.needs_revision_count = sum(1 for p in job.proposals if p.review_status == "needs_revision")
    summary.accepted_count = sum(1 for p in job.proposals if p.review_status == "accepted")
    summary.applied_count = sum(1 for p in job.proposals if p.review_status == "applied")
    return summary


_job_summary = job_summary  # internal alias kept for earlier call sites


def _message_triples(db: Session, conversation_id: int) -> list[tuple[int, int, str]]:
    messages = db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.sequence)
    ).all()
    return [(m.id, m.sequence, m.content) for m in messages]


def _payload_of(proposal: GraphChangeProposal) -> dict[str, Any]:
    return json.loads(proposal.payload_json)


# ---------------------------------------------------------------------------
# Pipeline (steps 1-5 of the spec; review is step 6, apply is step 7)
# ---------------------------------------------------------------------------


def run_analysis_job(db: Session, job_id: int, client: Any | None = None) -> schemas.AnalysisJobSummary:
    """Run the full pipeline synchronously. Tests inject a mock client; the
    API background task uses the real GLM client."""
    from .ai.client import get_glm_client as _factory

    job = get_job_or_404(db, job_id)
    if job.status not in ("pending", "failed"):
        raise HTTPException(status_code=409, detail=f"任务当前状态为 {job.status}，不能重复启动")

    settings = get_settings()
    client = client if client is not None else _factory()
    job.status = "parsing"
    job.error = None
    job.started_at = utcnow()
    job.model = getattr(client, "model", "mock")
    job.prompt_version = "n/a"
    db.commit()

    try:
        messages = _message_triples(db, job.conversation_id)
        if not messages:
            raise RuntimeError("会话没有任何消息，无法分析")
        ideas = _load_project_ideas(db, job.project_id)

        # Step 2-3: extraction + consolidation (segmented, order-preserving)
        job.status = "extracting"
        db.commit()
        extractor = IdeaEvolutionExtractor(
            client,
            segment_max_chars=settings.segment_max_chars,
            max_parse_retries=settings.glm_json_parse_retries,
        )
        graph_summary = extractor.build_graph_summary(ideas)
        result = extractor.extract(messages, graph_summary)

        job.segment_count = len(build_segments(messages, settings.segment_max_chars))
        job.prompt_version = result.prompt_version
        ideas_by_id = {idea.id: idea for idea in ideas}

        # Batch-internal linking: an "idea_created" event introduces a NEW idea;
        # later events in the same conversation may refine/challenge/branch it.
        # Those targets are represented as pseudo ideas with negative ids, and
        # translated into {"proposal_ref": ...} placeholders at apply time.
        pseudo_ideas: list[schemas.IdeaRead] = list(ideas)
        pseudo_to_draft: dict[int, int] = {}  # pseudo idea id -> global draft index
        all_drafts: list[Any] = []
        drafts_by_event: list[tuple[ResearchEvent, list[Any]]] = []

        for extracted in result.events:
            match = match_event(extracted, pseudo_ideas)
            matched_version = None
            if match.idea_id is not None:
                target = next(i for i in pseudo_ideas if i.id == match.idea_id)
                matched_version = target.current_version_id
            event = ResearchEvent(
                job_id=job.id,
                sequence=extracted.segment_index,
                event_type=extracted.event_type,
                title=extracted.title[:300],
                description=extracted.description,
                source_message_ids=json.dumps(extracted.source_message_ids),
                related_idea_version_ids=json.dumps(
                    [matched_version] if matched_version and matched_version > 0 else []
                ),
                reasoning=extracted.reasoning,
                evidence_type=extracted.evidence_type,
                uncertainty=extracted.uncertainty,
                proposed_action=extracted.details.get("reason") or extracted.description[:300],
                matched_idea_id=match.idea_id if match.idea_id and match.idea_id > 0 else None,
                match_status=match.status,
                match_score=match.score,
            )
            db.add(event)
            db.flush()

            drafts = build_proposals_for_event(extracted, match, {i.id: i for i in pseudo_ideas})
            _patch_draft_refs(drafts)  # event-local refs: 0 -> previous draft index
            for draft in drafts:
                draft.event_id = event.id
                draft.global_index = len(all_drafts)  # type: ignore[attr-defined]
                all_drafts.append(draft)
            drafts_by_event.append((event, drafts))

            # register newly created idea as a pseudo idea for later events
            if extracted.event_type in ("idea_created", "idea_branched"):
                details = extracted.details or {}
                pseudo_id = -(1000 + len(pseudo_to_draft) + 1)
                new_title = (details.get("new_title") or extracted.title)[:300]
                pseudo_ideas.append(
                    schemas.IdeaRead(
                        id=pseudo_id,
                        project_id=job.project_id,
                        title=new_title,
                        status="exploring",
                        current_version_id=None,  # created together with v1 at apply
                        versions=[],
                        created_at=utcnow(),
                        updated_at=utcnow(),
                    )
                )
                created_draft_index = next(
                    (
                        d.global_index  # type: ignore[attr-defined]
                        for d in reversed(drafts)
                        if d.action_type == "create_idea"
                    ),
                    None,
                )
                if created_draft_index is not None:
                    pseudo_to_draft[pseudo_id] = created_draft_index  # type: ignore[attr-defined]

        # Step 5: persist proposals, then patch dependency/placeholder ids
        job.status = "proposing"
        db.commit()
        for event, drafts in drafts_by_event:
            for draft in drafts:
                proposal = draft.to_model(job.id, job.project_id, draft.event_id, 0)
                db.add(proposal)
                db.flush()
                draft.applied_id = proposal.id  # type: ignore[attr-defined]
        for event, drafts in drafts_by_event:
            for draft in drafts:
                proposal = db.get(GraphChangeProposal, draft.applied_id)  # type: ignore[attr-defined]
                payload = json.loads(proposal.payload_json)
                extra_deps: list[int] = []

                def _ref(draft_index: int) -> int:
                    return all_drafts[draft_index].applied_id  # type: ignore[attr-defined]

                for key, value in list(payload.items()):
                    if isinstance(value, dict) and "event_draft_ref" in value:
                        # event-local reference: resolve within this event's drafts
                        target = drafts[value["event_draft_ref"]]
                        real_id = target.applied_id  # type: ignore[attr-defined]
                        payload[key] = {"proposal_ref": real_id}
                        extra_deps.append(real_id)
                    elif isinstance(value, dict) and "pseudo_version" in value:
                        # current version of a batch-internal (pseudo) idea
                        draft_index = pseudo_to_draft.get(value["pseudo_version"])
                        if draft_index is None:
                            raise RuntimeError(f"批内引用的假设提案缺失（pseudo {value['pseudo_version']}）")
                        payload[key] = {"proposal_ref": _ref(draft_index)}
                        extra_deps.append(_ref(draft_index))
                    elif key in ("idea_id", "src_version_id", "dst_version_id") and isinstance(value, int) and value in pseudo_to_draft:
                        payload[key] = {"proposal_ref": _ref(pseudo_to_draft[value])}
                        extra_deps.append(_ref(pseudo_to_draft[value]))

                deps = [all_drafts[i].applied_id for i in draft.depends_on]  # type: ignore[attr-defined]
                proposal.depends_on_proposal_ids = json.dumps(sorted(set(deps) | set(extra_deps)))
                proposal.payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)

        if result.dropped_events:
            job.error = (
                f"已完成，但丢弃 {len(result.dropped_events)} 个无效事件："
                + "; ".join(f"「{d['title']}」{d['reason']}" for d in result.dropped_events[:5])
            )
        job.status = "completed"
        job.finished_at = utcnow()
        db.commit()
        db.refresh(job)
        return _job_summary(db, job)

    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — pipeline failures must surface
        db.rollback()
        job = db.get(AnalysisJob, job_id)
        job.status = "failed"
        job.error = str(exc)[:2000]
        job.finished_at = utcnow()
        db.commit()
        return _job_summary(db, job)


def _patch_draft_refs(drafts: list[Any]) -> None:
    """Normalize event-local references BEFORE global persistence.

    {"proposal_ref": 0} written by the builder means "the create_idea draft
    emitted just before me within the same event" -> rewritten to
    {"event_draft_ref": relative_index}; depends_on stays relative.
    """
    for index, draft in enumerate(drafts):
        if draft.depends_on:
            draft.depends_on = [i if i != 0 else index - 1 for i in draft.depends_on]
        for key, value in draft.payload.items():
            if isinstance(value, dict) and "proposal_ref" in value:
                value["event_draft_ref"] = index - 1
                del value["proposal_ref"]


# ---------------------------------------------------------------------------
# Review (step 6)
# ---------------------------------------------------------------------------

REVIEWABLE_FIELDS = {"title", "body", "change_reason", "idea_id", "relation", "status", "content", "src_version_id", "dst_version_id"}


def review_proposal(
    db: Session, proposal_id: int, review: schemas.ProposalReview
) -> schemas.GraphChangeProposalRead:
    proposal = services.get_object_or_404(db, GraphChangeProposal, proposal_id, "GraphChangeProposal")
    if proposal.review_status == "applied":
        raise HTTPException(status_code=409, detail="该提案已应用，不能再次修改审核状态")
    payload = _payload_of(proposal)
    edits = review.edits.model_dump(exclude_none=True)
    if "target_idea_id" in edits:
        target_id = edits.pop("target_idea_id")
        target = services.get_object_or_404(db, Idea, target_id, "Idea")
        if target.project_id != proposal.project_id:
            raise HTTPException(status_code=422, detail="目标假设必须属于当前项目")
        payload["idea_id"] = target_id
        proposal.target_entity_id = target_id
        proposal.baseline_version_id = target.current_version_id
    for field in ("src_version_id", "dst_version_id"):
        if field in edits:
            from .models import IdeaVersion
            version = services.get_object_or_404(db, IdeaVersion, edits[field], "IdeaVersion")
            if version.idea.project_id != proposal.project_id:
                raise HTTPException(status_code=422, detail="关系端点必须属于当前项目")
    if "note_content" in edits:
        payload["content"] = edits.pop("note_content")
    for key, value in edits.items():
        if key not in REVIEWABLE_FIELDS:
            continue
        payload[key] = value
    proposal.payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    if review.review_status is not None:
        proposal.review_status = review.review_status
    if review.review_note is not None:
        proposal.review_note = review.review_note
    db.commit()
    db.refresh(proposal)
    return schemas.GraphChangeProposalRead.model_validate(proposal)


# ---------------------------------------------------------------------------
# Apply (step 7) — transactional, ordered, idempotent, conflict-aware
# ---------------------------------------------------------------------------


def apply_proposals(
    db: Session, job_id: int, proposal_ids: list[int] | None = None
) -> schemas.ApplyResult:
    job = get_job_or_404(db, job_id)
    query = select(GraphChangeProposal).where(GraphChangeProposal.job_id == job_id)
    proposals = db.scalars(query.order_by(GraphChangeProposal.id)).all()

    if proposal_ids is not None:
        wanted = set(proposal_ids)
        proposals = [p for p in proposals if p.id in wanted]

    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []

    todo = [p for p in proposals if p.review_status == "accepted"]
    for p in proposals:
        if p.review_status == "applied":
            skipped.append({"proposal_id": p.id, "action_type": p.action_type, "reason": "已应用过（幂等跳过）"})
        elif p.review_status != "accepted":
            skipped.append({"proposal_id": p.id, "action_type": p.action_type, "reason": f"审核状态为 {p.review_status}，未应用"})

    if not todo:
        db.commit()
        return schemas.ApplyResult(batch_id=0, applied=applied, skipped=skipped, blocked=blocked)

    # topological order over depends_on_proposal_ids (within the todo set)
    todo_ids = {p.id for p in todo}
    by_id = {p.id: p for p in todo}
    ordered: list[GraphChangeProposal] = []
    visiting: set[int] = set()
    done: set[int] = set()

    def visit(proposal: GraphChangeProposal) -> None:
        if proposal.id in done or proposal.id in visiting:
            return
        visiting.add(proposal.id)
        for dep_id in json.loads(proposal.depends_on_proposal_ids):
            if dep_id in todo_ids and dep_id not in done:
                visit(by_id[dep_id])
        visiting.discard(proposal.id)
        done.add(proposal.id)
        ordered.append(proposal)

    for p in todo:
        visit(p)

    # A blocked dependency cascades to its dependents; compute after ordering.
    blocked_ids: set[int] = set()
    resolved: dict[int, dict[str, Any]] = {}
    # versions created BY THIS BATCH, for idea ids: allows sequential refinements
    # of the same idea inside one changeset to chain past the baseline check.
    batch_versions: dict[int, set[int]] = {}
    batch: ApplyBatch | None = None

    try:
        for proposal in ordered:
            if proposal.id in blocked_ids:
                _mark_needs_revision(proposal, "所依赖的提案被拦截，需重新审核")
                blocked.append(_blocked_info(proposal, "依赖提案被拦截"))
                continue
            dependency_blocked = any(
                dep in blocked_ids for dep in json.loads(proposal.depends_on_proposal_ids)
            )
            if dependency_blocked:
                _mark_needs_revision(proposal, "依赖的提案被拦截")
                blocked.append(_blocked_info(proposal, "依赖提案被拦截"))
                blocked_ids.add(proposal.id)
                continue

            outcome = _apply_one(db, proposal, resolved, job, batch_versions)
            if outcome["status"] == "ok":
                if batch is None:
                    batch = ApplyBatch(job_id=job_id, proposal_count=0, created_at=utcnow())
                    db.add(batch)
                    db.flush()
                proposal.review_status = "applied"
                proposal.applied_batch_id = batch.id
                proposal.applied_at = utcnow()
                resolved[proposal.id] = outcome["resolved"]
                applied.append({"proposal_id": proposal.id, "action_type": proposal.action_type, **outcome["info"]})
            else:
                _mark_needs_revision(proposal, outcome["reason"])
                blocked.append(_blocked_info(proposal, outcome["reason"]))
                blocked_ids.add(proposal.id)

        if batch is not None:
            batch.proposal_count = len(applied)
        db.commit()
    except Exception as exc:  # noqa: BLE001 — rollback leaves no half-applied changeset
        db.rollback()
        raise HTTPException(status_code=409, detail=f"应用变更集失败，已整体回滚：{exc}") from exc

    conversation = db.get(Conversation, job.conversation_id)
    return schemas.ApplyResult(
        batch_id=batch.id if batch else 0,
        applied=applied,
        skipped=skipped,
        blocked=blocked,
        conversation_title=conversation.title if conversation else None,
    )


def _blocked_info(proposal: GraphChangeProposal, reason: str) -> dict[str, Any]:
    return {"proposal_id": proposal.id, "action_type": proposal.action_type, "reason": reason}


def _mark_needs_revision(proposal: GraphChangeProposal, reason: str) -> None:
    proposal.review_status = "needs_revision"
    proposal.review_note = reason


def _resolve_ref(value: Any, resolved: dict[int, dict[str, Any]], field: str = "version_id") -> tuple[Any, bool]:
    """Resolve {"proposal_ref": id} placeholders. Returns (value, ok).

    field selects what the reference means: create_idea proposals expose both
    idea_id (the Idea row) and version_id (its immutable v1).
    """
    if isinstance(value, dict) and "proposal_ref" in value:
        ref = value["proposal_ref"]
        entry = resolved.get(ref)
        if entry is None:
            return None, False
        return entry.get(field), True
    return value, True


def _apply_one(
    db: Session,
    proposal: GraphChangeProposal,
    resolved: dict[int, dict[str, Any]],
    job: AnalysisJob,
    batch_versions: dict[int, set[int]],
) -> dict[str, Any]:
    payload = _payload_of(proposal)
    action = proposal.action_type

    if action == "create_idea":
        title = payload["title"]
        duplicate = db.scalar(
            select(Idea).where(Idea.project_id == proposal.project_id, Idea.title == title)
        )
        if duplicate is not None:
            return {"status": "blocked", "reason": f"项目中已存在同名假设「{title}」，请修改标题后重新接受"}
        idea = Idea(project_id=proposal.project_id, title=title)
        db.add(idea)
        db.flush()
        version = _create_version_row(db, idea.id, 1, payload.get("body") or "", payload.get("change_reason"))
        idea.current_version_id = version.id
        db.flush()
        _link_source(db, proposal, job, "idea", idea.id, "idea_version", version.id)
        return {
            "status": "ok",
            "info": {"idea_id": idea.id, "version_id": version.id, "title": title},
            "resolved": {
                "entity_type": "idea",
                "entity_id": idea.id,
                "idea_id": idea.id,
                "version_id": version.id,
            },
        }

    if action == "create_idea_version":
        idea_id, idea_ok = _resolve_ref(payload.get("idea_id"), resolved, field="idea_id")
        if not idea_ok:
            return {"status": "blocked", "reason": "依赖的提案尚未成功应用，无法解析目标假设"}
        idea = db.get(Idea, idea_id)
        if idea is None or idea.project_id != proposal.project_id:
            return {"status": "blocked", "reason": f"目标假设 {idea_id} 不存在或不属于本项目"}
        baseline = proposal.baseline_version_id
        advanced_by_batch = idea.current_version_id in batch_versions.get(idea.id, set())
        if baseline is not None and idea.current_version_id != baseline and not advanced_by_batch:
            return {
                "status": "blocked",
                "reason": f"版本冲突：提案基于版本 {baseline} 生成，但该假设当前已是版本 {idea.current_version_id}；请重新审核",
            }
        # compute next number via query — the current_version relationship may
        # be stale within a batch that just advanced this idea.
        from .models import IdeaVersion

        last_number = db.scalar(
            select(IdeaVersion.version_number)
            .where(IdeaVersion.idea_id == idea.id)
            .order_by(IdeaVersion.version_number.desc())
            .limit(1)
        )
        version = _create_version_row(
            db, idea.id, (last_number or 0) + 1, payload.get("body") or "", payload.get("change_reason"),
        )
        batch_versions.setdefault(idea.id, set()).add(version.id)
        if idea.current_version_id is not None:
            db.add(
                __import__("app.models", fromlist=["IdeaEdge"]).IdeaEdge(
                    src_version_id=idea.current_version_id,
                    dst_version_id=version.id,
                    relation="revision",
                    note=payload.get("change_reason"),
                )
            )
        idea.current_version_id = version.id
        db.flush()
        _link_source(db, proposal, job, "idea_version", version.id)
        return {
            "status": "ok",
            "info": {"idea_id": idea.id, "version_id": version.id},
            "resolved": {"entity_type": "version", "entity_id": version.id, "version_id": version.id},
        }

    if action == "create_idea_edge":
        src, src_ok = _resolve_ref(payload.get("src_version_id"), resolved)
        dst, dst_ok = _resolve_ref(payload.get("dst_version_id"), resolved)
        if not src_ok or not dst_ok:
            return {"status": "blocked", "reason": "依赖的提案尚未成功应用，无法解析边端点"}
        if src is None or dst is None:
            return {"status": "blocked", "reason": "边端点缺失，无法创建关系"}
        from .models import IdeaEdge, IdeaVersion

        src_version = db.get(IdeaVersion, src)
        dst_version = db.get(IdeaVersion, dst)
        if src_version is None or dst_version is None:
            return {"status": "blocked", "reason": "边端点版本不存在，请重新审核"}
        if src == dst or src_version.idea.project_id != proposal.project_id or dst_version.idea.project_id != proposal.project_id:
            return {"status": "blocked", "reason": "关系不能连接自身或其他项目的版本"}
        if db.scalar(
            select(IdeaEdge).where(
                IdeaEdge.src_version_id == src,
                IdeaEdge.dst_version_id == dst,
                IdeaEdge.relation == payload["relation"],
            )
        ) is not None:
            return {"status": "blocked", "reason": "相同的演化关系已存在"}
        edge = IdeaEdge(
            src_version_id=src,
            dst_version_id=dst,
            relation=payload["relation"],
            note=payload.get("note"),
        )
        db.add(edge)
        db.flush()
        _link_source(db, proposal, job, "idea_edge", edge.id)
        return {
            "status": "ok",
            "info": {"edge_id": edge.id},
            "resolved": {"entity_type": "edge", "entity_id": edge.id},
        }

    if action in ("add_research_note", "add_open_question", "link_existing_idea"):
        from .models import ResearchNote

        idea_id, idea_ok = _resolve_ref(payload.get("idea_id"), resolved, field="idea_id")
        if not idea_ok:
            return {"status": "blocked", "reason": "依赖的提案尚未成功应用，无法解析关联假设"}
        if idea_id is not None:
            idea = db.get(Idea, idea_id)
            if idea is None or idea.project_id != proposal.project_id:
                return {"status": "blocked", "reason": f"关联假设 {idea_id} 不存在或不属于本项目"}
        note = ResearchNote(
            project_id=proposal.project_id,
            idea_id=idea_id,
            run_id=None,
            title=payload.get("title") or "会话笔记",
            content=payload.get("content") or payload.get("body"),
        )
        db.add(note)
        db.flush()
        _link_source(db, proposal, job, "note", note.id)
        return {
            "status": "ok",
            "info": {"note_id": note.id},
            "resolved": {"entity_type": "note", "entity_id": note.id},
        }

    if action == "propose_status_change":
        status_idea_id, status_idea_ok = _resolve_ref(payload.get("idea_id"), resolved, field="idea_id")
        if not status_idea_ok:
            return {"status": "blocked", "reason": "依赖的提案尚未成功应用，无法解析目标假设"}
        idea = db.get(Idea, status_idea_id)
        if idea is None or idea.project_id != proposal.project_id:
            return {"status": "blocked", "reason": f"目标假设 {status_idea_id} 不存在"}
        idea.status = payload["status"]
        db.flush()
        return {
            "status": "ok",
            "info": {"idea_id": idea.id, "status": idea.status},
            "resolved": {"entity_type": "idea_status", "entity_id": idea.id},
        }

    return {"status": "blocked", "reason": f"未知的提案类型 {action}"}


def _create_version_row(db: Session, idea_id: int, number: int, body: str, reason: str | None):
    from .models import IdeaVersion

    version = IdeaVersion(idea_id=idea_id, version_number=number, body=body, change_reason=reason)
    db.add(version)
    db.flush()
    return version


def _link_source(
    db: Session,
    proposal: GraphChangeProposal,
    job: AnalysisJob,
    entity_type: str,
    entity_id: int,
    extra_type: str | None = None,
    extra_id: int | None = None,
) -> None:
    links = [MessageSourceLink(
        project_id=proposal.project_id,
        conversation_id=job.conversation_id,
        job_id=job.id,
        entity_type=entity_type,
        entity_id=entity_id,
        message_ids=proposal.source_message_ids,
    )]
    if extra_type and extra_id:
        links.append(MessageSourceLink(
            project_id=proposal.project_id,
            conversation_id=job.conversation_id,
            job_id=job.id,
            entity_type=extra_type,
            entity_id=extra_id,
            message_ids=proposal.source_message_ids,
        ))
    for link in links:
        existing = db.scalar(
            select(MessageSourceLink).where(
                MessageSourceLink.entity_type == link.entity_type,
                MessageSourceLink.entity_id == link.entity_id,
                MessageSourceLink.conversation_id == link.conversation_id,
            )
        )
        if existing is None:
            db.add(link)


# ---------------------------------------------------------------------------
# Read helpers for the UI
# ---------------------------------------------------------------------------


def list_job_proposals(db: Session, job_id: int) -> list[schemas.GraphChangeProposalRead]:
    get_job_or_404(db, job_id)
    proposals = db.scalars(
        select(GraphChangeProposal).where(GraphChangeProposal.job_id == job_id).order_by(GraphChangeProposal.id)
    ).all()
    return [schemas.GraphChangeProposalRead.model_validate(p) for p in proposals]


def list_job_events(db: Session, job_id: int) -> list[schemas.ResearchEventRead]:
    get_job_or_404(db, job_id)

    def convert(event: ResearchEvent) -> schemas.ResearchEventRead:
        data = schemas.ResearchEventRead.model_validate(event)
        data.source_message_ids = json.loads(event.source_message_ids)
        data.related_idea_version_ids = json.loads(event.related_idea_version_ids)
        return data

    return [
        convert(event)
        for event in db.scalars(
            select(ResearchEvent).where(ResearchEvent.job_id == job_id).order_by(ResearchEvent.id)
        ).all()
    ]


def project_proposal_summary(db: Session, project_id: int) -> schemas.ProposalSummary:
    services.get_object_or_404(db, Project, project_id, "Project")
    jobs = db.scalars(
        select(AnalysisJob)
        .where(AnalysisJob.project_id == project_id)
        .order_by(AnalysisJob.id.desc())
    ).all()
    pending = 0
    total = 0
    latest: int | None = None
    for job in jobs:
        if job.status != "completed":
            continue
        total += len(job.proposals)
        pending += sum(1 for p in job.proposals if p.review_status == "pending")
        if latest is None:
            latest = job.id
    return schemas.ProposalSummary(pending_count=pending, total_count=total, latest_job_id=latest)


def version_sources(db: Session, version_id: int) -> list[dict[str, Any]]:
    services.get_object_or_404(db, __import__("app.models", fromlist=["IdeaVersion"]).IdeaVersion, version_id, "IdeaVersion")
    idea = db.scalar(
        select(Idea).where(Idea.current_version_id == version_id)
    )
    idea_id = idea.id if idea else None
    from sqlalchemy import or_

    links = db.scalars(
        select(MessageSourceLink).where(
            or_(
                (MessageSourceLink.entity_type == "idea_version") & (MessageSourceLink.entity_id == version_id),
                *(
                    [(MessageSourceLink.entity_type == "idea") & (MessageSourceLink.entity_id == idea_id)]
                    if idea_id
                    else []
                ),
            )
        )
    ).all()
    result = []
    for link in links:
        conversation = db.get(Conversation, link.conversation_id)
        result.append(
            {
                "conversation_id": link.conversation_id,
                "conversation_title": conversation.title if conversation else None,
                "job_id": link.job_id,
                "entity_type": link.entity_type,
                "entity_id": link.entity_id,
                "message_ids": json.loads(link.message_ids),
            }
        )
    return result


def payload_preview(db: Session, conversation_id: int) -> schemas.PayloadPreview:
    conversation = services.get_object_or_404(db, Conversation, conversation_id, "Conversation")
    settings = get_settings()
    triples = _message_triples(db, conversation_id)
    segments = build_segments(triples, settings.segment_max_chars)
    extractor = IdeaEvolutionExtractor(None, segment_max_chars=settings.segment_max_chars)
    rendered: list[str] = []
    masked_total = 0
    for segment in segments:
        text, masked = extractor.render_segment(segment)
        rendered.append(text)
        masked_total += masked
    return schemas.PayloadPreview(
        conversation_id=conversation_id,
        segment_count=len(segments),
        segment_max_chars=settings.segment_max_chars,
        masked_chars=masked_total,
        segments=rendered,
    )
