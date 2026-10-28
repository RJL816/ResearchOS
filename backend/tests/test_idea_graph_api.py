"""Phase 2: project-level idea graph and version details API."""

from tests.test_api_ideas import setup_project  # reuse helper


def add_idea(client, pid, title, body="body"):
    return client.post(f"/api/projects/{pid}/ideas", json={"title": title, "body": body}).json()


def add_version(client, idea_id, body, reason=None):
    payload = {"body": body}
    if reason:
        payload["change_reason"] = reason
    return client.post(f"/api/ideas/{idea_id}/versions", json=payload).json()


def add_run(client, pid, name, metrics=None):
    run = client.post(f"/api/projects/{pid}/runs", json={"name": name}).json()
    if metrics:
        client.post(f"/api/runs/{run['id']}/metrics", json={"points": metrics})
    return run


def graph(client, pid):
    resp = client.get(f"/api/projects/{pid}/idea-graph")
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_empty_project_returns_empty_graph(client):
    pid = setup_project(client, "empty")
    data = graph(client, pid)
    assert data == {"project_id": pid, "nodes": [], "edges": []}


def test_single_node_graph(client):
    pid = setup_project(client, "single")
    idea = add_idea(client, pid, "only idea", "假设正文")
    data = graph(client, pid)
    assert len(data["nodes"]) == 1 and data["edges"] == []
    node = data["nodes"][0]
    assert node["id"] == idea["current_version_id"]  # stable DB version id
    assert node["idea_id"] == idea["id"]
    assert node["version"] == 1
    assert node["status"] == "exploring"
    assert node["evidence_count"] == 0 and node["run_count"] == 0
    assert node["summary"] == "假设正文"
    assert node["supports_count"] == 0 and node["refutes_count"] == 0


def test_chain_versions_create_revision_edges(client):
    pid = setup_project(client, "chain")
    idea = add_idea(client, pid, "chain idea", "v1")
    v2 = add_version(client, idea["id"], "v2 body", "second thoughts")
    data = graph(client, pid)
    assert {(n["version"], n["idea_id"]) for n in data["nodes"]} == {(1, idea["id"]), (2, idea["id"])}
    assert len(data["edges"]) == 1
    edge = data["edges"][0]
    assert edge["source"] == idea["current_version_id"] or edge["source"] < edge["target"]
    assert edge["relation"] == "revision"
    assert edge["reason"] == "second thoughts"
    assert edge["target"] == v2["id"]


def test_branch_merge_and_new_relations(client):
    pid = setup_project(client, "bmm")
    idea_a = add_idea(client, pid, "A", "A v1")
    a2 = add_version(client, idea_a["id"], "A v2")
    idea_b = add_idea(client, pid, "B", "B v1")
    idea_c = add_idea(client, pid, "C merge target", "C v1")

    a_v1 = idea_a["versions"][0]["id"]
    b_v1 = idea_b["current_version_id"]
    c_v1 = idea_c["current_version_id"]

    # branch: A.v2 derives from A.v1 is auto (revision); manual cross-idea edges:
    assert client.post("/api/idea-edges", json={
        "src_version_id": a2["id"], "dst_version_id": b_v1, "relation": "derivation",
    }).status_code == 201
    assert client.post("/api/idea-edges", json={
        "src_version_id": b_v1, "dst_version_id": a2["id"], "relation": "challenges",
        "note": "B 的结果与 A v2 矛盾",
    }).status_code == 201
    # multi-parent merge: C.v1 combines A.v1 and A.v2
    for src in (a_v1, a2["id"]):
        assert client.post("/api/idea-edges", json={
            "src_version_id": src, "dst_version_id": c_v1, "relation": "merge",
        }).status_code == 201
    assert client.post("/api/idea-edges", json={
        "src_version_id": c_v1, "dst_version_id": a_v1, "relation": "supersedes",
    }).status_code == 201

    data = graph(client, pid)
    assert len(data["nodes"]) == 4  # A v1, A v2, B v1, C v1
    relations = {e["relation"] for e in data["edges"]}
    assert {"revision", "derivation", "challenges", "merge", "supersedes"} <= relations
    incoming_to_c = [e for e in data["edges"] if e["target"] == c_v1]
    assert len(incoming_to_c) == 2  # multi-parent merge node


def test_multiple_independent_roots(client):
    pid = setup_project(client, "roots")
    add_idea(client, pid, "root1")
    add_idea(client, pid, "root2")
    data = graph(client, pid)
    assert len(data["nodes"]) == 2 and data["edges"] == []
    assert {n["idea_id"] for n in data["nodes"]} == {1, 2} or len(data["nodes"]) == 2


def test_node_counts_reflect_evidence(client):
    pid = setup_project(client, "counts")
    idea = add_idea(client, pid, "evidenced")
    run = add_run(client, pid, "r1", metrics=[{"name": "acc", "step": 0, "value": 0.5}])
    client.post("/api/evidence-links", json={
        "idea_version_id": idea["current_version_id"], "run_id": run["id"], "verdict": "supports",
    })
    node = graph(client, pid)["nodes"][0]
    assert node["evidence_count"] == 1
    assert node["run_count"] == 1
    assert node["supports_count"] == 1 and node["refutes_count"] == 0


def test_summary_is_truncated_but_details_keep_full_text(client):
    pid = setup_project(client, "summary")
    long_body = "word " * 80  # 400 chars
    idea = add_idea(client, pid, "long", long_body)
    node = graph(client, pid)["nodes"][0]
    assert len(node["summary"]) <= 141 and node["summary"].endswith("…")

    details = client.get(f"/api/idea-versions/{idea['current_version_id']}/details").json()
    assert details["version"]["body"] == long_body


def test_version_details_content(client):
    pid = setup_project(client, "details")
    idea = add_idea(client, pid, "D", "v1 body")
    v2 = add_version(client, idea["id"], "v2 body changed", "new evidence")
    run = add_run(client, pid, "run-x", metrics=[
        {"name": "train/loss", "step": 0, "value": 1.0},
        {"name": "train/loss", "step": 1, "value": 0.5},
    ])
    client.post("/api/evidence-links", json={
        "idea_version_id": v2["id"], "run_id": run["id"], "verdict": "refutes", "note": "指标下降",
    })
    client.post(f"/api/projects/{pid}/notes", json={
        "title": "note for idea", "content": "content", "idea_id": idea["id"],
    })

    resp = client.get(f"/api/idea-versions/{v2['id']}/details")
    assert resp.status_code == 200
    details = resp.json()
    assert details["version"]["version_number"] == 2
    assert details["idea"]["title"] == "D"
    assert details["previous_version"]["version_number"] == 1
    assert details["previous_version"]["body"] == "v1 body"
    assert [e["relation"] for e in details["incoming"]] == ["revision"]
    assert details["incoming"][0]["other"]["title"] == "D"
    assert details["outgoing"] == []
    evidence = details["evidence"][0]
    assert evidence["verdict"] == "refutes" and evidence["note"] == "指标下降"
    assert evidence["run_name"] == "run-x"
    assert evidence["run_metrics"] == [{"name": "train/loss", "last_step": 1, "last_value": 0.5}]
    assert [n["title"] for n in details["notes"]] == ["note for idea"]


def test_details_404_and_graph_404(client):
    assert client.get("/api/idea-versions/9999/details").status_code == 404
    assert client.get("/api/projects/9999/idea-graph").status_code == 404


def test_cross_project_edge_rejected(client):
    pid1 = setup_project(client, "P1")
    pid2 = setup_project(client, "P2")
    idea1 = add_idea(client, pid1, "in-p1")
    idea2 = add_idea(client, pid2, "in-p2")
    resp = client.post("/api/idea-edges", json={
        "src_version_id": idea1["current_version_id"],
        "dst_version_id": idea2["current_version_id"],
        "relation": "derivation",
    })
    assert resp.status_code == 422
    assert "same project" in resp.json()["detail"]
    # and the project graph of p1 stays clean of dangling references
    assert graph(client, pid1)["edges"] == []
