from collections.abc import Iterator

from sqlalchemy import MetaData, create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

# Stable constraint names so future SQLite migrations (batch mode) can target them.
convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=convention)


def configure_sqlite(engine: Engine) -> None:
    """SQLite ignores FK constraints unless enabled per connection; WAL improves robustness."""

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        database = engine.url.database
        if database and database != ":memory:":
            cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


def create_app_engine() -> Engine:
    settings = get_settings()
    url = settings.database_url
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False} if url.startswith("sqlite") else {},
    )
    if engine.dialect.name == "sqlite":
        configure_sqlite(engine)
    return engine


engine = create_app_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
