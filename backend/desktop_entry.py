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
import threading
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
    from alembic.script import ScriptDirectory
    from sqlalchemy.engine import make_url

    cfg = Config()
    cfg.set_main_option("script_location", resolve_migrations_dir())
    cfg.set_main_option("sqlalchemy.url", database_url)
    cfg.attributes["database_url"] = database_url
    url = make_url(database_url)
    if url.get_backend_name() == "sqlite" and url.database and url.database != ":memory:":
        import sqlite3
        from datetime import datetime

        path = Path(url.database).resolve()
        if path.is_file() and path.stat().st_size:
            with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as source:
                tables = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                current = {row[0] for row in source.execute("SELECT version_num FROM alembic_version")} if "alembic_version" in tables else set()
                if tables and current != {ScriptDirectory.from_config(cfg).get_current_head()}:
                    backup_dir = path.parent / "backups"
                    backup_dir.mkdir(parents=True, exist_ok=True)
                    backup_path = backup_dir / f"{path.stem}-before-upgrade-{datetime.now():%Y%m%d-%H%M%S-%f}.db"
                    with sqlite3.connect(backup_path) as target:
                        source.backup(target)
    command.upgrade(cfg, "head")


def main() -> None:
    parser = argparse.ArgumentParser(description="Research OS backend sidecar")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--monitor-parent", action="store_true")
    parser.add_argument("--parent-pid", type=int)
    args = parser.parse_args()

    parent_gone = threading.Event()
    server_holder = []
    if args.monitor_parent:
        def request_shutdown() -> None:
            parent_gone.set()
            if server_holder:
                server_holder[0].should_exit = True

        def watch_parent() -> None:
            # The desktop owns the only write end. EOF also arrives if it crashes.
            if sys.platform == "win32":
                # A blocking buffered stdin read can prevent Python shutdown
                # when the process watcher fires while the pipe remains open.
                import ctypes
                import msvcrt
                from ctypes import wintypes

                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.PeekNamedPipe.argtypes = (wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                                                 ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
                kernel.PeekNamedPipe.restype = wintypes.BOOL
                try:
                    handle = msvcrt.get_osfhandle(sys.stdin.fileno())
                    while not parent_gone.wait(0.2):
                        if not kernel.PeekNamedPipe(handle, None, 0, None, None, None):
                            request_shutdown()
                            return
                except (OSError, ValueError):
                    request_shutdown()
                return
            try:
                while sys.stdin.buffer.read(1):
                    pass
            except (OSError, ValueError):
                pass
            request_shutdown()

        threading.Thread(target=watch_parent, daemon=True, name="desktop-parent-watch").start()

        if sys.platform == "win32" and args.parent_pid:
            def watch_parent_process() -> None:
                # Wait on the original process handle; unlike polling a PID,
                # this stays correct even if Windows later reuses that PID.
                import ctypes
                from ctypes import wintypes

                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
                kernel.OpenProcess.restype = wintypes.HANDLE
                kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
                kernel.WaitForSingleObject.restype = wintypes.DWORD
                kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
                handle = kernel.OpenProcess(0x00100000, False, args.parent_pid)  # SYNCHRONIZE
                if not handle:
                    request_shutdown()
                    return
                try:
                    if kernel.WaitForSingleObject(handle, 0xFFFFFFFF) == 0:
                        request_shutdown()
                finally:
                    kernel.CloseHandle(handle)

            threading.Thread(target=watch_parent_process, daemon=True, name="desktop-process-watch").start()

    data_dir = resolve_data_dir()
    legacy_dir = os.environ.get("RESEARCH_OS_LEGACY_DATA_DIR")
    destination = Path(data_dir) / "research_os.db"
    if legacy_dir and not destination.exists() and not os.environ.get("DATABASE_URL"):
        legacy_db = Path(legacy_dir) / "research_os.db"
        if legacy_db.is_file() and legacy_db.resolve() != destination.resolve():
            # SQLite backup includes committed WAL data; leave the original intact.
            import sqlite3
            with sqlite3.connect(legacy_db.as_uri() + "?mode=ro", uri=True) as source:
                with sqlite3.connect(destination) as target:
                    source.backup(target)
    database_url = os.environ.get("DATABASE_URL") or f"sqlite:///{Path(data_dir) / 'research_os.db'}"
    os.environ["DATABASE_URL"] = database_url

    run_migrations(database_url)

    if parent_gone.is_set():
        return

    import uvicorn

    from app.main import app  # noqa: E402 — import after env is prepared

    server = uvicorn.Server(uvicorn.Config(app, host=args.host, port=args.port, log_level="warning"))
    server_holder.append(server)
    if parent_gone.is_set():
        server.should_exit = True
    server.run()


if __name__ == "__main__":
    main()
