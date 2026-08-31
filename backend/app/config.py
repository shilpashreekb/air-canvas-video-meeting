"""
Centralized application configuration.

All configurable values are loaded from environment variables (via a .env
file in the backend/ directory). Never hardcode secrets here — this module
only defines defaults and types; actual secret values belong in .env.
"""

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    # ============================================================
    # APPLICATION
    # ============================================================

    APP_NAME: str = "Air Canvas for Video Meetings"

    DEBUG: bool = True

    ENVIRONMENT: str = "development"


    # ============================================================
    # DATABASE
    # ============================================================

    DATABASE_URL: str = "sqlite:///./app_data.db"


    # ============================================================
    # SECURITY / JWT
    # ============================================================

    SECRET_KEY: str = "CHANGE_ME_TO_A_RANDOM_64_CHAR_HEX_STRING"

    JWT_ALGORITHM: str = "HS256"

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60


    # ============================================================
    # CORS
    # ============================================================

    # IMPORTANT:
    #
    # Frontend is currently running on port 5501.
    #
    # We allow both 5500 and 5501 so the application continues
    # working if Live Server changes ports.

    CORS_ORIGINS: str = (
        "http://localhost:5501,"
        "http://127.0.0.1:5501,"
        "http://localhost:5500,"
        "http://127.0.0.1:5500,"
        "http://localhost:8000,"
        "http://127.0.0.1:8000"
    )


    # ============================================================
    # WEBRTC
    # ============================================================

    STUN_SERVER: str = "stun:stun.l.google.com:19302"


    # ============================================================
    # PYDANTIC SETTINGS
    # ============================================================

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


    # ============================================================
    # CORS LIST
    # ============================================================

    @property
    def cors_origins_list(self) -> List[str]:

        return [
            origin.strip()
            for origin in self.CORS_ORIGINS.split(",")
            if origin.strip()
        ]


# ============================================================
# SETTINGS INSTANCE
# ============================================================

@lru_cache()
def get_settings() -> Settings:

    """
    Cached settings accessor.

    Using lru_cache means the .env file is parsed once per process
    and the same Settings instance is reused everywhere.
    """

    return Settings()


settings = get_settings()