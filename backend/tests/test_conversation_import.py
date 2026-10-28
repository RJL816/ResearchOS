"""Phase 3: conversation import API — parsing, dedup, limits, masking."""

import json


CONVERSATION_TEXT = """user: 我觉得 LoRA rank=8 就够了
assistant: 同意，但大模型上可能不够。
user: 那就先测 rank=32。

```python
user: 这行在代码块里不应被切分
```
assistant: 结论是做消融实验。"""


def _import(client, content=CONVERSATION_TEXT, source="paste", title=None):
    client.post("/api/projects", json={"name": "导入测试项目"})
    payload = {"source": source, "content": content}
    if title:
        payload["title"] = title
    return client.post("/api/projects/1/conversations", json=payload)


def test_import_parses_roles_and_preserves_code_fence(client):
    resp = _import(client)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    messages = body["conversation"]["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]
    assert "user: 这行在代码块里不应被切分" in messages[2]["content"]  # fence preserved
    assert messages[0]["sequence"] == 1 and messages[-1]["sequence"] == 4
    assert body["deduplicated"] is False
    assert body["conversation"]["message_count"] == 4


def test_reimport_same_content_is_idempotent(client):
    first = _import(client)
    second = _import(client)
    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["deduplicated"] is True
    assert second.json()["conversation"]["id"] == first.json()["conversation"]["id"]
    listing = client.get("/api/projects/1/conversations").json()
    assert len(listing) == 1


def test_structured_json_import_validated(client):
    payload = {
        "title": "结构化会话",
        "messages": [
            {"role": "user", "content": "第一句"},
            {"role": "assistant", "content": "回复", "created_at": "2026-10-27T10:00:00Z"},
        ],
    }
    resp = _import(client, content=json.dumps(payload), source="file_json")  # JSON 内 title 优先
    assert resp.status_code == 201
    body = resp.json()["conversation"]
    assert body["title"] == "结构化会话"
    assert body["messages"][1]["sent_at"] is not None

    bad = _import(client, content=json.dumps({"nope": 1}), source="file_json")
    assert bad.status_code == 422
    assert "messages" in bad.json()["detail"]


def test_oversize_content_rejected_not_truncated(client):
    from app.config import get_settings

    big = "x" * (get_settings().conversation_max_chars + 1)
    resp = _import(client, content=big)
    assert resp.status_code == 422
    assert "超过上限" in resp.json()["detail"]


def test_payload_preview_masks_secrets(client):
    content = "user: 我的 key 是 sk-abcdef1234567890 别泄露\nassistant: 好的"
    conv = _import(client, content=content).json()["conversation"]
    resp = client.get(f"/api/conversations/{conv['id']}/payload-preview")
    assert resp.status_code == 200
    preview = resp.json()
    assert preview["segment_count"] >= 1
    assert all("sk-abcdef1234567890" not in segment for segment in preview["segments"])
    assert "[REDACTED]" in preview["segments"][0]
    assert preview["masked_chars"] >= 1


def test_analyze_requires_runtime_key(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "glm_api_key", "")
    monkeypatch.setattr("app.routers.conversations._run_job_blocking", lambda job_id: None)
    conv = _import(client, content="user: hi").json()["conversation"]
    resp = client.post(f"/api/conversations/{conv['id']}/analyze")
    assert resp.status_code == 503
    assert "GLM_API_KEY" in resp.json()["detail"]
