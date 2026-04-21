"""Pydantic schemas for request/response models."""

import datetime
from typing import Any, Optional

from pydantic import BaseModel


# ---- Auth ----
class OAuthCallbackRequest(BaseModel):
    code: str
    state: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class AuthURLResponse(BaseModel):
    authorize_url: str


# ---- User ----
class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    email: str
    avatar_url: str
    is_admin: bool
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    users: list[UserResponse]
    total: int


class UserBanRequest(BaseModel):
    is_banned: bool


# ---- Chat ----
class ChatMessageRequest(BaseModel):
    content: str
    stream_name: str = ""


class ChatMessageResponse(BaseModel):
    id: int
    user_id: int
    username: str
    display_name: str
    content: str
    stream_name: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class ChatHistoryResponse(BaseModel):
    messages: list[ChatMessageResponse]
    total: int


class ChatRoomConfig(BaseModel):
    """Runtime chat config the frontend uses to decide if the chat UI is shown."""

    stream_name: str
    chat_enabled: bool
    require_login_to_send: bool = True


# ---- Stream ----
class StreamInfo(BaseModel):
    """Public-facing stream info shown on the listing page."""

    name: str
    display_name: str
    app: str
    video_codec: Optional[str] = None
    audio_codec: Optional[str] = None
    clients: int = 0
    is_private: bool = False
    chat_enabled: bool = True
    webrtc_play_enabled: bool = True
    is_live: bool = False
    formats: list[str] = []


class StreamListResponse(BaseModel):
    streams: list[StreamInfo]


class StreamPlayRequest(BaseModel):
    stream_name: str
    # "flv" or "webrtc"
    format: str = "flv"
    # Optional watch token for private streams when the user is not logged in.
    token: Optional[str] = None


class StreamPlayResponse(BaseModel):
    url: str
    stream_name: str
    format: str


class StreamConfigRequest(BaseModel):
    """Admin request for creating / updating a live room."""

    display_name: Optional[str] = None
    is_private: Optional[bool] = None
    publish_secret: Optional[str] = None
    watch_token: Optional[str] = None
    chat_enabled: Optional[bool] = None
    webrtc_play_enabled: Optional[bool] = None


class StreamConfigResponse(BaseModel):
    id: int
    stream_name: str
    display_name: str
    is_private: bool
    publish_secret: str
    watch_token: str
    chat_enabled: bool
    webrtc_play_enabled: bool = True
    is_live: bool
    viewer_count: int
    total_play_count: int
    last_publish_at: Optional[datetime.datetime] = None
    last_unpublish_at: Optional[datetime.datetime] = None
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = {"from_attributes": True}


# ---- Stream Play / Publish Statistics ----
class StreamPlaySessionResponse(BaseModel):
    id: int
    srs_client_id: str
    stream_name: str
    user_id: Optional[int] = None
    client_ip: str
    started_at: datetime.datetime
    ended_at: Optional[datetime.datetime] = None
    duration_seconds: int

    model_config = {"from_attributes": True}


class StreamPublishSessionResponse(BaseModel):
    id: int
    srs_client_id: str
    stream_name: str
    client_ip: str
    started_at: datetime.datetime
    ended_at: Optional[datetime.datetime] = None
    duration_seconds: int

    model_config = {"from_attributes": True}


# ---- SRS HTTP hook payload (generic) ----
class SRSHookPayload(BaseModel):
    """Body schema SRS posts to http_hooks.

    Reference: https://ossrs.io/lts/en-us/docs/v6/doc/http-callback
    Only the common fields are defined — other fields are accepted as-is
    (FastAPI will read the raw JSON when needed).
    """

    action: str = ""
    client_id: str = ""
    ip: str = ""
    vhost: str = ""
    app: str = ""
    stream: str = ""
    param: str = ""
    server_id: Optional[str] = None
    tcUrl: Optional[str] = None


# ---- SRS admin response ----
class SRSSummary(BaseModel):
    """Raw summary from SRS /api/v1/summaries."""

    data: dict[str, Any] = {}
