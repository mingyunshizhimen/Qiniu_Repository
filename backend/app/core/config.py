from functools import lru_cache
from typing import Literal

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "qiniu-ai-interpreter"
    app_version: str = "0.1.0"
    dashscope_api_key: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @computed_field
    @property
    def ai_provider(self) -> Literal["dashscope", "mock"]:
        return "dashscope" if self.dashscope_api_key else "mock"


@lru_cache
def get_settings() -> Settings:
    return Settings()
