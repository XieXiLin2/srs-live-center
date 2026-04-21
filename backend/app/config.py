"""Application configuration using pydantic-settings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # App
    app_name: str = "SRS Live Center"
    app_secret_key: str = "change-me-in-production"
    debug: bool = False
    allowed_origins: str = "http://localhost:5173"

    # Public base URL — what the end user / browser sees (Nginx front-facing).
    # Used to construct play URLs for FLV / WebRTC WHEP.
    # Example: https://live.example.com
    public_base_url: str = ""

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
    oauth2_admin_group: str = "srs-admin"

    # ------------------------------------------------------------------
    # SRS 6 configuration (direct integration, no Oryx).
    # ------------------------------------------------------------------
    # Internal HTTP endpoint of the SRS "HTTP server" (HTTP-FLV).
    # Default SRS port is 8080.
    srs_http_url: str = "http://srs:8080"

    # Internal HTTP endpoint of the SRS HTTP API (for stream / client query).
    # Default SRS API port is 1985.
    srs_api_url: str = "http://srs:1985"

    # Default application name used by clients pushing/pulling streams.
    srs_app: str = "live"

    # ------------------------------------------------------------------
    # WebRTC playback (WHEP) global kill-switch.
    #
    # When ``False``:
    #   * The `/api/streams/` listing never advertises `webrtc` as a playable
    #     format, so the frontend player won't offer it.
    #   * `/api/streams/play` rejects `format=webrtc` with HTTP 403.
    #   * SRS can still accept **WebRTC publish (WHIP)** — only playback is
    #     blocked, not pushing.
    #
    # Individual rooms can additionally disable WebRTC via
    # ``StreamConfig.webrtc_play_enabled`` regardless of this flag; the global
    # flag is the override at the top of that hierarchy.
    # ------------------------------------------------------------------
    webrtc_play_enabled: bool = True

    # Optional shared secret for SRS http_hooks callbacks.
    # If set, SRS must include it in the callback URL (e.g. as ?hook_secret=xxx)
    # so that the backend can verify callbacks are coming from SRS, not forged.
    srs_hook_secret: str = ""

    # ------------------------------------------------------------------
    # JWT
    # ------------------------------------------------------------------
    jwt_secret: str = "change-me-jwt-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24 hours for login JWT

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
    }


settings = Settings()
