"""API behavior tests: projects CRUD and error semantics."""


def test_create_and_list_projects(client):
    resp = client.post("/api/projects", json={"name": "LoRA Scaling", "description": "adapter rank study"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "LoRA Scaling"
    assert body["status"] == "active"
    assert body["id"] > 0

    client.post("/api/projects", json={"name": "Retrieval"})
    listing = client.get("/api/projects")
    assert listing.status_code == 200
    names = [p["name"] for p in listing.json()]
    assert names == ["Retrieval", "LoRA Scaling"]  # ordered by updated_at desc
    counts = listing.json()[0]
    assert counts["idea_count"] == 0 and counts["run_count"] == 0


def test_duplicate_project_name_conflicts(client):
    client.post("/api/projects", json={"name": "dup"})
    resp = client.post("/api/projects", json={"name": "dup"})
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


def test_get_missing_project_404(client):
    resp = client.get("/api/projects/9999")
    assert resp.status_code == 404
    assert "9999" in resp.json()["detail"]


def test_patch_project_name_conflict(client):
    client.post("/api/projects", json={"name": "a"})
    client.post("/api/projects", json={"name": "b"})
    b_id = client.get("/api/projects").json()[0]["id"]
    resp = client.patch(f"/api/projects/{b_id}", json={"name": "a"})
    assert resp.status_code == 409
    ok = client.patch(f"/api/projects/{b_id}", json={"status": "paused"})
    assert ok.status_code == 200
    assert ok.json()["status"] == "paused"


def test_invalid_status_rejected(client):
    resp = client.post("/api/projects", json={"name": "x", "status": "zombie"})
    assert resp.status_code == 422


def test_delete_project(client):
    pid = client.post("/api/projects", json={"name": "gone"}).json()["id"]
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404
