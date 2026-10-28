"""Regression coverage for research tasks crossing multiple screens."""
import json
from sqlalchemy import func, select
from app.models import AnalysisJob, Conversation, GraphChangeProposal, Idea, Project, ResearchNote
from app.importers.agent_import import apply_agent_import


def test_preview_resolves_new_entities_without_writing(db_session):
    db = db_session
    project = Project(name="preview")
    db.add(project)
    db.commit()
    content = json.dumps({
        "ideas": [{"ref": "idea-a", "title": "Hypothesis", "body": "initial"}],
        "runs": [{"ref": "run-a", "name": "Control", "metrics": [{"name": "accuracy", "step": 0, "value": .8}]}],
        "idea_versions": [{"idea": "idea-a", "body": "revised"}],
        "evidence": [{"idea": "idea-a", "run": "run-a", "verdict": "supports"}],
        "notes": [{"title": "Next: check", "idea": "idea-a", "run": "run-a"}],
    })
    preview = apply_agent_import(db, project.id, content, dry_run=True)
    assert preview.ok, preview.errors
    assert len(preview.created) == 5
    assert db.scalar(select(func.count()).select_from(Idea)) == 0
    assert db.scalar(select(func.count()).select_from(ResearchNote)) == 0
    actual = apply_agent_import(db, project.id, content)
    assert actual.ok
    assert [(x.kind, x.status) for x in preview.created] == [(x.kind, x.status) for x in actual.created]


def test_experiment_plan_result_and_evidence(client):
    project = client.post("/api/projects", json={"name": "workflow"}).json()
    idea = client.post(f"/api/projects/{project['id']}/ideas", json={"title": "Hypothesis", "body": "Initial claim"}).json()
    run = client.post(f"/api/projects/{project['id']}/runs", json={"name": "Control", "status": "planned", "target_version_id": idea["current_version_id"]}).json()
    assert run["target_version_id"] == idea["current_version_id"]
    assert client.get(f"/api/runs/{run['id']}").json()["evidence"] == []
    assert client.patch(f"/api/runs/{run['id']}", json={"status": "succeeded", "notes": "outperformed baseline"}).status_code == 200
    assert client.post(f"/api/runs/{run['id']}/metrics", json={"points": [{"name": "accuracy", "step": 100, "value": .9}]}).status_code == 200
    assert client.post("/api/evidence-links", json={"run_id": run["id"], "idea_version_id": idea["current_version_id"], "verdict": "supports"}).status_code == 201
    assert client.get(f"/api/ideas/{idea['id']}").json()["status"] == "exploring"
    assert client.patch(f"/api/ideas/{idea['id']}", json={"status": "validated"}).status_code == 200
    version = client.post(f"/api/ideas/{idea['id']}/versions", json={"body": "Revised claim", "change_reason": "experimental result"}).json()
    assert version["version_number"] == 2
    assert client.get(f"/api/runs/{run['id']}").json()["target_version_id"] == idea["current_version_id"]
    assert client.get(f"/api/ideas/{idea['id']}/graph").json()["versions"][0]["body"] == "Initial claim"


def test_experiment_target_cannot_cross_project(client):
    a = client.post("/api/projects", json={"name": "A"}).json()["id"]
    b = client.post("/api/projects", json={"name": "B"}).json()["id"]
    idea = client.post(f"/api/projects/{a}/ideas", json={"title": "H", "body": "body"}).json()
    assert client.post(f"/api/projects/{b}/runs", json={"name": "bad", "target_version_id": idea["current_version_id"]}).status_code == 422
    run = client.post(f"/api/projects/{b}/runs", json={"name": "ok"}).json()
    assert client.patch(f"/api/runs/{run['id']}", json={"target_version_id": idea["current_version_id"]}).status_code == 422


def test_open_question_completion_survives_reload(client):
    project = client.post("/api/projects", json={"name": "questions"}).json()["id"]
    note = client.post(f"/api/projects/{project}/notes", json={"title": "Next: validate mechanism", "content": "design a control"}).json()
    assert note["is_done"] is False
    assert client.patch(f"/api/notes/{note['id']}", json={"is_done": True}).json()["is_done"] is True
    assert client.get(f"/api/projects/{project}/notes").json()[0]["is_done"] is True
    assert client.patch(f"/api/notes/{note['id']}", json={"is_done": False}).json()["is_done"] is False


def test_analysis_history_keeps_multiple_jobs_and_project_scope(client, db_session):
    db = db_session
    project = Project(name="history")
    other = Project(name="other")
    db.add_all([project, other]); db.flush()
    conv = Conversation(project_id=project.id, title="discussion", source="paste", content_hash="hash")
    db.add(conv); db.flush()
    jobs = [AnalysisJob(project_id=project.id, conversation_id=conv.id, status=status) for status in ("failed", "completed")]
    db.add_all(jobs); db.flush()
    db.add(GraphChangeProposal(job_id=jobs[1].id, project_id=project.id, action_type="create_idea", payload_json='{"title":"H","body":"body"}', review_status="accepted"))
    db.commit()
    history = client.get(f"/api/projects/{project.id}/analysis-jobs").json()
    assert [job["id"] for job in history] == [jobs[1].id, jobs[0].id]
    assert history[0]["accepted_count"] == 1
    assert client.get(f"/api/projects/{other.id}/analysis-jobs").json() == []


def test_review_can_retarget_and_reject_cross_project_edges(client, db_session):
    a = client.post("/api/projects", json={"name": "A"}).json()["id"]
    b = client.post("/api/projects", json={"name": "B"}).json()["id"]
    local = client.post(f"/api/projects/{a}/ideas", json={"title": "local", "body": "body"}).json()
    foreign = client.post(f"/api/projects/{b}/ideas", json={"title": "foreign", "body": "body"}).json()
    db = db_session
    conv = Conversation(project_id=a, title="discussion", source="paste", content_hash="hash")
    db.add(conv); db.flush()
    job = AnalysisJob(project_id=a, conversation_id=conv.id, status="completed")
    db.add(job); db.flush()
    proposal = GraphChangeProposal(job_id=job.id, project_id=a, action_type="create_idea_version", payload_json='{"body":"new body"}')
    db.add(proposal); db.commit()
    assert client.patch(f"/api/proposals/{proposal.id}", json={"edits": {"target_idea_id": foreign["id"]}}).status_code == 422
    updated = client.patch(f"/api/proposals/{proposal.id}", json={"edits": {"target_idea_id": local["id"]}, "review_status": "accepted"}).json()
    assert updated["baseline_version_id"] == local["current_version_id"]
    assert updated["payload"]["idea_id"] == local["id"]
    assert client.patch(f"/api/proposals/{proposal.id}", json={"edits": {"src_version_id": foreign["current_version_id"]}}).status_code == 422


def test_import_refresh_preserves_manually_assigned_experiment_target(client):
    project = client.post("/api/projects", json={"name": "import refresh"}).json()["id"]
    idea = client.post(f"/api/projects/{project}/ideas", json={"title": "H", "body": "claim"}).json()
    payload = {"name": "control", "external_source": "manual", "external_key": "stable-key"}
    run = client.post(f"/api/projects/{project}/runs", json={**payload, "target_version_id": idea["current_version_id"]}).json()
    refreshed = client.post(f"/api/projects/{project}/runs", json={**payload, "status": "succeeded"}).json()
    assert refreshed["id"] == run["id"]
    assert refreshed["target_version_id"] == idea["current_version_id"]
    cleared = client.post(f"/api/projects/{project}/runs", json={**payload, "target_version_id": None}).json()
    assert cleared["target_version_id"] is None


def test_programmatic_migrations_use_the_requested_database(tmp_path):
    import sqlite3
    from desktop_entry import run_migrations
    target = tmp_path / "isolated.db"
    run_migrations("sqlite:///" + str(target))
    run_migrations("sqlite:///" + str(target))
    with sqlite3.connect(target) as db:
        assert db.execute("select version_num from alembic_version").fetchone()[0] == "d53fa72823bc"
        assert "target_version_id" in {row[1] for row in db.execute("pragma table_info(experiment_runs)")}
        assert "is_done" in {row[1] for row in db.execute("pragma table_info(research_notes)")}
        assert db.execute("pragma foreign_key_check").fetchall() == []


def test_agent_refs_are_local_and_updates_preserve_omitted_fields(client):
    project = client.post("/api/projects", json={"name": "agent imports"}).json()["id"]
    def submit(data):
        response = client.post(f"/api/projects/{project}/agent-import", json={"module": "run", "content": json.dumps(data), "dry_run": False})
        assert response.status_code == 200 and response.json()["ok"]
    submit({"runs": [{"ref": "run-1", "name": "first", "status": "running", "dataset": "dataset A", "params": {"seed": 2}}]})
    submit({"runs": [{"ref": "run-1", "name": "second", "status": "planned"}]})
    submit({"runs": [{"ref": "run-2", "name": "first", "notes": "new observation"}]})
    runs = {run["name"]: run for run in client.get(f"/api/projects/{project}/runs").json()}
    assert set(runs) == {"first", "second"}
    assert runs["first"]["status"] == "running"
    assert runs["first"]["dataset"] == "dataset A"
    assert runs["first"]["params"] == {"seed": 2}
    assert runs["first"]["notes"] == "new observation"


def test_agent_import_applies_explicit_new_idea_status(client):
    project = client.post("/api/projects", json={"name": "agent idea"}).json()["id"]
    data = {"ideas": [{"title": "claim", "body": "claim body", "status": "testing"}]}
    result = client.post(f"/api/projects/{project}/agent-import", json={"module": "idea", "content": json.dumps(data), "dry_run": False}).json()
    assert result["ok"]
    assert client.get(f"/api/projects/{project}/ideas").json()[0]["status"] == "testing"
