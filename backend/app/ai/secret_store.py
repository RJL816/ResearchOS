"""Persist model configuration encrypted for the current Windows user."""
from __future__ import annotations
import ctypes
import json
import os
import sys
import tempfile
from pathlib import Path
from ctypes import wintypes

class Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

def _protect(data: bytes, decrypt: bool = False) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("当前系统不支持安全保存，请通过环境变量配置模型密钥")
    raw = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source, output = Blob(len(data), raw), Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel.LocalFree.restype = wintypes.HLOCAL
    if decrypt:
        fn = crypt.CryptUnprotectData
        fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        ok = fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output))
    else:
        fn = crypt.CryptProtectData
        fn.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        ok = fn(ctypes.byref(source), "Research OS model configuration", None, None, None, 1, ctypes.byref(output))
    if not ok:
        raise RuntimeError("系统无法安全保存或读取模型配置")
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel.LocalFree(output.pbData)

def config_path() -> Path:
    return Path(os.environ.get("RESEARCH_OS_DATA_DIR") or ".") / "model-config.dpapi"

def save_config(config: dict[str, str]) -> None:
    encrypted = _protect(json.dumps(config, ensure_ascii=False).encode("utf-8"))
    path = config_path(); path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".model-config-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(encrypted); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def load_config() -> dict[str, str]:
    path = config_path()
    if not path.is_file(): return {}
    try:
        data = json.loads(_protect(path.read_bytes(), decrypt=True).decode("utf-8"))
        if not isinstance(data, dict) or any(not isinstance(data.get(k), str) or not data[k] for k in ("api_key", "base_url", "model")):
            raise ValueError("invalid config")
        return {k:data[k] for k in ("api_key", "base_url", "model")}
    except (OSError, ValueError, UnicodeError, RuntimeError) as exc:
        raise RuntimeError("无法读取已保存的模型配置，请重新填写") from exc
