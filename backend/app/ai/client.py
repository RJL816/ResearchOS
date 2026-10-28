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
                "GLM 运行时凭证未配置：请在 backend/.env 设置 RESEARCH_OS_GLM_API_KEY"
                "（应用自己的 GLM 凭证，与开发所用 Coding Agent 套餐相互独立、不共享额度）"
            )
        self.base_url = (base_url or settings.glm_base_url).rstrip("/")
        self.model = model or settings.glm_model
        self.timeout = timeout or settings.glm_timeout_seconds

    def chat(self, system: str, user: str, temperature: float = 0.2) -> str:
        if not self.api_key:
            raise GlmNotConfigured(
                "GLM_API_KEY 未配置：请在 backend/.env 设置应用运行时自己的 GLM 凭证"
                "（与开发所用 Coding Agent 套餐相互独立）"
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
            raise GlmError(f"GLM 请求超时（>{self.timeout}s）：{exc}") from exc
        except httpx.HTTPError as exc:
            raise GlmError(f"GLM 请求失败：{exc}") from exc
        if response.status_code != 200:
            raise GlmError(f"GLM 返回 HTTP {response.status_code}: {response.text[:300]}")
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError, ValueError) as exc:
            raise GlmError(f"GLM 响应格式异常：{response.text[:300]}") from exc
        if not isinstance(content, str) or not content.strip():
            raise GlmError("GLM 返回了空内容")
        return content


def get_glm_client() -> GlmClient:
    """Factory hook; tests monkeypatch this to inject a mock client."""
    return GlmClient()
