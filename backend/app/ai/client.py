"""Thin GLM chat-completions client.

The runtime credential (GLM_API_KEY) belongs to the Research OS application's
own plan/quota and is configured per deployment via environment — it is never
shared with or derived from any coding-agent subscription.
"""

from __future__ import annotations

import httpx

from ..config import get_settings


class GlmError(RuntimeError):
    """Raised when the GLM API call fails (network, HTTP, timeout, empty body)."""


class GlmNotConfigured(RuntimeError):
    """Raised when GLM_API_KEY is not configured for this deployment."""


class GlmClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None, model: str | None = None, timeout: float | None = None):
        settings = get_settings()
        self.api_key = api_key if api_key is not None else settings.glm_api_key
        if not self.api_key:
            raise GlmNotConfigured(
                "尚未配置 LLM API 密钥，请在设置中填写模型配置。"
            )
        self.base_url = (base_url or settings.glm_base_url).rstrip("/")
        self.model = model or settings.glm_model
        self.timeout = timeout or settings.glm_timeout_seconds

    def chat(self, system: str, user: str, temperature: float = 0.2) -> str:
        if not self.api_key:
            raise GlmNotConfigured(
                "尚未配置 LLM API 密钥，请在设置中填写模型配置。"
            )
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
        }
        try:
            response = httpx.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
                timeout=self.timeout,
                trust_env=False,
            )
        except httpx.TimeoutException as exc:
            raise GlmError(f"LLM 请求超时（>{self.timeout}s）：{exc}") from exc
        except httpx.HTTPError as exc:
            raise GlmError(f"LLM 请求失败：{exc}") from exc
        if response.status_code != 200:
            raise GlmError(f"LLM 返回 HTTP {response.status_code}: {response.text[:300]}")
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError, ValueError) as exc:
            raise GlmError(f"LLM 响应格式异常：{response.text[:300]}") from exc
        if not isinstance(content, str) or not content.strip():
            raise GlmError("LLM 返回了空内容")
        return content


def configure_runtime_model(api_key: str, base_url: str, model: str) -> None:
    from .secret_store import save_config, load_config
    api_key = api_key or load_config().get("api_key") or get_settings().glm_api_key
    if not api_key:
        raise GlmNotConfigured("请填写模型 API 密钥")
    save_config({"api_key": api_key, "base_url": base_url, "model": model})


def runtime_model_status() -> dict:
    from .secret_store import load_config
    config = load_config()
    settings = get_settings()
    return {"configured": bool(config.get("api_key") or settings.glm_api_key),
            "base_url": config.get("base_url") or settings.glm_base_url,
            "model": config.get("model") or settings.glm_model,
            "temporary": False, "persisted": bool(config)}


def get_glm_client() -> GlmClient:
    from .secret_store import load_config
    return GlmClient(**load_config())
