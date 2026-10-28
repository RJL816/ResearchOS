"""API behavior tests: runs, metrics, idempotent upserts."""


def setup_project(client, name="P"):
    return client.post("/api/projects", json={"name": name}).json()["id"]


def test_create_run_generates_external_key(client):
    pid = setup_project(client)
    resp = client.post(
        f"/api/projects/{pid}/runs",
        json={"name": "baseline", "params": {"lr": 1e-4, "rank": 8}, "git_commit": "abc123"},
    )
    assert resp.status_code == 201, resp.text
    run = resp.json()
    assert run["external_source"] == "manual"
    assert run["external_key"]  # auto-generated
    assert run["params"] == {"lr": 1e-4, "rank": 8}  # JSON round-trip
    assert run["git_commit"] == "abc123"


def test_run_upsert_by_external_key_is_idempotent(client):
    pid = setup_project(client)
    payload = {
        "name": "run-1",
        "external_source": "csv",
        "external_key": "results/2026-10-27/run-1",
    }
    first = client.post(f"/api/projects/{pid}/runs", json=payload)
    assert first.status_code == 201
    payload["name"] = "run-1 (renamed)"
    second = client.post(f"/api/projects/{pid}/runs", json=payload)
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["name"] == "run-1 (renamed)"
    assert len(client.get(f"/api/projects/{pid}/runs").json()) == 1


def test_metrics_bulk_upsert(client):
    pid = setup_project(client)
    run_id = client.post(f"/api/projects/{pid}/runs", json={"name": "r"}).json()["id"]
    points = [
        {"name": "train/loss", "step": 0, "value": 1.0},
        {"name": "train/loss", "step": 1, "value": 0.6},
        {"name": "eval/acc", "step": 0, "value": 0.4},
    ]
    resp = client.post(f"/api/runs/{run_id}/metrics", json={"points": points})
    assert resp.status_code == 200
    assert resp.json() == {"run_id": run_id, "inserted": 3, "updated": 0}

    # Re-import with one changed value: no growth, value updated.
    points[1]["value"] = 0.55
    points.append({"name": "train/loss", "step": 2, "value": 0.3})
    resp = client.post(f"/api/runs/{run_id}/metrics", json={"points": points})
    assert resp.json() == {"run_id": run_id, "inserted": 1, "updated": 3}

    metrics = client.get(f"/api/runs/{run_id}/metrics").json()
    series = {s["name"]: s["points"] for s in metrics["series"]}
    assert len(series["train/loss"]) == 3
    assert series["train/loss"][1]["value"] == 0.55


def test_run_detail_metric_stats(client):
    pid = setup_project(client)
    run_id = client.post(f"/api/projects/{pid}/runs", json={"name": "r"}).json()["id"]
    client.post(
        f"/api/runs/{run_id}/metrics",
        json={
            "points": [
                {"name": "eval/acc", "step": 0, "value": 0.4},
                {"name": "eval/acc", "step": 1, "value": 0.7},
                {"name": "eval/acc", "step": 2, "value": 0.55},
            ]
        },
    )
    detail = client.get(f"/api/runs/{run_id}").json()
    stats = detail["metric_stats"][0]
    assert stats["name"] == "eval/acc"
    assert stats["count"] == 3
    assert stats["last_step"] == 2
    assert stats["last_value"] == 0.55
    assert stats["min_value"] == 0.4
    assert stats["max_value"] == 0.7


def test_patch_run_cannot_change_identity(client):
    pid = setup_project(client)
    run = client.post(f"/api/projects/{pid}/runs", json={"name": "r"}).json()
    resp = client.patch(
        f"/api/runs/{run['id']}",
        json={"name": "renamed", "status": "succeeded", "external_key": "hijack"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "renamed"
    assert body["status"] == "succeeded"
    assert body["external_key"] == run["external_key"]  # identity not updatable


def test_run_not_found_and_invalid_payload(client):
    assert client.get("/api/runs/777").status_code == 404
    pid = setup_project(client)
    assert (
        client.post(f"/api/projects/{pid}/runs", json={"name": "r", "status": "exploded"}).status_code
        == 422
    )


def test_delete_run_removes_metrics(client):
    pid = setup_project(client)
    run_id = client.post(f"/api/projects/{pid}/runs", json={"name": "r"}).json()["id"]
    client.post(f"/api/runs/{run_id}/metrics", json={"points": [{"name": "x", "step": 0, "value": 1}]})
    assert client.delete(f"/api/runs/{run_id}").status_code == 204
    assert client.get(f"/api/runs/{run_id}").status_code == 404
    assert client.get(f"/api/runs/{run_id}/metrics").status_code == 404
