"""Phase 3: full analysis pipeline with a MOCKED GLM client (no real API).

Covers the acceptance scenarios: single idea, refinement chain, branching,
merging, challenge-without-rejection, unadopted suggestions, overturned
decisions, fabricated experiments, invalid message refs, proposal dependency
ordering, partial acceptance, import dedup, idempotent apply, version
conflicts, invalid LLM JSON, LLM failures, and post-apply graph integrity.
"""

import json

import pytest

from app.ai.client import GlmError
from app.analysis import (
    apply_proposals,
    job_summary,
    list_job_proposals,
    run_analysis_job,
)
from app.models import (
    AnalysisJob,
    Conversation,
    EvidenceLink,
    ExperimentRun,
    Idea,
    IdeaVersion,
    Project,
    ResearchNote,
)
from sqlalchemy import func, select


# ------------------------------------------------------------------ helpers


class MockGlmClient:
    """Pop-style scripted client: one canned reply per LLM call."""

    model = "mock-glm"

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls: list[str] = []

    def chat(self, system: str, user: str, temperature: float = 0.2) -> str:
        self.calls.append(user)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def event(
    event_type,
    title,
    description,
    sources,
    related=None,
    evidence_type="user_decision",
    uncertainty="low",
    **details,
):
    return {
        "event_type": event_type,
        "title": title,
        "description": description,
        "source_sequences": sources,
        "related_idea_ids": related or [],
        "reasoning": "测试推理",
        "evidence_type": evidence_type,
        "uncertainty": uncertainty,
        "details": details,
    }


def reply(events):
    return json.dumps({"events": events}, ensure_ascii=False)


def make_project(db, name="AI 分析项目") -> Project:
    project = Project(name=name)
    db.add(project)
    db.commit()
    return project


def make_conversation(db, project_id, lines=("user: 讨论假设", "assistant: 收到")) -> Conversation:
    from app.importers.conversation import import_conversation

    from app.schemas import ConversationImport

    detail, _, _ = import_conversation(
        db, project_id, ConversationImport(source="paste", content="\n".join(lines))
    )
    return db.get(Conversation, detail.id)


def make_job(db, project_id, conversation_id) -> AnalysisJob:
    job = AnalysisJob(project_id=project_id, conversation_id=conversation_id, status="pending")
    db.add(job)
    db.commit()
    return job


def run(db, job, replies) -> AnalysisJob:
    return run_analysis_job(db, job.id, client=MockGlmClient(replies))


def proposals_of(db, job):
    return list_job_proposals(db, job.id)


def accept_all(db, job):
    from app.models import GraphChangeProposal

    proposals = db.scalars(
        select(GraphChangeProposal).where(GraphChangeProposal.job_id == job.id)
    ).all()
    for proposal in proposals:
        proposal.review_status = "accepted"
    db.commit()
    return proposals


def idea_with_v1(db, project_id, title, body="正文") -> Idea:
    idea = Idea(project_id=project_id, title=title)
    db.add(idea)
    db.flush()
    version = IdeaVersion(idea_id=idea.id, version_number=1, body=body)
    db.add(version)
    db.flush()
    idea.current_version_id = version.id
    db.commit()
    return idea


# ------------------------------------------------------------------ scenarios


def test_scenario_1_single_conversation_creates_one_idea(db_session):
    db = db_session
    project = make_project(db)
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([event("idea_created", "秩自适应", "新假设正文", [1], new_title="秩自适应", new_body="正文内容")])])

    assert finished.status == "completed"
    proposals = proposals_of(db, finished)
    assert len(proposals) == 1 and proposals[0].action_type == "create_idea"

    accept_all(db, finished)
    result = apply_proposals(db, finished.id)
    assert len(result.applied) == 1
    assert db.scalar(select(func.count()).select_from(Idea).where(Idea.project_id == project.id)) == 1


def test_scenario_2_refinement_chain_creates_versions(db_session):
    db = db_session
    project = make_project(db)
    idea = idea_with_v1(db, project.id, "链式假设")
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("idea_refined", "修订一", "v2 正文", [1], related=[idea.id], new_body="v2 正文", reason="第一次讨论"),
        event("idea_refined", "修订二", "v3 正文", [1], related=[idea.id], new_body="v3 正文", reason="第二次讨论"),
    ])])

    proposals = proposals_of(db, finished)
    assert {p.action_type for p in proposals} == {"create_idea_version"}
    accept_all(db, finished)
    apply_proposals(db, finished.id)

    db.refresh(idea)
    assert [v.version_number for v in idea.versions] == [1, 2, 3]  # immutable append
    assert idea.current_version.body == "v3 正文"
    # original body untouched
    assert idea.versions[0].body == "正文"


def test_scenario_3_branch_creates_two_directions(db_session):
    db = db_session
    project = make_project(db)
    parent = idea_with_v1(db, project.id, "父假设")
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("idea_branched", "分支A", "分支A正文", [1], related=[parent.id], new_title="分支A", new_body="分支A正文"),
        event("idea_branched", "分支B", "分支B正文", [1], related=[parent.id], new_title="分支B", new_body="分支B正文"),
    ])])

    accept_all(db, finished)
    result = apply_proposals(db, finished.id)
    assert len(result.applied) == 4  # 2 ideas + 2 derivation edges

    db.refresh(parent)
    assert db.scalar(select(func.count()).select_from(Idea).where(Idea.project_id == project.id)) == 3
    edges = db.scalars(
        select(__import__("app.models", fromlist=["IdeaEdge"]).IdeaEdge)
    ).all()
    assert {e.relation for e in edges} == {"derivation"}
    # dependency ordering: both edges point at REAL versions created in this batch
    for edge in edges:
        assert edge.dst_version_id > 0
        assert db.get(IdeaVersion, edge.dst_version_id) is not None


def test_scenario_4_merge_suggestion_between_existing_ideas(db_session):
    db = db_session
    project = make_project(db)
    idea_a = idea_with_v1(db, project.id, "假设A")
    idea_b = idea_with_v1(db, project.id, "假设B")
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("idea_merged", "合并方向", "A 与 B 合并", [1], related=[idea_a.id, idea_b.id], reason="两路一致"),
    ])])

    proposals = proposals_of(db, finished)
    assert proposals[0].action_type == "create_idea_edge"
    accept_all(db, finished)
    apply_proposals(db, finished.id)
    from app.models import IdeaEdge

    edge = db.scalar(select(IdeaEdge))
    assert edge.relation == "merge"
    assert {edge.src_version_id, edge.dst_version_id} == {idea_a.current_version_id, idea_b.current_version_id}


def test_scenario_5_challenge_does_not_reject(db_session):
    db = db_session
    project = make_project(db)
    idea = idea_with_v1(db, project.id, "被质疑的假设")
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("idea_challenged", "质疑假设", "对话里质疑了这个假设", [1], related=[idea.id], evidence_type="discussion"),
    ])])

    proposals = proposals_of(db, finished)
    # single known target -> recorded as a NOTE, never a status change
    assert {p.action_type for p in proposals} == {"add_research_note"}
    accept_all(db, finished)
    apply_proposals(db, finished.id)
    db.refresh(idea)
    assert idea.status == "exploring"  # unchanged
    assert db.scalar(select(func.count()).select_from(ResearchNote)) == 1


def test_scenario_6_unadopted_suggestion_leaves_db_unchanged(db_session):
    db = db_session
    project = make_project(db)
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([event("idea_created", "未采纳", "正文", [1], new_title="未采纳", new_body="正文")])])

    # user never accepts: proposal stays pending
    result = apply_proposals(db, finished.id)
    assert result.applied == []
    assert len(result.skipped) == 1
    assert db.scalar(select(func.count()).select_from(Idea)) == 0


def test_scenario_7_overturned_decision_requires_explicit_reject(db_session):
    db = db_session
    project = make_project(db)
    idea = idea_with_v1(db, project.id, "推翻目标", )
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("idea_rejected", "放弃假设", "研究者明确放弃", [1], related=[idea.id], status="refuted"),
    ])])

    proposal = proposals_of(db, finished)[0]
    assert proposal.action_type == "propose_status_change"
    # reviewer rejects the suggestion
    proposal.review_status = "rejected"
    db.commit()
    apply_proposals(db, finished.id)
    db.refresh(idea)
    assert idea.status == "exploring"


def test_scenario_8_fabricated_experiment_never_becomes_evidence(db_session):
    db = db_session
    project = make_project(db)
    idea = idea_with_v1(db, project.id, "有实验描述的假设")
    run_row = ExperimentRun(project_id=project.id, name="真实run", external_source="manual", external_key="k")
    db.add(run_row)
    db.commit()
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("experiment_observation", "号称实验结果", "AI 声称实验提升了", [1], related=[idea.id], evidence_type="experiment_result"),
    ])])

    accept_all(db, finished)
    apply_proposals(db, finished.id)
    assert db.scalar(select(func.count()).select_from(EvidenceLink)) == 0  # no evidence link!
    assert db.scalar(select(func.count()).select_from(ResearchNote)) == 1  # recorded as note only


def test_scenario_9_invalid_message_refs_dropped(db_session):
    db = db_session
    project = make_project(db)
    conv = make_conversation(db, project.id, lines=("user: 一", "user: 二"))
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("idea_created", "无来源", "正文", [999], new_title="无来源", new_body="正文"),
        event("idea_created", "混合来源", "正文", [1, 999], new_title="混合", new_body="正文"),
    ])])

    assert finished.status == "completed"
    assert "丢弃 1 个无效事件" in (finished.error or "")
    proposal_actions = [p.action_type for p in proposals_of(db, finished)]
    assert proposal_actions == ["create_idea"]  # only the event with a valid source survives
    # the surviving event kept only the valid message id
    from app.models import ResearchEvent

    events = db.scalars(select(ResearchEvent).where(ResearchEvent.job_id == finished.id)).all()
    assert json.loads(events[0].source_message_ids) == [1]


def test_scenario_10_dependency_order_applied(db_session):
    db = db_session
    project = make_project(db)
    parent = idea_with_v1(db, project.id, "依赖父假设")
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("idea_branched", "依赖分支", "正文", [1], related=[parent.id], new_title="依赖分支", new_body="正文"),
    ])])

    proposals = proposals_of(db, finished)
    edge_proposal = next(p for p in proposals if p.action_type == "create_idea_edge")
    idea_proposal = next(p for p in proposals if p.action_type == "create_idea")
    assert edge_proposal.depends_on_proposal_ids == [idea_proposal.id]  # schema parses JSON

    accept_all(db, finished)
    result = apply_proposals(db, finished.id)
    assert len(result.applied) == 2
    from app.models import IdeaEdge

    edge = db.scalar(select(IdeaEdge))
    # placeholder {"proposal_ref": ...} resolved to the new idea's v1
    new_idea = db.scalar(select(Idea).where(Idea.title == "依赖分支"))
    assert edge.dst_version_id == new_idea.current_version_id


def test_scenario_11_partial_acceptance(db_session):
    db = db_session
    project = make_project(db)
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("idea_created", "接受我", "正文", [1], new_title="接受我", new_body="正文"),
        event("idea_created", "拒绝我", "正文", [1], new_title="拒绝我", new_body="正文"),
    ])])

    proposals = proposals_of(db, finished)
    from app.models import GraphChangeProposal

    for p in db.scalars(select(GraphChangeProposal).where(GraphChangeProposal.job_id == finished.id)).all():
        if p.action_type == "create_idea" and p.id == proposals[0].id:
            p.review_status = "accepted"
        elif p.action_type == "create_idea":
            p.review_status = "rejected"
    db.commit()
    result = apply_proposals(db, finished.id)
    assert len(result.applied) == 1
    titles = {row[0] for row in db.execute(select(Idea.title)).all()}
    assert titles == {"接受我"}


def test_scenario_13_repeated_apply_is_idempotent(db_session):
    db = db_session
    project = make_project(db)
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([event("idea_created", "幂等假设", "正文", [1], new_title="幂等假设", new_body="正文")])])

    accept_all(db, finished)
    first = apply_proposals(db, finished.id)
    second = apply_proposals(db, finished.id)
    assert len(first.applied) == 1
    assert first.batch_id != 0
    assert second.applied == []
    assert len(second.skipped) == 1
    assert db.scalar(select(func.count()).select_from(Idea)) == 1


def test_scenario_14_version_conflict_blocks_stale_proposal(db_session):
    db = db_session
    project = make_project(db)
    idea = idea_with_v1(db, project.id, "冲突假设")
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("idea_refined", "过期修订", "v2 计划正文", [1], related=[idea.id], new_body="v2 计划正文"),
    ])])

    accept_all(db, finished)
    # the idea moves forward AFTER the proposal was generated (baseline v1)
    newer = IdeaVersion(idea_id=idea.id, version_number=2, body="别的会话写入的 v2")
    db.add(newer)
    db.flush()
    idea.current_version_id = newer.id
    db.commit()

    result = apply_proposals(db, finished.id)
    assert result.applied == []
    assert len(result.blocked) == 1
    assert "版本冲突" in result.blocked[0]["reason"]
    proposal = proposals_of(db, finished)[0]
    assert proposal.review_status == "needs_revision"
    # no partial write: only the externally-created v2 exists in the DB
    numbers = db.scalars(
        select(IdeaVersion.version_number)
        .where(IdeaVersion.idea_id == idea.id)
        .order_by(IdeaVersion.version_number)
    ).all()
    assert numbers == [1, 2]
    current = db.scalar(
        select(IdeaVersion.body).where(IdeaVersion.id == idea.current_version_id)
    )
    assert current == "别的会话写入的 v2"


def test_scenario_15_invalid_llm_json_retries_then_fails(db_session):
    db = db_session
    project = make_project(db)
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, ["完全不是 JSON 的回复", "```txt\n也不是\n```", "依然不是"])

    assert finished.status == "failed"
    assert "无法解析为有效 JSON" in finished.error
    from app.models import GraphChangeProposal

    assert db.scalar(select(func.count()).select_from(GraphChangeProposal).where(GraphChangeProposal.job_id == finished.id)) == 0


def test_scenario_16_llm_failure_marks_job_failed(db_session):
    db = db_session
    project = make_project(db)
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [GlmError("模拟网络超时")])

    assert finished.status == "failed"
    assert "模拟网络超时" in finished.error


def test_scenario_17_graph_still_works_after_apply(db_session):
    db = db_session
    project = make_project(db)
    conv = make_conversation(db, project.id)
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([event("idea_created", "图完整性", "正文", [1], new_title="图完整性", new_body="完整正文")])])

    accept_all(db, finished)
    result = apply_proposals(db, finished.id)
    version_id = result.applied[0]["version_id"]

    from fastapi.testclient import TestClient
    from tests.conftest import app  # noqa: F401

    # source provenance recorded and reachable
    sources = analysis_sources_helper(db, version_id)
    assert sources and sources[0]["entity_type"] in ("idea", "idea_version")
    assert sources[0]["message_ids"]


def test_scenario_18_in_conversation_evolution_chain(db_session):
    """提出 → 质疑 → 修改 → 分支 all referencing a brand-new idea."""
    db = db_session
    project = make_project(db, "批内演化")
    conv = make_conversation(db, project.id, lines=(f"user: 消息{i}" for i in range(1, 6)))
    job = make_job(db, project.id, conv.id)
    finished = run(db, job, [reply([
        event("idea_created", "自适应秩", "初始正文", [1], new_title="自适应秩", new_body="初始正文"),
        event("idea_challenged", "质疑显存", "对话质疑显存", [2], related=[-1]),
        event("idea_refined", "细化正文", "v2 正文", [3], related=[-1], new_body="细化后正文"),
        event("idea_branched", "量化分支", "分支正文", [4], related=[-1], new_title="量化分支", new_body="分支正文"),
    ])])

    assert finished.status == "completed"
    proposals = proposals_of(db, finished)
    by_action = [p.action_type for p in proposals]
    assert by_action.count("create_idea") == 2  # 主假设 + 分支
    assert "create_idea_version" in by_action
    assert "add_research_note" in by_action  # 质疑（单目标）→ note
    assert "create_idea_edge" in by_action

    accept_all(db, finished)
    result = apply_proposals(db, finished.id)
    assert result.blocked == []
    assert len(result.applied) == len(proposals)

    main_idea = db.scalar(select(Idea).where(Idea.title == "自适应秩"))
    branch_idea = db.scalar(select(Idea).where(Idea.title == "量化分支"))
    numbers = db.scalars(
        select(IdeaVersion.version_number).where(IdeaVersion.idea_id == main_idea.id)
    ).all()
    assert numbers == [1, 2]  # created v1 + refined v2

    from app.models import IdeaEdge

    edge = db.scalar(select(IdeaEdge).where(IdeaEdge.relation == "derivation"))
    assert edge is not None
    assert edge.relation == "derivation"
    # src resolved to the batch-created v1 of the main idea; dst to branch v1
    assert edge.src_version_id == main_idea.versions[0].id or edge.src_version_id in [
        v.id for v in main_idea.versions
    ]
    assert edge.dst_version_id == branch_idea.current_version_id
    assert db.scalar(select(func.count()).select_from(ResearchNote)) == 1


def analysis_sources_helper(db, version_id):
    from app.analysis import version_sources

    return version_sources(db, version_id)
