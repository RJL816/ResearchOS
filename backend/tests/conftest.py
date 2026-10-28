import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, configure_sqlite, get_db
from app.main import app


@pytest.fixture()
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    configure_sqlite(engine)  # FK enforcement ON, like production
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(engine):
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestingSessionLocal()
    yield session
    session.rollback()
    session.close()


@pytest.fixture()
def client(engine):
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
