from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Values can be overridden via environment or .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Research OS API"
    database_url: str = "sqlite:///./research_os.db"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,app://research-os.local"

    # GLM runtime credentials — the APPLICATION's own key/plan, entirely
    # separate from any coding-agent subscription used during development.
    # The explicit alias means these are ONLY read from RESEARCH_OS_GLM_*
    # env vars or backend/.env — a coding agent's GLM_API_KEY / ZAI_* in the
    # shell can never be silently picked up by this app.
    glm_api_key: str = Field(default="", validation_alias="RESEARCH_OS_GLM_API_KEY")
    glm_base_url: str = Field(
        default="https://open.bigmodel.cn/api/paas/v4",
        validation_alias="RESEARCH_OS_GLM_BASE_URL",
    )
    glm_model: str = Field(default="glm-4-flash", validation_alias="RESEARCH_OS_GLM_MODEL")
    glm_timeout_seconds: float = Field(default=60.0, validation_alias="RESEARCH_OS_GLM_TIMEOUT_SECONDS")
    glm_json_parse_retries: int = Field(default=2, validation_alias="RESEARCH_OS_GLM_JSON_PARSE_RETRIES")

    # Conversation import limits (configurable; oversize input is rejected,
    # never silently truncated into the LLM).
    conversation_max_chars: int = 200_000
    conversation_max_file_bytes: int = 2_000_000
    conversation_max_messages: int = 500
    segment_max_chars: int = 12_000

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
