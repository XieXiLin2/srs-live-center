"""Stream routes - list live rooms, get play URLs, manage configs."""

from __future__ import annotations

import logging
import secrets
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import srs_client
from app.auth import get_current_user, require_admin
from app.config import settings
from app.database import get_db
from app.models import StreamConfig, User
from app.schemas import (
    ChatRoomConfig,
    StreamConfigRequest,
    StreamConfigResponse,
    StreamInfo,
    StreamListResponse,
    StreamPlayRequest,
    StreamPlayResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/streams", tags=["streams"])


def _play_base() -> str:
    """Prefer `public_base_url` for constructing play URLs; otherwise use relative."""
    return settings.public_base_url.rstrip("/") if settings.public_base_url else ""


def _build_flv_url(stream_name: str, token: str = "") -> str:
    base = _play_base()
    qs = f"?{urlencode({'token': token})}" if token else ""
    return f"{base}/{settings.srs_app}/{stream_name}.flv{qs}"


def _build_whep_url(stream_name: str, token: str = "") -> str:
    base = _play_base()
    params: dict[str, str] = {"app": settings.srs_app, "stream": stream_name}
    if token:
        params["token"] = token
    return f"{base}/rtc/v1/whep/?{urlencode(params)}"


# ---------------------------------------------------------------------------
# Public listing
# ---------------------------------------------------------------------------


@router.get("/", response_model=StreamListResponse)
async def list_streams(
    db: AsyncSession = Depends(get_db),
    _user: Optional[User] = Depends(get_current_user),
) -> StreamListResponse:
    """List all configured live rooms, merged with live state from SRS."""
    # 1. All configured rooms (these are shown in the UI).
    result = await db.execute(select(StreamConfig).order_by(StreamConfig.created_at))
    configs = list(result.scalars().all())

    # 2. Currently active SRS streams (to annotate live state / codec / viewers).
    live_rows = await srs_client.list_streams()
    live_map = {row.get("name", ""): row for row in live_rows if row.get("name")}

    out: list[StreamInfo] = []
    for cfg in configs:
        live = live_map.get(cfg.stream_name)
        video = (live or {}).get("video") or {}
        audio = (live or {}).get("audio") or {}
        formats = srs_client.stream_formats(live or {}) if live else ["flv", "webrtc"]

        # Strip `webrtc` from advertised formats when disabled either globally
        # or for this specific room. Publishing via WHIP is not affected — only
        # the play-side capability list the frontend reads from here.
        room_webrtc_ok = bool(getattr(cfg, "webrtc_play_enabled", True))
        if not settings.webrtc_play_enabled or not room_webrtc_ok:
            formats = [f for f in formats if f != "webrtc"]

        out.append(
            StreamInfo(
                name=cfg.stream_name,
                display_name=cfg.display_name or cfg.stream_name,
                app=(live or {}).get("app", settings.srs_app),
                video_codec=video.get("codec") if video else None,
                audio_codec=audio.get("codec") if audio else None,
                clients=(live or {}).get("clients", cfg.viewer_count),
                is_private=cfg.is_private,
                chat_enabled=cfg.chat_enabled,
                webrtc_play_enabled=settings.webrtc_play_enabled and room_webrtc_ok,
                is_live=bool(live) or cfg.is_live,
                formats=formats,
            )
        )

    return StreamListResponse(streams=out)


# ---------------------------------------------------------------------------
# Play URL
# ---------------------------------------------------------------------------


@router.post("/play", response_model=StreamPlayResponse)
async def get_play_url(
    request: StreamPlayRequest,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_current_user),
) -> StreamPlayResponse:
    """Return a playable URL for the given stream, enforcing privacy."""
    fmt = request.format.lower()
    if fmt not in ("flv", "webrtc"):
        raise HTTPException(status_code=400, detail="Unsupported format (supported: flv, webrtc)")

    result = await db.execute(select(StreamConfig).where(StreamConfig.stream_name == request.stream_name))
    config = result.scalar_one_or_none()

    # Enforce the WebRTC-play kill switch (global + per-room).
    if fmt == "webrtc":
        if not settings.webrtc_play_enabled:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="WebRTC playback is disabled on this server",
            )
        if config is not None and not getattr(config, "webrtc_play_enabled", True):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="WebRTC playback is disabled for this room",
            )

    token_param = ""
    if config is not None and config.is_private:
        # Authorize caller: either a valid JWT user OR a matching watch_token.
        if user is None or user.is_banned:
            if not request.token or request.token != config.watch_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication or watch token required",
                )
            token_param = config.watch_token
        else:
            # Logged-in user: forward the watch_token (SRS will validate in on_play).
            token_param = config.watch_token or ""

    if fmt == "flv":
        url = _build_flv_url(request.stream_name, token_param)
    else:
        url = _build_whep_url(request.stream_name, token_param)

    return StreamPlayResponse(url=url, stream_name=request.stream_name, format=fmt)


# ---------------------------------------------------------------------------
# Chat config for the room (frontend uses this to decide UI)
# ---------------------------------------------------------------------------


@router.get("/{stream_name}/chat-config", response_model=ChatRoomConfig)
async def get_chat_config(stream_name: str, db: AsyncSession = Depends(get_db)) -> ChatRoomConfig:
    result = await db.execute(select(StreamConfig).where(StreamConfig.stream_name == stream_name))
    config = result.scalar_one_or_none()
    if config is None:
        # Room not configured — default to enabled, login required.
        return ChatRoomConfig(stream_name=stream_name, chat_enabled=True, require_login_to_send=True)
    return ChatRoomConfig(
        stream_name=stream_name,
        chat_enabled=bool(config.chat_enabled),
        require_login_to_send=True,
    )


# ---------------------------------------------------------------------------
# Admin: CRUD over StreamConfig (live rooms)
# ---------------------------------------------------------------------------


@router.get("/config", response_model=list[StreamConfigResponse])
async def list_stream_configs(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[StreamConfigResponse]:
    result = await db.execute(select(StreamConfig).order_by(StreamConfig.stream_name))
    return [StreamConfigResponse.model_validate(c) for c in result.scalars().all()]


@router.put("/config/{stream_name}", response_model=StreamConfigResponse)
async def update_stream_config(
    stream_name: str,
    request: StreamConfigRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> StreamConfigResponse:
    result = await db.execute(select(StreamConfig).where(StreamConfig.stream_name == stream_name))
    config = result.scalar_one_or_none()

    if config is None:
        config = StreamConfig(stream_name=stream_name)
        # Auto-generate secrets if absent — admin can rotate later.
        config.publish_secret = request.publish_secret or secrets.token_urlsafe(16)
        config.watch_token = request.watch_token or secrets.token_urlsafe(24)
        db.add(config)

    if request.display_name is not None:
        config.display_name = request.display_name
    if request.is_private is not None:
        config.is_private = request.is_private
    if request.publish_secret is not None:
        config.publish_secret = request.publish_secret
    if request.watch_token is not None:
        config.watch_token = request.watch_token
    if request.chat_enabled is not None:
        config.chat_enabled = request.chat_enabled
    if request.webrtc_play_enabled is not None:
        config.webrtc_play_enabled = request.webrtc_play_enabled

    await db.flush()
    await db.refresh(config)
    return StreamConfigResponse.model_validate(config)


@router.post("/config/{stream_name}/rotate-publish-secret", response_model=StreamConfigResponse)
async def rotate_publish_secret(
    stream_name: str,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> StreamConfigResponse:
    result = await db.execute(select(StreamConfig).where(StreamConfig.stream_name == stream_name))
    config = result.scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail="Stream not found")
    config.publish_secret = secrets.token_urlsafe(16)
    await db.flush()
    await db.refresh(config)
    return StreamConfigResponse.model_validate(config)


@router.post("/config/{stream_name}/rotate-watch-token", response_model=StreamConfigResponse)
async def rotate_watch_token(
    stream_name: str,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> StreamConfigResponse:
    result = await db.execute(select(StreamConfig).where(StreamConfig.stream_name == stream_name))
    config = result.scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail="Stream not found")
    config.watch_token = secrets.token_urlsafe(24)
    await db.flush()
    await db.refresh(config)
    return StreamConfigResponse.model_validate(config)


@router.delete("/config/{stream_name}")
async def delete_stream_config(
    stream_name: str,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict[str, str]:
    result = await db.execute(select(StreamConfig).where(StreamConfig.stream_name == stream_name))
    config = result.scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail="Stream config not found")
    await db.delete(config)
    return {"message": "Stream config deleted"}
