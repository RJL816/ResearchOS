"""Standalone backend entry point for the Windows desktop build.

Bundled with PyInstaller into the sidecar executable that the Electron shell
spawns (see desktop/README.md). Usage inside the packaged app:

    research-os-backend.exe --port 8123

The SQLite database lives next to the executable (app data dir is created by
the shell via RESEARCH_OS_DATA_DIR).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Research OS backend sidecar")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    # Keep the database portable: default to a data dir next to the executable
    # unless the shell provides an explicit location.
    data_dir = os.environ.get("RESEARCH_OS_DATA_DIR")
    if not data_dir:
        exe_dir = Path(sys.executable).parent
        data_dir = str(exe_dir / "data") if getattr(sys, "frozen", False) else "./"
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(data_dir) / 'research_os.db'}")

    import uvicorn

    from app.main import app  # noqa: E402 — import after env is prepared

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
