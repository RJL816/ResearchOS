"""Deterministic event -> GraphChangeProposal builder.

The LLM proposes events; THIS module decides which concrete graph actions to
draft. Rules baked in (defense in depth on top of the prompt):
- experiment_observation NEVER creates EvidenceLink (conversation claims are
  unverified); it only drafts a research note.
- idea_challenged NEVER changes status; it drafts a `challenges` edge (or a
  note when no target is confirmed).
- idea_rejected drafts a propose_status_change that only apply, after explicit
  human acceptance, may execute.
- New ideas are created together with their v1; refinements become new
  immutable versions of the existing idea (baseline_version_id recorded for
  conflict detection at apply time).
- Cross-proposal references use {"proposal_ref": id} placeholders resolved
  during the transactional apply.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from ..models import GraphChangeProposal
from .matcher import MatchResult

EDGE_RELATION_FOR_EVENT = {
    "idea_branched": "derivation",
    "idea_merged": "merge",
    "idea_challenged": "challenges",
}


@dataclass
class DraftProposal:
    action_type: str
    payload: dict
    explanation: str
    source_message_ids: list[int] = field(default_factory=list)
    event_id: int | None = None
    depends_on: list[int] = field(default_factory=list)  # draft-local indexes
    baseline_version_id: int | None = None
    target_entity_id: int | None = None

    def to_model(self, job_id: int, project_id: int, event_id: int | None, index: int) -> GraphChangeProposal:
        return GraphChangeProposal(
            job_id=job_id,
            project_id=project_id,
            event_id=event_id,
            action_type=self.action_type,
            target_entity_id=self.target_entity_id,
            payload_json=json.dumps(self.payload, ensure_ascii=False, sort_keys=True),
            source_message_ids=json.dumps(self.source_message_ids),
            explanation=self.explanation,
            review_status="pending",
            depends_on_proposal_ids="[]",  # patched after insert
            baseline_version_id=self.baseline_version_id,
        )


def build_proposals_for_event(event, match: MatchResult, ideas_by_id: dict) -> list[DraftProposal]:
    """Turn one research event into 0..2 draft proposals."""
    details = event.details or {}
    sources = list(event.source_message_ids)
    drafts: list[DraftProposal] = []
    target_idea_id = match.idea_id
    target_idea = ideas_by_id.get(target_idea_id) if target_idea_id else None
    new_title = (details.get("new_title") or event.title)[:300]
    new_body = details.get("new_body") or event.description
    reason = details.get("reason") or event.reasoning or event.description[:200]

    if event.event_type == "idea_created":
        nearest = ""
        if match.status == "needs_review" and match.candidates:
            nearest = f"（注意：与现有假设 #{match.candidates[0][0]} 相似度较高，请确认是新建而非修订）"
        drafts.append(
            DraftProposal(
                action_type="create_idea",
                payload={"title": new_title, "body": new_body, "change_reason": reason},
                explanation=f"对话中提出了新假设。来源消息 {sources}；匹配状态：{match.status}{nearest}",
                source_message_ids=sources,
            )
        )

    elif event.event_type == "idea_refined":
        if target_idea is not None:
            drafts.append(
                DraftProposal(
                    action_type="create_idea_version",
                    payload={
                        "idea_id": target_idea.id,
                        "body": new_body,
                        "change_reason": reason,
                    },
                    explanation=(
                        f"对现有假设「{target_idea.title}」(#{target_idea.id}) 的修订："
                        f"将生成新的不可变版本（基线 v{target_idea.current_version_id}）。"
                        "若应用前该假设已前进到更新版本，本提案会被拦截为需重新审核。"
                    ),
                    source_message_ids=sources,
                    target_entity_id=target_idea.id,
                    baseline_version_id=target_idea.current_version_id,
                )
            )
        else:
            drafts.append(
                _note_fallback(event, match, "事件疑似对现有假设的修订，但未能确认目标假设，请人工指定后接受。")
            )

    elif event.event_type == "idea_branched":
        drafts.append(
            DraftProposal(
                action_type="create_idea",
                payload={"title": new_title, "body": new_body, "change_reason": reason},
                explanation=(
                    f"对话中派生出新分支假设（父假设：{target_idea.title if target_idea else '未确认'}）。"
                    "新假设的 v1 会在应用时创建。"
                ),
                source_message_ids=sources,
            )
        )
        parent_is_pseudo = target_idea is not None and target_idea.id < 0
        if target_idea is not None and (target_idea.current_version_id or parent_is_pseudo):
            # for batch-internal parents the current version is referenced via
            # a pseudo marker resolved during the transactional apply
            src_ref: object = (
                {"pseudo_version": target_idea.id}
                if parent_is_pseudo
                else target_idea.current_version_id
            )
            drafts.append(
                DraftProposal(
                    action_type="create_idea_edge",
                    payload={
                        "src_version_id": src_ref,
                        "dst_version_id": {"proposal_ref": 0},  # patched: previous draft
                        "relation": "derivation",
                        "note": reason,
                    },
                    explanation=(
                        f"在图谱中记录「{target_idea.title}」→ 新分支 的 derivation 关系"
                        "（父版本由同批提案创建，应用时自动解析）。"
                    ),
                    source_message_ids=sources,
                    depends_on=[0],  # patched: previous draft index
                )
            )

    elif event.event_type == "idea_merged":
        explicit = [i for i in event.related_idea_ids if i in ideas_by_id]
        if len(explicit) >= 2:
            first, second = ideas_by_id[explicit[0]], ideas_by_id[explicit[1]]
            if first.current_version_id and second.current_version_id:
                drafts.append(
                    DraftProposal(
                        action_type="create_idea_edge",
                        payload={
                            "src_version_id": first.current_version_id,
                            "dst_version_id": second.current_version_id,
                            "relation": "merge",
                            "note": reason,
                        },
                        explanation=(
                            f"建议在两个已有假设的当前版本（版本 {first.current_version_id} 与 "
                            f"{second.current_version_id}）之间建立 merge 关系。"
                        ),
                        source_message_ids=sources,
                    )
                )
        else:
            drafts.append(
                _note_fallback(event, match, "对话提到合并方向，但涉及的现有假设不足两个或未确认，请人工补充目标后接受。")
            )

    elif event.event_type == "idea_challenged":
        # A challenge is only an edge when BOTH the challenger idea and the
        # challenged idea are known; otherwise it is recorded as a note on the
        # challenged idea (a challenge alone must never flip status).
        challengers = [i for i in event.related_idea_ids if i in ideas_by_id and i != target_idea_id]
        if (
            target_idea is not None
            and target_idea.current_version_id
            and challengers
            and ideas_by_id[challengers[0]].current_version_id
        ):
            challenger = ideas_by_id[challengers[0]]
            drafts.append(
                DraftProposal(
                    action_type="create_idea_edge",
                    payload={
                        "src_version_id": challenger.current_version_id,
                        "dst_version_id": target_idea.current_version_id,
                        "relation": "challenges",
                        "note": reason,
                    },
                    explanation=(
                        f"「{challenger.title}」(v{challenger.current_version_id}) 对 "
                        f"「{target_idea.title}」(v{target_idea.current_version_id}) 的质疑将记录为 "
                        "challenges 关系；不会改变任何假设状态。"
                    ),
                    source_message_ids=sources,
                    target_entity_id=target_idea.id,
                )
            )
        elif target_idea is not None:
            drafts.append(
                DraftProposal(
                    action_type="add_research_note",
                    payload={
                        "title": f"质疑：{event.title}"[:300],
                        "content": (
                            f"{event.description}\n\n（质疑来源：对话消息 {sources}。"
                            "质疑不改变假设状态——只有明确放弃才走 idea_rejected 流程。）"
                        ),
                        "idea_id": target_idea.id,
                    },
                    explanation=f"对「{target_idea.title}」的质疑记录为关联笔记，不影响假设状态。",
                    source_message_ids=sources,
                )
            )
        else:
            drafts.append(
                _note_fallback(event, match, "对话中出现了质疑，但未能确认被质疑的假设；请人工指定目标后接受。")
            )

    elif event.event_type == "idea_rejected":
        if target_idea is not None:
            drafts.append(
                DraftProposal(
                    action_type="propose_status_change",
                    payload={"idea_id": target_idea.id, "status": details.get("status") or "refuted"},
                    explanation=f"对话显示研究者明确放弃了「{target_idea.title}」。接受后才会把状态改为 refuted；质疑本身不会触发此操作。",
                    source_message_ids=sources,
                    target_entity_id=target_idea.id,
                )
            )
        else:
            drafts.append(
                _note_fallback(event, match, "对话疑似放弃假设，但未能确认目标；请人工指定后接受。")
            )

    elif event.event_type == "research_decision":
        drafts.append(
            DraftProposal(
                action_type="add_research_note",
                payload={
                    "title": f"决策：{event.title}"[:300],
                    "content": f"{event.description}\n\n（来源：对话消息 {sources}；依据类型 {event.evidence_type}）",
                    "idea_id": target_idea.id if target_idea else None,
                },
                explanation="研究决策记录为笔记，挂到匹配的假设上（如有）。",
                source_message_ids=sources,
            )
        )

    elif event.event_type == "open_question":
        drafts.append(
            DraftProposal(
                action_type="add_open_question",
                payload={
                    "title": f"Next: {event.title}"[:300],
                    "content": f"{event.description}\n\n（来源：对话消息 {sources}）",
                    "idea_id": target_idea.id if target_idea else None,
                },
                explanation="未解决问题记录为下一步待验证问题（笔记）。",
                source_message_ids=sources,
            )
        )

    elif event.event_type == "experiment_observation":
        drafts.append(
            DraftProposal(
                action_type="add_research_note",
                payload={
                    "title": f"实验观察（未经平台验证）：{event.title}"[:300],
                    "content": f"{event.description}\n\n⚠ 此内容来自对话描述，未经本平台实验记录验证，"
                    f"因此仅作为研究笔记保存，不会创建证据链接（EvidenceLink）。",
                    "idea_id": target_idea.id if target_idea else None,
                },
                explanation="对话中的实验描述不可作为可信实验结果，仅记录笔记，不建立证据关系。",
                source_message_ids=sources,
            )
        )

    return drafts


def _note_fallback(event, match: MatchResult, why: str) -> DraftProposal:
    return DraftProposal(
        action_type="add_research_note",
        payload={
            "title": f"[需人工确认] {event.title}"[:300],
            "content": f"{event.description}\n\n{why}\n（来源：对话消息 {list(event.source_message_ids)}；"
            f"匹配状态 {match.status}，候选：{match.candidates}）",
            "idea_id": None,
        },
        explanation=why,
        source_message_ids=list(event.source_message_ids),
    )
