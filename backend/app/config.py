"""Application configuration using pydantic-settings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # App
    app_name: str = "Oryx Live Center"
    app_secret_key: str = "change-me-in-production"
    debug: bool = False
    allowed_origins: str = "http://localhost:5173"

    # Database
    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    # Redis (for chat/danmaku)
    redis_url: str = "redis://localhost:6379/0"

    # OAuth2 / Authentik
    oauth2_client_id: str = ""
    oauth2_client_secret: str = ""
    oauth2_authorize_url: str = ""
    oauth2_token_url: str = ""
    oauth2_userinfo_url: str = ""
    oauth2_logout_url: str = ""
    oauth2_redirect_uri: str = "http://localhost:5173/auth/callback"
    oauth2_scope: str = "openid profile email"
    oauth2_admin_group: str = "oryx-admin"

    # Oryx (all-in-one, port 2022 is the main entry)
    oryx_api_url: str = "http://localhost:2022"
    oryx_api_secret: str = ""  # Auto-populated at startup via login
    oryx_mgmt_password: str = ""  # Oryx MGMT_PASSWORD for auto-login
    oryx_http_url: str = "http://localhost:2022"

    # CDN
    cdn_base_url: str = ""
    cdn_pull_secret: str = ""

    # JWT
    jwt_secret: str = "change-me-jwt-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24 hours

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
    }


settings = Settings()
