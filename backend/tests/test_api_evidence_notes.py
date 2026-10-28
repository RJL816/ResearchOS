"""API behavior tests: evidence links and research notes."""


def setup_project_with_idea_and_run(client, name="P"):
    pid = client.post("/api/projects", json={"name": name}).json()["id"]
    idea = client.post(f"/api/projects/{pid}/ideas", json={"title": "t", "body": "b"}).json()
    run = client.post(f"/api/projects/{pid}/runs", json={"name": "r"}).json()
    return pid, idea, run


def test_evidence_upsert_changes_verdict_not_identity(client):
    pid, idea, run = setup_project_with_idea_and_run(client)
    version_id = idea["current_version_id"]
    first = client.post(
        "/api/evidence-links",
        json={"idea_version_id": version_id, "run_id": run["id"], "verdict": "supports",
              "note": "acc +2pt"},
    )
    assert first.status_code == 201
    second = client.post(
        "/api/evidence-links",
        json={"idea_version_id": version_id, "run_id": run["id"], "verdict": "inconclusive"},
    )
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["verdict"] == "inconclusive"

    evidence = client.get(f"/api/idea-versions/{version_id}/evidence").json()
    assert len(evidence) == 1
    assert evidence[0]["run_name"] == "r"
    assert evidence[0]["verdict"] == "inconclusive"


def test_evidence_across_projects_rejected(client):
    pid1, idea1, _ = setup_project_with_idea_and_run(client, "P1")
    pid2 = client.post("/api/projects", json={"name": "P2"}).json()["id"]
    run2 = client.post(f"/api/projects/{pid2}/runs", json={"name": "other-run"}).json()
    resp = client.post(
        "/api/evidence-links",
        json={"idea_version_id": idea1["current_version_id"], "run_id": run2["id"],
              "verdict": "supports"},
    )
    assert resp.status_code == 422
    assert "different projects" in resp.json()["detail"]


def test_evidence_invalid_verdict_and_missing_refs(client):
    pid, idea, run = setup_project_with_idea_and_run(client)
    payload = {"idea_version_id": idea["current_version_id"], "run_id": run["id"]}
    assert client.post("/api/evidence-links", json={**payload, "verdict": "proves"}).status_code == 422
    assert (
        client.post("/api/evidence-links", json={**payload, "verdict": "supports", "run_id": 999}).status_code
        == 404
    )


def test_patch_and_delete_evidence(client):
    pid, idea, run = setup_project_with_idea_and_run(client)
    link = client.post(
        "/api/evidence-links",
        json={"idea_version_id": idea["current_version_id"], "run_id": run["id"], "verdict": "supports"},
    ).json()
    resp = client.patch(f"/api/evidence-links/{link['id']}", json={"verdict": "refutes"})
    assert resp.json()["verdict"] == "refutes"
    assert client.delete(f"/api/evidence-links/{link['id']}").status_code == 204


def test_notes_crud_and_run_delete_keeps_note(client):
    pid, idea, run = setup_project_with_idea_and_run(client)
    note = client.post(
        f"/api/projects/{pid}/notes",
        json={"title": "weekly summary", "content": "loss still high", "run_id": run["id"]},
    ).json()
    assert note["run_id"] == run["id"]
    listing = client.get(f"/api/projects/{pid}/notes").json()
    assert len(listing) == 1

    # Deleting the run clears the link but keeps the note.
    client.delete(f"/api/runs/{run['id']}")
    notes = client.get(f"/api/projects/{pid}/notes").json()
    assert len(notes) == 1
    assert notes[0]["run_id"] is None
    assert notes[0]["title"] == "weekly summary"

    assert client.patch(f"/api/notes/{note['id']}", json={"title": "updated"}).json()["title"] == "updated"
    assert client.delete(f"/api/notes/{note['id']}").status_code == 204


def test_note_with_foreign_run_rejected(client):
    pid1, _, _ = setup_project_with_idea_and_run(client, "P1")
    pid2 = client.post("/api/projects", json={"name": "P2"}).json()["id"]
    run2 = client.post(f"/api/projects/{pid2}/runs", json={"name": "r2"}).json()
    resp = client.post(
        f"/api/projects/{pid1}/notes", json={"title": "note", "run_id": run2["id"]}
    )
    assert resp.status_code == 422
