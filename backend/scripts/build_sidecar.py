"""Bundle the backend into a single-file sidecar executable (Windows).

Run from backend/ after activating the project venv:

    .venv/Scripts/pip install pyinstaller
    .venv/Scripts/python scripts/build_sidecar.py

Output: backend/dist/sidecar/research-os-backend.exe (+ its runtime dir),
which desktop/package.json picks up via extraResources.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    dist = ROOT / "dist" / "sidecar"
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--onefile",
        "--name",
        "research-os-backend",
        "--distpath",
        str(dist),
        "--workpath",
        str(ROOT / "build" / "pyinstaller"),
        "--specpath",
        str(ROOT / "build" / "pyinstaller"),
        # the app package and its deps are collected automatically;
        # uvicorn's dynamic imports need these hidden imports:
        "--collect-all",
        "uvicorn",
        "--collect-all",
        "sqlalchemy",
        "--hidden-import",
        "uvicorn.logging",
        "--hidden-import",
        "uvicorn.loops.auto",
        "--hidden-import",
        "uvicorn.protocols.http.auto",
        str(ROOT / "desktop_entry.py"),
    ]
    print(" ".join(cmd))
    subprocess.run(cmd, check=True, cwd=str(ROOT))
    print(f"\nsidecar ready: {dist / ('research-os-backend.exe' if sys.platform == 'win32' else 'research-os-backend')}")


if __name__ == "__main__":
    main()
