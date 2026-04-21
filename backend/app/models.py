"""Database models."""

import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    """User model - stores OAuth2 user info."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    oauth_sub: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(255), index=True)
    display_name: Mapped[str] = mapped_column(String(255), default="")
    email: Mapped[str] = mapped_column(String(255), default="")
    avatar_url: Mapped[str] = mapped_column(String(1024), default="")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ChatMessage(Base):
    """Chat/Danmaku message model."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(index=True)
    username: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(255), default="")
    content: Mapped[str] = mapped_column(Text)
    stream_name: Mapped[str] = mapped_column(String(255), index=True, default="")
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StreamConfig(Base):
    """Live room configuration.

    Each row represents a single live room / channel. Multiple rooms can exist
    and be played concurrently. The `stream_name` is the unique stream key
    (e.g. path segment after /live/).
    """

    __tablename__ = "stream_configs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    stream_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255), default="")

    # Privacy: when True the stream requires either a logged-in user OR a valid
    # watch token to play. When False it is freely accessible.
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)

    # Per-room publish (push) secret. SRS `on_publish` callback verifies
    # the publisher's URL query param against this value.
    publish_secret: Mapped[str] = mapped_column(String(255), default="")

    # Permanent watch token for private streams. Admins may rotate it manually.
    # Anyone holding this token can watch the private stream without logging in.
    watch_token: Mapped[str] = mapped_column(String(255), default="")

    # Chat / danmaku switch for this room.
    chat_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # Per-room WebRTC (WHEP) playback toggle.
    # When False this room refuses WebRTC play requests even if the global
    # ``settings.webrtc_play_enabled`` is True. WHIP publish is unaffected.
    webrtc_play_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # ---- Live state / statistics (updated via SRS hooks) ----
    is_live: Mapped[bool] = mapped_column(Boolean, default=False)
    viewer_count: Mapped[int] = mapped_column(Integer, default=0)
    total_play_count: Mapped[int] = mapped_column(Integer, default=0)
    last_publish_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_unpublish_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StreamPlaySession(Base):
    """A single viewer play session, tracked via SRS on_play/on_stop hooks."""

    __tablename__ = "stream_play_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # SRS client ID (from on_play payload) — used to correlate on_stop.
    srs_client_id: Mapped[str] = mapped_column(String(128), index=True, default="")
    stream_name: Mapped[str] = mapped_column(String(255), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    client_ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(512), default="")
    started_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)


class StreamPublishSession(Base):
    """A single publish session (publisher goes online → offline)."""

    __tablename__ = "stream_publish_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    srs_client_id: Mapped[str] = mapped_column(String(128), index=True, default="")
    stream_name: Mapped[str] = mapped_column(String(255), index=True)
    client_ip: Mapped[str] = mapped_column(String(64), default="")
    started_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
