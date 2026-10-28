from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC timestamp — the storage convention for every datetime column."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
