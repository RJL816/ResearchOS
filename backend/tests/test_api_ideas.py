"""API behavior tests: ideas, immutable versions, evolution graph."""


def setup_project(client, name="P"):
    return client.post("/api/projects", json={"name": name}).json()["id"]


def test_create_idea_produces_version_1(client):
    pid = setup_project(client)
    resp = client.post(
        f"/api/projects/{pid}/ideas",
        json={"title": "rank matters", "body": "Higher rank improves accuracy."},
    )
    assert resp.status_code == 201, resp.text
    idea = resp.json()
    assert len(idea["versions"]) == 1
    v1 = idea["versions"][0]
    assert v1["version_number"] == 1
    assert v1["body"] == "Higher rank improves accuracy."
    assert idea["current_version_id"] == v1["id"]
    assert "updated_at" not in v1  # versions have no updated_at: immutable


def test_add_version_bumps_pointer_and_creates_revision_edge(client):
    pid = setup_project(client)
    idea = client.post(
        f"/api/projects/{pid}/ideas", json={"title": "t", "body": "v1 body"}
    ).json()
    v1_id = idea["current_version_id"]

    resp = client.post(
        f"/api/ideas/{idea['id']}/versions",
        json={"body": "v2 body", "change_reason": "after seeing run results"},
    )
    assert resp.status_code == 201
    v2 = resp.json()
    assert v2["version_number"] == 2

    updated = client.get(f"/api/ideas/{idea['id']}").json()
    assert updated["current_version_id"] == v2["id"]

    graph = client.get(f"/api/ideas/{idea['id']}/graph").json()
    assert len(graph["edges"]) == 1
    edge = graph["edges"][0]
    assert edge["src_version_id"] == v1_id
    assert edge["dst_version_id"] == v2["id"]
    assert edge["relation"] == "revision"
    assert edge["note"] == "after seeing run results"


def test_idea_version_update_is_explicitly_rejected(client):
    pid = setup_project(client)
    idea = client.post(f"/api/projects/{pid}/ideas", json={"title": "t", "body": "b"}).json()
    v1 = idea["current_version_id"]
    for method in ("put", "patch"):
        resp = getattr(client, method)(f"/api/idea-versions/{v1}", json={"body": "tampered"})
        assert resp.status_code == 405
        assert "immutable" in resp.json()["detail"]


def test_idea_title_conflict_within_project(client):
    pid = setup_project(client)
    client.post(f"/api/projects/{pid}/ideas", json={"title": "dup", "body": "b"})
    resp = client.post(f"/api/projects/{pid}/ideas", json={"title": "dup", "body": "b2"})
    assert resp.status_code == 409
    # Same title in another project is allowed.
    pid2 = setup_project(client, "P2")
    assert client.post(f"/api/projects/{pid2}/ideas", json={"title": "dup", "body": "b3"}).status_code == 201


def test_patch_idea_updates_identity_only(client):
    pid = setup_project(client)
    idea = client.post(f"/api/projects/{pid}/ideas", json={"title": "t", "body": "b"}).json()
    resp = client.patch(f"/api/ideas/{idea['id']}", json={"status": "testing"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "testing"


def test_manual_derivation_edge_across_ideas(client):
    pid = setup_project(client)
    idea_a = client.post(f"/api/projects/{pid}/ideas", json={"title": "A", "body": "a"}).json()
    idea_b = client.post(f"/api/projects/{pid}/ideas", json={"title": "B", "body": "b"}).json()
    src = idea_a["current_version_id"]
    dst = idea_b["current_version_id"]
    resp = client.post(
        "/api/idea-edges",
        json={"src_version_id": src, "dst_version_id": dst, "relation": "derivation"},
    )
    assert resp.status_code == 201
    # duplicate edge rejected
    assert client.post(
        "/api/idea-edges",
        json={"src_version_id": src, "dst_version_id": dst, "relation": "derivation"},
    ).status_code == 409
    # self loop rejected
    assert client.post(
        "/api/idea-edges",
        json={"src_version_id": src, "dst_version_id": src, "relation": "derivation"},
    ).status_code == 422


def test_idea_in_missing_project_404(client):
    assert client.post("/api/projects/42/ideas", json={"title": "t", "body": "b"}).status_code == 404
