"""Importer contract tests: the reserved Phase-2 extension point.

These tests pin the guarantees future CSV / TensorBoard parsers rely on:
re-importing the same external run never duplicates data.
"""

from app.importers.base import RunImportPayload, import_run
from app.models import ExperimentRun, MetricPoint, Project
from app.schemas import MetricPointCreate
from sqlalchemy import func, select


def make_payload(key="tmux://gpu-3/exp-42"):
    return RunImportPayload(
        name="exp-42",
        external_source="csv",
        external_key=key,
        status="succeeded",
        git_commit="9f2c1ab",
        dataset="natural-instructions",
        eval_protocol="MMLU 5-shot",
        params={"lr": 2e-4, "rank": 16},
        metrics=[
            {"name": "train/loss", "step": 0, "value": 2.31},
            {"name": "train/loss", "step": 1, "value": 1.87},
            {"name": "eval/acc", "step": 1, "value": 0.41},
        ],
    )


def test_import_twice_is_idempotent(db_session):
    db = db_session
    project = Project(name="import-project")
    db.add(project)
    db.commit()

    run1, ins1, upd1 = import_run(db, project.id, make_payload())
    run2, ins2, upd2 = import_run(db, project.id, make_payload())

    assert run1.id == run2.id  # same run row
    assert (ins1, upd1) == (3, 0)
    assert (ins2, upd2) == (0, 3)  # all points upserted, none inserted
    assert db.scalar(select(func.count()).select_from(ExperimentRun)) == 1
    assert db.scalar(select(func.count()).select_from(MetricPoint)) == 3


def test_reimport_with_new_values_updates_in_place(db_session):
    db = db_session
    db.add(Project(name="import-project-2"))
    db.commit()
    project_id = 1

    import_run(db, project_id, make_payload())
    payload = make_payload()
    payload.metrics[1].value = 1.55  # late-arriving correction from the source file
    payload.metrics.append(
        MetricPointCreate(name="train/loss", step=2, value=1.40)
    )
    run, inserted, updated = import_run(db, project_id, payload)

    assert (inserted, updated) == (1, 3)
    point = db.scalar(select(MetricPoint).where(MetricPoint.run_id == run.id, MetricPoint.step == 1))
    assert point.value == 1.55
    assert db.scalar(select(func.count()).select_from(MetricPoint)) == 4


def test_same_key_in_different_projects_is_separate(db_session):
    db = db_session
    p1 = Project(name="p-one")
    p2 = Project(name="p-two")
    db.add_all([p1, p2])
    db.commit()

    run1, _, _ = import_run(db, p1.id, make_payload("shared-key"))
    run2, _, _ = import_run(db, p2.id, make_payload("shared-key"))
    assert run1.id != run2.id
