import json
from app.ai.agent_parser import parse_agent_text, split_text


class FakeModel:
    def __init__(self, replies):
        self.replies = iter(replies)
        self.calls = []

    def chat(self, system, prompt):
        self.calls.append((system, prompt))
        return json.dumps(next(self.replies), ensure_ascii=False)


def test_segments_preserve_all_text_and_do_not_exceed_limit():
    text = "第一段\n\n" + "研究内容" * 20 + "\n\n最后一段"
    parts = split_text(text, 20)
    assert "".join(parts) == text
    assert all(len(part) <= 20 for part in parts)


def test_modules_segment_and_preserve_cross_segment_refs():
    model = FakeModel([
        {"ideas": [{"ref": "i1", "title": "假设一", "body": "正文"}]},
        {"notes": [{"title": "Next: 复验", "content": "控制变量", "idea": "segment-1-i1"}]},
    ])
    result, count, _ = parse_agent_text("甲" * 30, "idea", model, max_chars=15, retries=0)
    assert count == 2
    assert result["ideas"][0]["ref"] == "segment-1-i1"
    assert result["notes"][0]["idea"] == "segment-1-i1"
    assert "只整理研究假设" in model.calls[0][1]
    assert "segment-1-i1" in model.calls[1][1]


def test_parse_preview_does_not_write_and_commit_uses_reviewed_content(client, monkeypatch):
    project = client.post("/api/projects", json={"name": "AI import"}).json()["id"]
    model = FakeModel([{"notes": [{"title": "Next: 对照", "content": "准备对照组"}]}])
    monkeypatch.setattr("app.routers.agent.get_glm_client", lambda: model)
    parsed = client.post(f"/api/projects/{project}/agent-import/parse", json={"module": "note", "content": "请准备对照组"})
    assert parsed.status_code == 200
    result = parsed.json()
    assert result["preview"]["ok"] and result["segments"] == 1
    assert client.get(f"/api/projects/{project}/notes").json() == []
    done = client.post(f"/api/projects/{project}/agent-import", json={"module": "note", "content": result["normalized"]})
    assert done.json()["ok"]
    assert client.get(f"/api/projects/{project}/notes").json()[0]["title"] == "Next: 对照"
    assert "只整理研究笔记" in model.calls[0][1]


def test_module_rejects_unrelated_records(client, monkeypatch):
    project = client.post("/api/projects", json={"name": "module validation"}).json()["id"]
    model = FakeModel([{"runs": [{"name": "irrelevant"}]}] * 3)
    monkeypatch.setattr("app.routers.agent.get_glm_client", lambda: model)
    response = client.post(f"/api/projects/{project}/agent-import/parse", json={"module": "note", "content": "只是笔记"})
    assert response.status_code == 422
    assert client.get(f"/api/projects/{project}/runs").json() == []


def test_model_settings_never_returns_secret(client, monkeypatch, tmp_path):
    from app.ai import secret_store
    monkeypatch.setattr(secret_store, "config_path", lambda: tmp_path / "model-config.dpapi")
    r = client.put("/api/model-settings", json={"api_key": "my-secret-key", "base_url": "https://example.test/v1", "model": "test"})
    assert r.status_code == 200 and r.json()["configured"]
    assert "my-secret-key" not in r.text
    assert "my-secret-key" not in client.get("/api/model-settings").text
    assert b"my-secret-key" not in (tmp_path / "model-config.dpapi").read_bytes()
    assert secret_store.load_config()["api_key"] == "my-secret-key"
    again = client.put("/api/model-settings", json={"api_key": "", "base_url": "https://example.test/v1", "model": "new-model"})
    assert again.status_code == 200 and secret_store.load_config()["api_key"] == "my-secret-key"
    assert secret_store.load_config()["model"] == "new-model"
