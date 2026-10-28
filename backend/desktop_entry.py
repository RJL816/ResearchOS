"""Standalone backend entry point for the Windows desktop build.

Bundled with PyInstaller into the sidecar executable that the Electron shell
spawns (see desktop/README.md). Usage inside the packaged app:

    research-os-backend.exe --port 8123

Responsibilities before serving:
1. Resolve a portable data dir (RESEARCH_OS_DATA_DIR or ./data next to the
   executable) and point DATABASE_URL at it.
2. Run Alembic migrations to head — a fresh install starts with an empty
   SQLite file, and the packaged app has no CLI to run migrations manually.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def resolve_data_dir() -> str:
    data_dir = os.environ.get("RESEARCH_OS_DATA_DIR")
    if not data_dir:
        exe_dir = Path(sys.executable).parent
        data_dir = str(exe_dir / "data") if getattr(sys, "frozen", False) else "./"
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    return data_dir


def resolve_migrations_dir() -> str:
    if getattr(sys, "frozen", False):
        # PyInstaller bundles the alembic directory next to the runtime.
        bundled = Path(sys._MEIPASS) / "alembic"  # noqa: SLF001
        if bundled.is_dir():
            return str(bundled)
        raise RuntimeError("打包缺少 alembic 迁移目录")
    return str(Path(__file__).resolve().parent / "alembic")


def run_migrations(database_url: str) -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config()
    cfg.set_main_option("script_location", resolve_migrations_dir())
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")


def main() -> None:
    parser = argparse.ArgumentParser(description="Research OS backend sidecar")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    data_dir = resolve_data_dir()
    database_url = os.environ.get("DATABASE_URL") or f"sqlite:///{Path(data_dir) / 'research_os.db'}"
    os.environ["DATABASE_URL"] = database_url

    run_migrations(database_url)

    import uvicorn

    from app.main import app  # noqa: E402 — import after env is prepared

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
