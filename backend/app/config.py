"""Application configuration using pydantic-settings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # App
    app_name: str = "SRS Live Center"
    app_secret_key: str = "change-me-in-production"
    debug: bool = False
    allowed_origins: str = "http://localhost:5173"

    # ------------------------------------------------------------------
    # Branding (overridable from the admin UI).
    #
    # These values are the *initial* defaults. Once an admin edits them via
    # ``PUT /api/admin/settings/branding`` they are persisted in the
    # ``app_settings`` table and take precedence over these defaults. We keep
    # env-var defaults so a fresh container boots with sensible branding.
    # ------------------------------------------------------------------
    site_name: str = "SRS Live Center"
    site_logo_url: str = ""
    site_copyright: str = "© {year} SRS Live Center. All rights reserved."

    # Public base URL — what the end user / browser sees (Nginx front-facing).
    # Used to construct play URLs for FLV / WebRTC WHEP.
    # Example: https://live.example.com
    public_base_url: str = ""

    # Publish base URL — where OBS / ffmpeg pushes streams to.
    # Often different from ``public_base_url`` when a CDN fronts playback but
    # publishing must go directly to the origin (or a dedicated push domain).
    # Expected to be a bare host (``push.example.com``) or ``scheme://host[:port]``.
    # When empty the backend falls back to ``public_base_url``.
    #
    # The backend only uses this to render RTMP / SRT / WHIP URLs shown to the
    # streamer in the admin UI; it does not proxy any traffic.
    publish_base_url: str = ""

    # Ports advertised for RTMP / SRT publish URLs in the admin UI.
    publish_rtmp_port: int = 1935
    publish_srt_port: int = 10080

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

    # WebRTC UDP port for media transport.
    # This is the port SRS listens on for WebRTC media (RTP/RTCP) over UDP.
    # Must match the port configured in SRS rtc_server.listen.
    # Default: 8000
    webrtc_udp_port: int = 8000

    # WebRTC TCP port for media transport (optional).
    # Only used when webrtc_protocol is "tcp" or "all".
    # If empty, defaults to the same value as webrtc_udp_port.
    # Must match the port configured in SRS rtc_server.tcp.
    webrtc_tcp_port: int = 0

    # WebRTC IP family: ipv4, ipv6, or all (both ipv4 and ipv6)
    # Default: ipv4
    webrtc_ip_family: str = "ipv4"

    # WebRTC protocol: udp, tcp, or all (udp,tcp)
    # Default: udp
    webrtc_protocol: str = "udp"

    # ------------------------------------------------------------------
    # Offline placeholder (image or video shown when stream is offline).
    #
    # Global default URL for placeholder content (image or video) displayed
    # when a stream is not live. Can be overridden per-stream in StreamConfig.
    # Supports:
    #   - Image URLs (jpg, png, gif, etc.)
    #   - Video URLs (mp4, webm, etc.)
    # ------------------------------------------------------------------
    offline_placeholder_url: str = ""

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
