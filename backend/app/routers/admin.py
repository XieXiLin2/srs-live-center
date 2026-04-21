"""Admin routes - user management, SRS status, live session statistics."""

from __future__ import annotations

import csv
import datetime as dt
import io
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import srs_client
from app.auth import require_admin
from app.config import settings
from app.database import get_db
from app.models import (
    ChatMessage,
    StreamPlaySession,
    StreamPublishSession,
    User,
    ViewerSession,
)
from app.schemas import (
    StreamPlaySessionResponse,
    StreamPublishSessionResponse,
    UserBanRequest,
    UserListResponse,
    UserResponse,
    ViewerSessionListResponse,
    ViewerSessionResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


# ===========================================================================
# User management
# ===========================================================================


@router.get("/users", response_model=UserListResponse)
async def list_users(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserListResponse:
    query = select(User)
    count_query = select(func.count()).select_from(User)

    if search:
        like = f"%{search}%"
        cond = User.username.ilike(like) | User.display_name.ilike(like)
        query = query.where(cond)
        count_query = count_query.where(cond)

    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    result = await db.execute(query.order_by(User.created_at.desc()).offset(offset).limit(limit))
    users = result.scalars().all()

    return UserListResponse(
        users=[UserResponse.model_validate(u) for u in users],
        total=total,
    )


@router.put("/users/{user_id}/ban")
async def ban_user(
    user_id: int,
    request: UserBanRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, str]:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot ban yourself")

    user.is_banned = request.is_banned
    await db.flush()
    return {"message": f"User {'banned' if request.is_banned else 'unbanned'}"}


@router.delete("/chat/messages/{message_id}")
async def delete_chat_message(
    message_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict[str, str]:
    result = await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))
    msg = result.scalar_one_or_none()
    if msg is None:
        raise HTTPException(status_code=404, detail="Message not found")
    await db.delete(msg)
    return {"message": "Chat message deleted"}


# ===========================================================================
# SRS System Info
# ===========================================================================


@router.get("/srs/summary")
async def get_srs_summary(_admin: User = Depends(require_admin)) -> dict:
    return await srs_client.get_summary()


@router.get("/srs/versions")
async def get_srs_versions(_admin: User = Depends(require_admin)) -> dict:
    return await srs_client.get_versions()


@router.get("/srs/streams")
async def get_srs_streams(_admin: User = Depends(require_admin)) -> dict:
    return {"streams": await srs_client.list_streams()}


@router.get("/srs/clients")
async def get_srs_clients(_admin: User = Depends(require_admin)) -> dict:
    return {"clients": await srs_client.list_clients()}


@router.delete("/srs/clients/{client_id}")
async def kick_srs_client(client_id: str, _admin: User = Depends(require_admin)) -> dict:
    try:
        return await srs_client.kick_client(client_id)
    except srs_client.SRSAPIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


# ===========================================================================
# Play / Publish statistics
# ===========================================================================


@router.get("/stats/play-sessions", response_model=list[StreamPlaySessionResponse])
async def list_play_sessions(
    stream_name: str = Query(""),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[StreamPlaySessionResponse]:
    query = select(StreamPlaySession).order_by(StreamPlaySession.started_at.desc())
    if stream_name:
        query = query.where(StreamPlaySession.stream_name == stream_name)
    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    return [StreamPlaySessionResponse.model_validate(s) for s in result.scalars().all()]


@router.get("/stats/publish-sessions", response_model=list[StreamPublishSessionResponse])
async def list_publish_sessions(
    stream_name: str = Query(""),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[StreamPublishSessionResponse]:
    query = select(StreamPublishSession).order_by(StreamPublishSession.started_at.desc())
    if stream_name:
        query = query.where(StreamPublishSession.stream_name == stream_name)
    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    return [StreamPublishSessionResponse.model_validate(s) for s in result.scalars().all()]


# ---------------------------------------------------------------------------
# Viewer sessions (WS-driven playback history) — primary source for analytics
# ---------------------------------------------------------------------------


def _parse_iso_or_none(value: str) -> Optional[dt.datetime]:
    """Accept YYYY-MM-DD or full ISO8601; treat naive values as UTC."""
    if not value:
        return None
    try:
        # datetime.fromisoformat handles both full and date-only strings.
        parsed = dt.datetime.fromisoformat(value)
    except ValueError as e:
        raise HTTPException(
            status_code=400, detail=f"Invalid datetime: {value!r} ({e})"
        ) from e
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def _viewer_sessions_query(
    stream_name: str,
    user_id: Optional[int],
    started_after: Optional[dt.datetime],
    started_before: Optional[dt.datetime],
    only_ended: bool,
):
    q = select(ViewerSession)
    if stream_name:
        q = q.where(ViewerSession.stream_name == stream_name)
    if user_id is not None:
        q = q.where(ViewerSession.user_id == user_id)
    if started_after is not None:
        q = q.where(ViewerSession.started_at >= started_after)
    if started_before is not None:
        q = q.where(ViewerSession.started_at < started_before)
    if only_ended:
        q = q.where(ViewerSession.ended_at.is_not(None))
    return q


@router.get("/stats/viewer-sessions", response_model=ViewerSessionListResponse)
async def list_viewer_sessions(
    stream_name: str = Query(""),
    user_id: Optional[int] = Query(None, ge=1),
    started_after: str = Query(
        "", description="ISO timestamp or date (UTC). Inclusive lower bound."
    ),
    started_before: str = Query(
        "", description="ISO timestamp or date (UTC). Exclusive upper bound."
    ),
    only_ended: bool = Query(False, description="Hide sessions still in progress."),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ViewerSessionListResponse:
    """Paginated viewer history (backend-owned, WS-driven).

    Rows are **never auto-purged** — this endpoint is the primary source for
    long-term analytics. For bulk export use ``/stats/viewer-sessions.csv``.
    """
    after_dt = _parse_iso_or_none(started_after)
    before_dt = _parse_iso_or_none(started_before)

    base_q = _viewer_sessions_query(
        stream_name, user_id, after_dt, before_dt, only_ended
    )

    total_result = await db.execute(
        select(func.count()).select_from(base_q.subquery())
    )
    total = int(total_result.scalar() or 0)

    page_q = base_q.order_by(ViewerSession.started_at.desc()).offset(offset).limit(limit)
    rows_result = await db.execute(page_q)
    items = [ViewerSessionResponse.model_validate(s) for s in rows_result.scalars().all()]

    return ViewerSessionListResponse(items=items, total=total)


@router.get("/stats/viewer-sessions.csv")
async def export_viewer_sessions_csv(
    stream_name: str = Query(""),
    user_id: Optional[int] = Query(None, ge=1),
    started_after: str = Query(""),
    started_before: str = Query(""),
    only_ended: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Streaming CSV export of viewer history.

    All matched rows are included (no ``limit``); server-side streaming keeps
    memory flat even for large exports.
    """
    after_dt = _parse_iso_or_none(started_after)
    before_dt = _parse_iso_or_none(started_before)

    base_q = _viewer_sessions_query(
        stream_name, user_id, after_dt, before_dt, only_ended
    ).order_by(ViewerSession.started_at.asc())

    # We resolve usernames in bulk up-front so the CSV is human-readable but
    # we don't join per-row (keeps the query simple, and we stream the rest).
    uid_rows = await db.execute(
        select(User.id, User.username, User.display_name)
    )
    user_map: dict[int, tuple[str, str]] = {
        uid: (uname, dname) for uid, uname, dname in uid_rows.all()
    }

    header = [
        "id",
        "session_key",
        "stream_name",
        "user_id",
        "username",
        "display_name",
        "client_ip",
        "user_agent",
        "started_at",
        "last_heartbeat_at",
        "ended_at",
        "duration_seconds",
    ]

    async def row_generator():
        # Write header.
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(header)
        yield buf.getvalue()

        # Stream rows in chunks to keep memory bounded.
        chunk_size = 1000
        last_id = 0
        while True:
            q = base_q.where(ViewerSession.id > last_id).limit(chunk_size)
            res = await db.execute(q)
            rows = list(res.scalars().all())
            if not rows:
                break
            buf = io.StringIO()
            writer = csv.writer(buf)
            for r in rows:
                uname, dname = ("", "")
                if r.user_id is not None:
                    uname, dname = user_map.get(r.user_id, ("", ""))
                writer.writerow(
                    [
                        r.id,
                        r.session_key,
                        r.stream_name,
                        r.user_id if r.user_id is not None else "",
                        uname,
                        dname,
                        r.client_ip or "",
                        (r.user_agent or "").replace("\n", " ").replace("\r", " "),
                        r.started_at.isoformat() if r.started_at else "",
                        r.last_heartbeat_at.isoformat() if r.last_heartbeat_at else "",
                        r.ended_at.isoformat() if r.ended_at else "",
                        r.duration_seconds or 0,
                    ]
                )
            yield buf.getvalue()
            last_id = rows[-1].id
            if len(rows) < chunk_size:
                break

    filename_parts = ["viewer-sessions"]
    if stream_name:
        filename_parts.append(stream_name)
    filename_parts.append(dt.datetime.utcnow().strftime("%Y%m%d-%H%M%S"))
    filename = "_".join(filename_parts) + ".csv"

    # UTF-8 BOM so Excel opens non-ASCII (CJK) correctly.
    async def with_bom():
        yield "\ufeff"
        async for chunk in row_generator():
            yield chunk

    return StreamingResponse(
        with_bom(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/stats/viewer-sessions/summary")
async def viewer_sessions_summary(
    stream_name: str = Query(""),
    started_after: str = Query(""),
    started_before: str = Query(""),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    """High-level aggregation over the viewer history (for a dashboard)."""
    after_dt = _parse_iso_or_none(started_after)
    before_dt = _parse_iso_or_none(started_before)
    base = _viewer_sessions_query(stream_name, None, after_dt, before_dt, False)

    count_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total_sessions = int(count_q.scalar() or 0)

    dur_q = await db.execute(
        select(
            func.coalesce(func.sum(ViewerSession.duration_seconds), 0)
        ).select_from(base.subquery())
    )
    total_duration = int(dur_q.scalar() or 0)

    uniq_q = await db.execute(
        select(func.count(func.distinct(ViewerSession.user_id))).select_from(
            base.where(ViewerSession.user_id.is_not(None)).subquery()
        )
    )
    unique_users = int(uniq_q.scalar() or 0)

    per_stream_q = await db.execute(
        select(
            ViewerSession.stream_name,
            func.count(ViewerSession.id),
            func.coalesce(func.sum(ViewerSession.duration_seconds), 0),
        )
        .select_from(base.subquery())
        .group_by(ViewerSession.stream_name)
    )
    per_stream = [
        {"stream_name": name, "sessions": int(cnt), "watch_seconds": int(secs)}
        for name, cnt, secs in per_stream_q.all()
    ]
    per_stream.sort(key=lambda r: r["watch_seconds"], reverse=True)

    return {
        "stream_name": stream_name or None,
        "started_after": started_after or None,
        "started_before": started_before or None,
        "total_sessions": total_sessions,
        "total_watch_seconds": total_duration,
        "unique_logged_in_viewers": unique_users,
        "per_stream": per_stream,
    }


# ===========================================================================
# App settings
# ===========================================================================


@router.get("/settings")
async def get_app_settings(_admin: User = Depends(require_admin)) -> dict[str, str]:
    return {
        "app_name": settings.app_name,
        "srs_http_url": settings.srs_http_url,
        "srs_api_url": settings.srs_api_url,
        "srs_app": settings.srs_app,
        "public_base_url": settings.public_base_url,
        "oauth2_admin_group": settings.oauth2_admin_group,
        "webrtc_play_enabled": str(settings.webrtc_play_enabled).lower(),
    }
