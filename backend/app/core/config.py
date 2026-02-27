from __future__ import annotations

import os
from functools import lru_cache


class Settings:
    """Application configuration exposed via lazy singleton."""

    def __init__(self) -> None:
        default_db = "sqlite:///./dev.db"
        self.database_url = os.getenv("DATABASE_URL", default_db)
        self.test_database_url = os.getenv("TEST_DATABASE_URL")
        self.app_name = "SMU Investment Game"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
