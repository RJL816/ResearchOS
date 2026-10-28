"""Thread-local progress reporting for synchronous parsing routines."""
from contextlib import contextmanager
from threading import local

_local = local()


@contextmanager
def observe(callback):
    old = getattr(_local, "callback", None)
    _local.callback = callback
    try:
        yield
    finally:
        _local.callback = old


def report(completed: int, total: int, stage: str) -> None:
    callback = getattr(_local, "callback", None)
    if callback:
        callback(completed, total, stage)
