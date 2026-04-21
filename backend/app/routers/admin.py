"""Admin routes - user management, SRS status, live session statistics."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import srs_client
from app.auth import require_admin
from app.config import settings
from app.database import get_db
from app.models import ChatMessage, StreamPlaySession, StreamPublishSession, User
from app.schemas import (
    StreamPlaySessionResponse,
    StreamPublishSessionResponse,
    UserBanRequest,
    UserListResponse,
    UserResponse,
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
