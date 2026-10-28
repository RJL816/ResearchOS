"""Reserved extension point for experiment-file importers (Phase 2+).

Future parsers (CSV metrics, JSON logs, TensorBoard event files, ...) should
convert their source into a RunImportPayload and call import_run(); the
(project, external_source, external_key) unique constraint makes repeated
imports idempotent — no duplicate runs, metrics get upserted, run ids stay
stable.
"""

from __future__ import annotations

from pydantic import Field
from sqlalchemy.orm import Session

from .. import schemas, services
from ..models import ExperimentRun


class RunImportPayload(schemas.RunCreate):
    """One normalized import unit: an external run plus its metric points.

    Unlike manual run creation, both external fields are required — they are
    the idempotency anchor (e.g. source="csv", key="<abs path>#<run name>").
    """

    external_source: str = Field(min_length=1, max_length=50)
    external_key: str = Field(min_length=1, max_length=200)
    metrics: list[schemas.MetricPointCreate] = []


def import_run(
    db: Session, project_id: int, payload: RunImportPayload
) -> tuple[ExperimentRun, int, int]:
    """Create or update the run, then upsert its metrics. Safe to re-run."""
    run, _created = services.upsert_run(db, project_id, payload)
    inserted, updated = services.upsert_metrics(db, run.id, payload.metrics)
    return run, inserted, updated
