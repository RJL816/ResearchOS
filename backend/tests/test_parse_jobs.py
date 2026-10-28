import threading
import time
import uuid

import pytest
from fastapi import HTTPException


def wait_for(client, job_id, state="completed"):
    for _ in range(200):
        result = client.get(f"/api/parse-jobs/{job_id}").json()
        if result["status"] == state:
            return result
        time.sleep(0.01)
    pytest.fail(f"job did not reach {state}: {result}")


def test_background_job_survives_request_and_is_idempotent(client, monkeypatch):
    project = client.post("/api/projects", json={"name": "background"}).json()["id"]
    started, release = threading.Event(), threading.Event()
    calls = []
    def slow_parse(target, body, db):
        calls.append((target, body.content))
        started.set()
        assert release.wait(5)
        return {"draft": {"ideas": []}, "source_hash": "test"}
    monkeypatch.setattr("app.routers.research_evolution.parse", slow_parse)
    job_id = str(uuid.uuid4())
    request = {"job_id": job_id, "kind": "evolution", "target_id": project, "filename": "r.md", "content": "source"}
    try:
        assert client.post("/api/parse-jobs", json=request).status_code == 202
        assert started.wait(2)
        assert client.get(f"/api/parse-jobs/{job_id}").json()["status"] == "running"
        assert client.post("/api/parse-jobs", json=request).status_code == 202
        assert client.post("/api/parse-jobs", json={**request, "content": "different"}).status_code == 409
        release.set()
        job = wait_for(client, job_id)
        assert job["target_id"] == project and job["result"]["source_hash"] == "test"
        assert calls == [(project, "source")]
    finally:
        release.set()


def test_proposal_and_agent_auto_tasks_report_results_and_errors(client, monkeypatch):
    project = client.post("/api/projects", json={"name": "task types"}).json()["id"]
    idea = client.post(f"/api/projects/{project}/research-ideas", json={"title":"idea"}).json()["id"]
    monkeypatch.setattr("app.routers.research_ideas.parse_document", lambda target, body, db: {"source_hash": "proposal", "sections": {}})
    job = str(uuid.uuid4())
    assert client.post("/api/parse-jobs", json={"job_id":job, "kind":"proposal", "target_id":idea, "content":"source"}).status_code == 202
    assert wait_for(client, job)["result"]["source_hash"] == "proposal"
    monkeypatch.setattr("app.routers.agent.parse_import", lambda target, body, db: {"records":{"ideas":[{"title":"a"}]}, "preview":{"ok":True}, "normalized":"{}"})
    calls = []
    monkeypatch.setattr("app.routers.agent.agent_import", lambda target, body, db: calls.append(target) or {"ok":True, "created":[]})
    job = str(uuid.uuid4())
    payload = {"job_id":job, "kind":"agent_auto", "target_id":project, "content":"source", "module":"idea"}
    assert client.post("/api/parse-jobs", json=payload).status_code == 202
    assert wait_for(client, job)["result"]["imported"]["ok"]
    assert client.post("/api/parse-jobs", json=payload).status_code == 202
    assert calls == [project]
    def fail(*args):
        raise HTTPException(422, "模型拒绝该请求")
    monkeypatch.setattr("app.routers.research_ideas.parse_document", fail)
    failed = str(uuid.uuid4())
    assert client.post("/api/parse-jobs", json={"job_id":failed, "kind":"proposal", "target_id":idea, "content":"source"}).status_code == 202
    assert wait_for(client, failed, "failed")["error"] == "模型拒绝该请求"
    assert client.get(f"/api/parse-jobs/{uuid.uuid4()}").status_code == 404


def test_background_job_reports_real_progress(client, monkeypatch):
    from app.ai import progress
    project = client.post("/api/projects", json={"name":"progress"}).json()["id"]
    waiting, finish = threading.Event(), threading.Event()
    def parse(target, body, db):
        progress.report(1, 4, "正在解析第 2/4 段")
        waiting.set()
        assert finish.wait(5)
        progress.report(4, 4, "正在整理与校验")
        return {"ok":True}
    monkeypatch.setattr("app.routers.research_evolution.parse", parse)
    job = str(uuid.uuid4())
    try:
        assert client.post("/api/parse-jobs", json={"job_id":job,"kind":"evolution","target_id":project,"content":"report"}).status_code == 202
        assert waiting.wait(2)
        active = client.get(f"/api/parse-jobs/{job}").json()
        assert (active["completed"], active["total"], active["stage"]) == (1,4,"正在解析第 2/4 段")
        finish.set()
        result = wait_for(client, job)
        assert (result["completed"], result["total"]) == (4,4)
    finally:
        finish.set()
