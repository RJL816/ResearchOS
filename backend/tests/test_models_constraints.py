"""Database-level constraint and cascade tests (direct ORM access)."""

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import (
    EvidenceLink,
    ExperimentRun,
    Idea,
    IdeaEdge,
    IdeaVersion,
    MetricPoint,
    Project,
    ResearchNote,
)


def make_project(db, name="project-a"):
    project = Project(name=name)
    db.add(project)
    db.flush()
    return project


def make_idea_with_v1(db, project, title="hypothesis"):
    idea = Idea(project_id=project.id, title=title)
    db.add(idea)
    db.flush()
    version = IdeaVersion(idea_id=idea.id, version_number=1, body="v1 body")
    db.add(version)
    db.flush()
    idea.current_version_id = version.id
    db.flush()
    return idea, version


def make_run(db, project, key="run-1"):
    run = ExperimentRun(project_id=project.id, name="run", external_source="manual", external_key=key)
    db.add(run)
    db.flush()
    return run


def test_project_name_is_unique(db_session):
    db = db_session
    make_project(db, "dup")
    db.commit()
    db.add(Project(name="dup"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_idea_title_unique_within_project(db_session):
    db = db_session
    project = make_project(db)
    make_idea_with_v1(db, project, "same title")
    db.commit()
    with pytest.raises(IntegrityError):
        db.add(Idea(project_id=project.id, title="same title"))
        db.commit()
    db.rollback()


def test_idea_version_number_unique(db_session):
    db = db_session
    project = make_project(db)
    idea, v1 = make_idea_with_v1(db, project)
    db.add(IdeaVersion(idea_id=idea.id, version_number=1, body="colliding"))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_run_external_key_unique_within_project(db_session):
    db = db_session
    project = make_project(db)
    make_run(db, project, "k1")
    db.commit()
    with pytest.raises(IntegrityError):
        make_run(db, project, "k1")  # same (project, source, key)
    db.rollback()
    # The same key in a different project is fine.
    other = make_project(db, "project-b")
    make_run(db, other, "k1")
    db.commit()


def test_metric_point_unique_per_run_name_step(db_session):
    db = db_session
    project = make_project(db)
    run = make_run(db, project)
    db.add(MetricPoint(run_id=run.id, name="loss", step=1, value=0.5))
    db.flush()
    db.add(MetricPoint(run_id=run.id, name="loss", step=1, value=0.4))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_evidence_link_unique_per_version_run(db_session):
    db = db_session
    project = make_project(db)
    idea, version = make_idea_with_v1(db, project)
    run = make_run(db, project)
    db.add(EvidenceLink(idea_version_id=version.id, run_id=run.id, verdict="supports"))
    db.flush()
    db.add(EvidenceLink(idea_version_id=version.id, run_id=run.id, verdict="refutes"))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_evidence_verdict_check_constraint(db_session):
    db = db_session
    project = make_project(db)
    _, version = make_idea_with_v1(db, project)
    run = make_run(db, project)
    db.add(EvidenceLink(idea_version_id=version.id, run_id=run.id, verdict="strongly_supports"))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_idea_edge_self_loop_rejected(db_session):
    db = db_session
    project = make_project(db)
    _, version = make_idea_with_v1(db, project)
    db.add(IdeaEdge(src_version_id=version.id, dst_version_id=version.id, relation="revision"))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_deleting_project_cascades_everything(db_session):
    db = db_session
    project = make_project(db)
    idea, version = make_idea_with_v1(db, project)
    v2 = IdeaVersion(idea_id=idea.id, version_number=2, body="v2")
    db.add(v2)
    db.flush()
    db.add(IdeaEdge(src_version_id=version.id, dst_version_id=v2.id, relation="revision"))
    run = make_run(db, project)
    db.add(MetricPoint(run_id=run.id, name="loss", step=0, value=1.0))
    db.add(EvidenceLink(idea_version_id=v2.id, run_id=run.id, verdict="supports"))
    db.add(ResearchNote(project_id=project.id, title="note"))
    db.commit()

    db.delete(project)
    db.commit()

    counts = {
        "projects": Project,
        "ideas": Idea,
        "idea_versions": IdeaVersion,
        "idea_edges": IdeaEdge,
        "experiment_runs": ExperimentRun,
        "metric_points": MetricPoint,
        "evidence_links": EvidenceLink,
        "research_notes": ResearchNote,
    }
    for label, model in counts.items():
        assert db.scalar(select(func.count()).select_from(model)) == 0, label


def test_deleting_run_keeps_note_but_nulls_link_and_drops_children(db_session):
    db = db_session
    project = make_project(db)
    idea, version = make_idea_with_v1(db, project)
    run = make_run(db, project)
    db.add(MetricPoint(run_id=run.id, name="loss", step=0, value=1.0))
    db.add(EvidenceLink(idea_version_id=version.id, run_id=run.id, verdict="inconclusive"))
    db.add(ResearchNote(project_id=project.id, title="kept note", run_id=run.id))
    db.commit()
    note_id = db.scalar(select(ResearchNote.id).where(ResearchNote.run_id == run.id))

    db.delete(run)
    db.commit()

    assert db.get(ResearchNote, note_id) is not None  # note survives
    assert db.get(ResearchNote, note_id).run_id is None  # link cleared
    assert db.scalar(select(func.count()).select_from(MetricPoint)) == 0
    assert db.scalar(select(func.count()).select_from(EvidenceLink)) == 0


def test_deleting_idea_nulls_note_idea_id(db_session):
    db = db_session
    project = make_project(db)
    idea, _ = make_idea_with_v1(db, project)
    db.add(ResearchNote(project_id=project.id, title="note", idea_id=idea.id))
    db.commit()

    db.delete(idea)
    db.commit()

    note = db.scalar(select(ResearchNote))
    assert note is not None
    assert note.idea_id is None
