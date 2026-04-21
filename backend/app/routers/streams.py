"""Stream routes - list live rooms, get play URLs, manage configs."""

from __future__ import annotations

import logging
import secrets
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import status as _status  # noqa: F401

from sqlalchemy import func

from app import srs_client
from app.auth import get_current_user, require_admin
from app.config import settings
from app.database import get_db
from app.models import StreamConfig, StreamPublishSession, User, ViewerSession
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

    # 2. Currently active SRS streams — ONLY used for liveness + codec info.
    #    Viewer counts / total play counts / durations are owned by the backend
    #    (via hooks + reconciler) so they stay accurate across SRS restarts and
    #    dropped hook callbacks.
    live_rows = await srs_client.list_streams()
    live_map = {row.get("name", ""): row for row in live_rows if row.get("name")}

    # 3. Backend-owned viewer counts: count currently-open viewer WS sessions
    #    per stream. These sessions are maintained entirely by the backend
    #    (see routers/viewer.py) and do NOT rely on SRS `on_play`/`on_stop`.
    viewer_q = await db.execute(
        select(ViewerSession.stream_name, func.count(ViewerSession.id))
        .where(ViewerSession.ended_at.is_(None))
        .group_by(ViewerSession.stream_name)
    )
    open_viewer_map: dict[str, int] = {name: cnt for name, cnt in viewer_q.all()}

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

        # SRS-authoritative liveness; fall back to DB only when SRS is unreachable.
        is_live = bool(live) if live_rows is not None else cfg.is_live

        # Our own viewer count (does NOT come from SRS).
        # If the stream went offline, force viewer_count to 0 to avoid ghost
        # counts lingering until the reconciler runs.
        viewer_count = open_viewer_map.get(cfg.stream_name, 0) if is_live else 0

        out.append(
            StreamInfo(
                name=cfg.stream_name,
                display_name=cfg.display_name or cfg.stream_name,
                app=(live or {}).get("app", settings.srs_app),
                video_codec=video.get("codec") if video else None,
                audio_codec=audio.get("codec") if audio else None,
                clients=viewer_count,
                is_private=cfg.is_private,
                chat_enabled=cfg.chat_enabled,
                webrtc_play_enabled=settings.webrtc_play_enabled and room_webrtc_ok,
                is_live=is_live,
                formats=formats,
            )
        )

    return StreamListResponse(streams=out)


# ---------------------------------------------------------------------------
# Per-stream aggregated statistics (DB-owned)
# ---------------------------------------------------------------------------


@router.get("/{stream_name}/stats")
async def get_stream_stats(
    stream_name: str,
    db: AsyncSession = Depends(get_db),
    _user: Optional[User] = Depends(get_current_user),
) -> dict:
    """Aggregate statistics for one stream, all computed by the backend.

    Playback-side metrics (viewers / plays / watch time) come exclusively from
    ``ViewerSession`` rows — i.e. from the WebSocket-driven viewer tracker
    defined in :mod:`app.routers.viewer`. SRS `on_play` / `on_stop` are
    **not** used as a source of truth here.

    Publish-side metrics still come from ``StreamPublishSession`` (which is
    populated via SRS publish hooks, the one thing only the media server can
    authoritatively observe).
    """
    result = await db.execute(select(StreamConfig).where(StreamConfig.stream_name == stream_name))
    cfg = result.scalar_one_or_none()
    if cfg is None:
        raise HTTPException(status_code=404, detail="Stream not configured")

    # Current viewers = open ViewerSession rows for this stream (WS-driven).
    current_q = await db.execute(
        select(func.count(ViewerSession.id))
        .where(ViewerSession.stream_name == stream_name)
        .where(ViewerSession.ended_at.is_(None))
    )
    current_viewers: int = current_q.scalar() or 0

    # Lifetime totals.
    total_plays_q = await db.execute(
        select(func.count(ViewerSession.id))
        .where(ViewerSession.stream_name == stream_name)
    )
    total_plays: int = total_plays_q.scalar() or 0

    # Closed sessions contribute their stored duration; open sessions are
    # extrapolated to (now - started_at) so the total doesn't appear frozen
    # while a viewer is still watching.
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc)

    closed_sum_q = await db.execute(
        select(func.coalesce(func.sum(ViewerSession.duration_seconds), 0))
        .where(ViewerSession.stream_name == stream_name)
        .where(ViewerSession.ended_at.is_not(None))
    )
    closed_watch = int(closed_sum_q.scalar() or 0)

    open_q = await db.execute(
        select(ViewerSession.started_at)
        .where(ViewerSession.stream_name == stream_name)
        .where(ViewerSession.ended_at.is_(None))
    )
    live_watch = 0
    for (started,) in open_q.all():
        if started is None:
            continue
        if started.tzinfo is None:
            started = started.replace(tzinfo=_dt.timezone.utc)
        live_watch += max(0, int((now - started).total_seconds()))
    total_watch_seconds: int = closed_watch + live_watch

    unique_viewers_q = await db.execute(
        select(func.count(func.distinct(ViewerSession.user_id)))
        .where(ViewerSession.stream_name == stream_name)
        .where(ViewerSession.user_id.is_not(None))
    )
    unique_logged_in_viewers: int = int(unique_viewers_q.scalar() or 0)

    # Active publish session (if any), used to report "live since ...".
    pub_q = await db.execute(
        select(StreamPublishSession)
        .where(StreamPublishSession.stream_name == stream_name)
        .where(StreamPublishSession.ended_at.is_(None))
        .order_by(StreamPublishSession.started_at.desc())
    )
    active_pub = pub_q.scalars().first()

    # Peak concurrent viewers in the current live session:
    # - while live: max(in-memory WS peak, current_viewers)
    # - when offline: 0 (reset by reconciler).
    peak_concurrent: int = 0
    if active_pub is not None:
        try:
            from app.routers.viewer import manager as _viewer_manager

            peak_concurrent = max(
                _viewer_manager.peak_viewers(stream_name), current_viewers
            )
        except Exception:
            peak_concurrent = current_viewers

    # Consult SRS only for the "is actually publishing right now" bit.
    live_rows = await srs_client.list_streams()
    is_live = any(r.get("name") == stream_name for r in live_rows)

    # Current session duration ("已开播时长"): how long the *current* broadcast
    # has been running. 0 when offline.
    current_live_duration_seconds = 0
    if active_pub is not None and active_pub.started_at is not None:
        # Normalize tz-naive SQLite rows (SQLite stores as naive UTC).
        started = active_pub.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=_dt.timezone.utc)
        current_live_duration_seconds = max(0, int((now - started).total_seconds()))

    # Lifetime broadcast time — all completed publish sessions plus current one.
    total_live_q = await db.execute(
        select(func.coalesce(func.sum(StreamPublishSession.duration_seconds), 0))
        .where(StreamPublishSession.stream_name == stream_name)
    )
    total_live_seconds = int(total_live_q.scalar() or 0) + current_live_duration_seconds

    return {
        "stream_name": stream_name,
        "display_name": cfg.display_name or stream_name,
        "is_live": is_live,
        "current_viewers": current_viewers,
        "total_plays": total_plays,
        "total_watch_seconds": total_watch_seconds,
        "unique_logged_in_viewers": unique_logged_in_viewers,
        "peak_session_viewers": peak_concurrent,
        # How long the *current* broadcast has been live (0 if offline).
        "current_live_duration_seconds": current_live_duration_seconds,
        # Total lifetime broadcast seconds (sum of all publish sessions).
        "total_live_seconds": total_live_seconds,
        "last_publish_at": cfg.last_publish_at.isoformat() if cfg.last_publish_at else None,
        "last_unpublish_at": cfg.last_unpublish_at.isoformat() if cfg.last_unpublish_at else None,
        "current_session_started_at": active_pub.started_at.isoformat() if active_pub else None,
    }


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
    """List all stream configs.

    The DB-stored ``viewer_count`` / ``total_play_count`` columns are legacy
    fields fed by the old SRS-hook flow. To stay consistent with the new
    WS-driven analytics (see ``routers/viewer.py``) we **override** them on
    the way out using live aggregations over ``ViewerSession``:

    * ``viewer_count``     ← currently-open viewer sessions per stream
    * ``total_play_count`` ← lifetime ``ViewerSession`` rows per stream
    """
    result = await db.execute(select(StreamConfig).order_by(StreamConfig.stream_name))
    configs = list(result.scalars().all())

    # Single roundtrip each — much cheaper than per-row subqueries.
    open_q = await db.execute(
        select(ViewerSession.stream_name, func.count(ViewerSession.id))
        .where(ViewerSession.ended_at.is_(None))
        .group_by(ViewerSession.stream_name)
    )
    open_map: dict[str, int] = {name: int(cnt) for name, cnt in open_q.all()}

    total_q = await db.execute(
        select(ViewerSession.stream_name, func.count(ViewerSession.id))
        .group_by(ViewerSession.stream_name)
    )
    total_map: dict[str, int] = {name: int(cnt) for name, cnt in total_q.all()}

    out: list[StreamConfigResponse] = []
    for c in configs:
        item = StreamConfigResponse.model_validate(c)
        item.viewer_count = open_map.get(c.stream_name, 0)
        item.total_play_count = total_map.get(c.stream_name, item.total_play_count)
        out.append(item)
    return out


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
