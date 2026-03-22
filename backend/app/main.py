"""FastAPI application entry point."""

import logging
import os
import re
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from app.config import settings
from app.database import init_db
from app.routers import admin, auth, chat, streams

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _login_to_oryx(max_retries: int = 10, delay: float = 3.0) -> None:
    """Login to Oryx using MGMT_PASSWORD to obtain the Bearer API secret.

    Oryx does not accept MGMT_PASSWORD directly as a Bearer token.
    We must call /terraform/v1/mgmt/login with the password to get
    the real API secret (SRS_PLATFORM_SECRET) for subsequent requests.
    """
    if not settings.oryx_mgmt_password:
        logger.info("No ORYX_MGMT_PASSWORD configured, skipping Oryx login")
        return

    import asyncio

    login_url = f"{settings.oryx_api_url}/terraform/v1/mgmt/login"
    for attempt in range(1, max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(login_url, json={"password": settings.oryx_mgmt_password})
                resp.raise_for_status()
                data = resp.json()
                bearer = data.get("data", {}).get("bearer", "")
                if bearer:
                    settings.oryx_api_secret = bearer
                    logger.info("Oryx login successful, obtained API bearer token")
                    return
                else:
                    logger.warning(f"Oryx login response missing bearer (attempt {attempt}/{max_retries})")
        except Exception as e:
            logger.warning(f"Oryx login attempt {attempt}/{max_retries} failed: {e}")

        if attempt < max_retries:
            await asyncio.sleep(delay)

    logger.error("Failed to login to Oryx after all retries. API calls to Oryx will fail.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - startup and shutdown."""
    logger.info(f"Starting {settings.app_name}")
    await init_db()
    logger.info("Database initialized")
    await _login_to_oryx()
    yield
    logger.info(f"Shutting down {settings.app_name}")


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.debug else None,
    redoc_url="/api/redoc" if settings.debug else None,
)

# CORS
origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(streams.router)
app.include_router(admin.router)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "app": settings.app_name}


# ============================================================
# SPA Fallback helper
# ============================================================
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")


async def _serve_spa_or_404(path: str) -> Response:
    """Try to serve a static file or fall back to index.html for SPA routes."""
    from fastapi.responses import FileResponse

    if os.path.isdir(STATIC_DIR):
        file_path = os.path.join(STATIC_DIR, path.lstrip("/"))
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
    return Response(content="Not Found", status_code=404)


# ============================================================
# Oryx Stream Media Reverse Proxy
# Proxies FLV/HLS/TS streams from Oryx to the client so that
# the browser never needs direct access to the Oryx container.
# Matches patterns like /live/stream.flv, /live/stream.m3u8, etc.
# ============================================================

# Regex for media stream paths: /{app}/{stream}.(flv|m3u8|ts|aac|mp3)
_STREAM_MEDIA_RE = re.compile(r"^/[^/]+/[^/]+\.(flv|m3u8|ts|aac|mp3)$")


@app.api_route("/{app_name}/{stream_file:path}", methods=["GET"])
async def proxy_oryx_media(app_name: str, stream_file: str, request: Request):
    """Reverse proxy for Oryx media streams (FLV, HLS, TS, AAC, MP3).

    Only matches paths that look like media stream URLs to avoid
    conflicting with the SPA frontend routes.
    """
    full_path = f"/{app_name}/{stream_file}"

    # Only proxy actual stream media files
    if not _STREAM_MEDIA_RE.match(full_path):
        # Fall through to SPA handler if not a media file
        return await _serve_spa_or_404(full_path)

    oryx_url = f"{settings.oryx_http_url}{full_path}"
    query_string = str(request.query_params)
    if query_string:
        oryx_url += f"?{query_string}"

    # Build auth headers
    headers = {}
    if settings.oryx_api_secret:
        headers["Authorization"] = f"Bearer {settings.oryx_api_secret}"

    client = httpx.AsyncClient(timeout=None)
    try:
        req = client.build_request("GET", oryx_url, headers=headers)
        response = await client.send(req, stream=True)

        # Determine content type from Oryx response
        content_type = response.headers.get("content-type", "application/octet-stream")

        # For non-streaming responses (m3u8, ts), read fully
        if stream_file.endswith((".m3u8", ".ts")):
            body = await response.aread()
            await response.aclose()
            await client.aclose()
            return Response(
                content=body,
                status_code=response.status_code,
                media_type=content_type,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-cache",
                },
            )

        # For FLV streaming, use StreamingResponse
        async def stream_generator():
            try:
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    yield chunk
            finally:
                await response.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_generator(),
            status_code=response.status_code,
            media_type=content_type,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache",
            },
        )
    except Exception as e:
        await client.aclose()
        logger.error(f"Proxy error for {full_path}: {e}")
        return Response(content=f"Proxy error: {e}", status_code=502)


# ============================================================
# WebRTC WHIP/WHEP Proxy
# ============================================================


@app.api_route("/rtc/v1/{path:path}", methods=["GET", "POST", "OPTIONS"])
async def proxy_oryx_rtc(path: str, request: Request):
    """Proxy WebRTC signaling (WHIP/WHEP) to Oryx."""
    oryx_url = f"{settings.oryx_http_url}/rtc/v1/{path}"
    query_string = str(request.query_params)
    if query_string:
        oryx_url += f"?{query_string}"

    body = await request.body()
    headers = {}
    if settings.oryx_api_secret:
        headers["Authorization"] = f"Bearer {settings.oryx_api_secret}"

    # Forward Content-Type
    ct = request.headers.get("content-type")
    if ct:
        headers["Content-Type"] = ct

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.request(
            request.method,
            oryx_url,
            content=body,
            headers=headers,
        )
        # Preserve the status code (WHIP returns 201)
        resp_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
        # Forward Location header for WHIP
        if "location" in response.headers:
            resp_headers["Location"] = response.headers["location"]

        return Response(
            content=response.content,
            status_code=response.status_code,
            media_type=response.headers.get("content-type", "application/sdp"),
            headers=resp_headers,
        )


# ============================================================
# Oryx HTTP Callback Endpoints
# These can be configured in Oryx to notify this app about events.
# ============================================================


@app.post("/api/hooks/on_publish")
async def oryx_on_publish(request: Request):
    """Oryx callback when a stream starts publishing."""
    data = await request.json()
    logger.info(f"[Oryx Hook] Stream published: {data.get('stream', 'unknown')}")
    return {"code": 0}


@app.post("/api/hooks/on_unpublish")
async def oryx_on_unpublish(request: Request):
    """Oryx callback when a stream stops publishing."""
    data = await request.json()
    logger.info(f"[Oryx Hook] Stream unpublished: {data.get('stream', 'unknown')}")
    return {"code": 0}


@app.post("/api/hooks/on_play")
async def oryx_on_play(request: Request):
    """Oryx callback when a client starts playing."""
    data = await request.json()
    logger.info(f"[Oryx Hook] Client play: {data.get('stream', 'unknown')} from {data.get('ip', 'unknown')}")
    return {"code": 0}


@app.post("/api/hooks/on_stop")
async def oryx_on_stop(request: Request):
    """Oryx callback when a client stops playing."""
    data = await request.json()
    logger.info(f"[Oryx Hook] Client stop: {data.get('stream', 'unknown')}")
    return {"code": 0}


@app.post("/api/hooks/on_record_begin")
async def oryx_on_record_begin(request: Request):
    """Oryx callback when recording begins."""
    data = await request.json()
    logger.info(f"[Oryx Hook] Record begin: {data}")
    return {"code": 0}


@app.post("/api/hooks/on_record_end")
async def oryx_on_record_end(request: Request):
    """Oryx callback when recording ends."""
    data = await request.json()
    logger.info(f"[Oryx Hook] Record end: {data}")
    return {"code": 0}


# Serve frontend static files in production
# The frontend build output will be mounted at /
# This should be the last route to avoid conflicts
if os.path.isdir(STATIC_DIR):
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA frontend."""
        return await _serve_spa_or_404(full_path)
