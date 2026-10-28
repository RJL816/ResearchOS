"""Short-lived checkpoints for validated segments of interrupted evolution imports."""
from copy import deepcopy
from threading import Lock
from time import monotonic

_lock = Lock()
_reports: dict[tuple, dict] = {}
_MAX_REPORTS = 16
_TTL = 12 * 60 * 60


def _prune():
    now = monotonic()
    for key in [key for key, report in _reports.items() if now - report["updated"] > _TTL]:
        del _reports[key]


def get(key: tuple, segment: int):
    with _lock:
        _prune()
        report = _reports.get(key)
        if report:
            report["updated"] = monotonic()
            return deepcopy(report["segments"].get(segment))
        return None


def put(key: tuple, segment: int, draft: dict, warnings: list[str]):
    with _lock:
        _prune()
        if key not in _reports and len(_reports) >= _MAX_REPORTS:
            del _reports[min(_reports, key=lambda k: _reports[k]["updated"])]
        report = _reports.setdefault(key, {"segments": {}, "updated": monotonic()})
        report["segments"][segment] = (deepcopy(draft), list(warnings))
        report["updated"] = monotonic()


def clear(key: tuple):
    with _lock:
        _reports.pop(key, None)
