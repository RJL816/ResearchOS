"""Agent output import: envelope parsing, ref resolution, idempotency."""

import json

from app.importers.agent_import import apply_agent_import
from app.models import ExperimentRun, Idea, IdeaVersion, ResearchNote
from sqlalchemy import func, select


def make_project(db, name="Agent 导入项目"):
    from app.models import Project

    project = Project(name=name)
    db.add(project)
    db.commit()
    return project


def envelope(ideas=None, versions=None, runs=None, evidence=None, notes=None):
    return json.dumps({
        "version": 1,
        "ideas": ideas or [],
        "idea_versions": versions or [],
        "runs": runs or [],
        "evidence": evidence or [],
        "notes": notes or [],
    }, ensure_ascii=False)


def test_session_import_creates_all_modules(db_session):
    db = db_session
    project = make_project(db)
    content = envelope(
        ideas=[{"ref": "idea-a", "title": "自适应秩", "body": "假设正文", "status": "exploring",
                "change_reason": "讨论提出"}],
        runs=[{"ref": "run-1", "name": "r8-baseline", "status": "succeeded", "git_commit": "a1b2c3d",
               "params": {"rank": 8}, "metrics": [{"name": "eval/acc", "step": 10, "value": 0.72}]}],
        evidence=[{"idea": "idea-a", "run": "run-1", "verdict": "supports", "note": "acc 0.72"}],
        notes=[{"title": "下一步", "content": "补对照", "idea": "idea-a"}],
    )
    result = apply_agent_import(db, project.id, content)
    assert result.ok, [e.detail for e in result.errors]
    assert len(result.created) == 4

    idea = db.scalar(select(Idea).where(Idea.title == "自适应秩"))
    assert idea is not None and idea.current_version.body == "假设正文"
    run = db.scalar(select(ExperimentRun).where(ExperimentRun.name == "r8-baseline"))
    assert run.external_source == "agent"
    assert db.scalar(select(func.count()).select_from(ResearchNote)) == 1


def test_ref_resolution_and_existing_title_reference(db_session):
    db = db_session
    project = make_project(db)
    idea = Idea(project_id=project.id, title="已有假设")
    db.add(idea)
    db.flush()
    version = IdeaVersion(idea_id=idea.id, version_number=1, body="v1")
    db.add(version)
    db.flush()
    idea.current_version_id = version.id
    db.commit()

    content = envelope(versions=[{"idea": "已有假设", "body": "v2 正文", "change_reason": "按标题引用"}])
    result = apply_agent_import(db, project.id, content)
    assert result.ok, [e.detail for e in result.errors]
    db.expire_all()
    numbers = db.scalars(
        select(IdeaVersion.version_number).where(IdeaVersion.idea_id == idea.id)
    ).all()
    assert numbers == [1, 2]


def test_reimport_runs_is_idempotent(db_session):
    db = db_session
    project = make_project(db)
    content = envelope(runs=[{"ref": "run-1", "name": "same-run", "status": "succeeded"}])
    first = apply_agent_import(db, project.id, content)
    second = apply_agent_import(db, project.id, content)
    assert len(first.created) == 1
    run_items = [i for i in second.created + second.skipped if i.kind == "run"]
    assert all(i.status == "skipped" for i in run_items)
    assert db.scalar(select(func.count()).select_from(ExperimentRun)) == 1


def test_invalid_json_reports_clear_error(db_session):
    db = db_session
    project = make_project(db)
    result = apply_agent_import(db, project.id, "这不是 JSON，是一段普通的对话总结。")
    assert result.ok is False
    assert result.errors and "JSON" in (result.errors[0].detail or "")


def test_unknown_ref_is_reported_not_crashed(db_session):
    db = db_session
    project = make_project(db)
    content = envelope(evidence=[{"idea": "idea-ghost", "run": 999, "verdict": "supports"}])
    result = apply_agent_import(db, project.id, content)
    assert result.ok is False
    assert result.errors[0].kind == "evidence"
    assert "不存在" in (result.errors[0].detail or "")


def test_fenced_json_and_prose_tolerated(db_session):
    db = db_session
    project = make_project(db)
    content = "好的，以下是结构化输出：\n```json\n" + envelope(
        ideas=[{"ref": "i", "title": "围栏测试", "body": "正文"}]
    ) + "\n```"
    result = apply_agent_import(db, project.id, content)
    assert result.ok
    assert db.scalar(select(func.count()).select_from(Idea)) == 1


def test_duplicate_idea_title_skipped_with_warning(db_session):
    db = db_session
    project = make_project(db)
    content = envelope(ideas=[{"ref": "a", "title": "重复假设", "body": "正文"}])
    apply_agent_import(db, project.id, content)
    second = apply_agent_import(db, project.id, content)
    assert any(i.status == "skipped" and i.kind == "idea" for i in second.skipped)
    assert db.scalar(select(func.count()).select_from(Idea)) == 1


def test_dry_run_writes_nothing(db_session):
    db = db_session
    project = make_project(db)
    content = envelope(ideas=[{"ref": "a", "title": "预演假设", "body": "正文"}])
    result = apply_agent_import(db, project.id, content, dry_run=True)
    assert len(result.created) == 1
    db.rollback()
    assert db.scalar(select(func.count()).select_from(Idea)) == 0


def test_prompts_endpoint_exposes_all_modules(client):
    resp = client.get("/api/agent-prompts")
    assert resp.status_code == 200
    body = resp.json()
    keys = {p["key"] for p in body["prompts"]}
    assert keys == {"session", "idea", "run", "evidence", "note"}
    assert all(len(p["prompt"]) > 200 for p in body["prompts"])


def test_agent_import_endpoint_dry_run(client):
    client.post("/api/projects", json={"name": "Agent 端点项目"})
    content = envelope(ideas=[{"ref": "i", "title": "端点假设", "body": "正文"}])
    resp = client.post(
        "/api/projects/1/agent-import",
        json={"module": "session", "content": content, "dry_run": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"][0]["label"] == "端点假设"
    assert client.get("/api/projects/1/ideas").json() == []
