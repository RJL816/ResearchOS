"""The desktop-owned service must stop when its owner closes the pipe."""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import pytest

def test_desktop_service_stops_when_parent_pipe_closes(tmp_path):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    root = Path(__file__).resolve().parents[1]
    env = {**os.environ, "DATABASE_URL": "sqlite:///" + str(tmp_path / "lifecycle.db")}
    process = subprocess.Popen(
        [sys.executable, "desktop_entry.py", "--port", str(port), "--monitor-parent"],
        cwd=root, env=env, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AssertionError("service exited during startup")
            try:
                with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5) as response:
                    assert response.status == 200
                    break
            except (URLError, TimeoutError):
                time.sleep(0.1)
        else:
            raise AssertionError("service did not start")
        process.stdin.close()
        assert process.wait(timeout=10) == 0
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", port))
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows process handle watcher")
def test_service_stops_after_desktop_crash_even_if_pipe_is_open(tmp_path):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    env = {**os.environ, "DATABASE_URL": "sqlite:///" + str(tmp_path / "crash.db")}
    process = subprocess.Popen(
        [sys.executable, "desktop_entry.py", "--port", str(port), "--monitor-parent", "--parent-pid", str(parent.pid)],
        cwd=Path(__file__).resolve().parents[1], env=env, stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AssertionError("service exited during startup")
            try:
                with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5):
                    break
            except (URLError, TimeoutError):
                time.sleep(0.1)
        else:
            raise AssertionError("service did not start")
        parent.kill()
        parent.wait(timeout=5)
        # Keep the write end open: the process watcher, not EOF, must stop it.
        assert process.wait(timeout=10) == 0
    finally:
        process.stdin.close()
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        if parent.poll() is None:
            parent.kill()
            parent.wait(timeout=5)
