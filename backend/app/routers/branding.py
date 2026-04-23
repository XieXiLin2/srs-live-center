"""Site-branding endpoints.

Exposes a publicly-readable ``GET /api/branding`` used by every page of the
SPA to render the site name, logo and footer, plus an admin-only PUT that
writes to the ``app_settings`` KV table.

The public endpoint must be reachable **without authentication** because the
header/footer is visible on the login screen too — including before the first
user has logged in.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.config import settings
from app.database import get_db
from app.models import AppSetting, User

router = APIRouter(tags=["branding"])

# Keys recognised by the branding endpoints. Any other key in app_settings
# is ignored here (future settings can reuse the same KV table under a
# different router/namespace).
_SITE_NAME_KEY = "site_name"
_LOGO_URL_KEY = "site_logo_url"
_COPYRIGHT_KEY = "site_copyright"
_OFFLINE_PLACEHOLDER_KEY = "offline_placeholder_url"
_ICP_FILING_KEY = "icp_filing"
_MPS_FILING_KEY = "mps_filing"
_MOEICP_FILING_KEY = "moeicp_filing"


class BrandingResponse(BaseModel):
    """Public branding info. Safe to expose unauthenticated."""

    site_name: str
    logo_url: str
    copyright: str
    offline_placeholder_url: str
    icp_filing: str
    mps_filing: str
    moeicp_filing: str


class BrandingUpdateRequest(BaseModel):
    """Partial update — any field left as ``None`` is untouched."""

    site_name: Optional[str] = Field(default=None, max_length=128)
    logo_url: Optional[str] = Field(default=None, max_length=1024)
    copyright: Optional[str] = Field(default=None, max_length=512)
    offline_placeholder_url: Optional[str] = Field(default=None, max_length=1024)
    icp_filing: Optional[str] = Field(default=None, max_length=256)
    mps_filing: Optional[str] = Field(default=None, max_length=256)
    moeicp_filing: Optional[str] = Field(default=None, max_length=256)


async def _load_map(db: AsyncSession, keys: list[str]) -> dict[str, str]:
    """Return ``{key: value}`` for the requested keys (missing = absent)."""
    result = await db.execute(select(AppSetting).where(AppSetting.key.in_(keys)))
    return {row.key: row.value for row in result.scalars().all()}


def _format_copyright(raw: str) -> str:
    """Replace the ``{year}`` placeholder with the current year.

    Any other ``{...}`` placeholders are left untouched so they don't accidentally
    break admin-entered text with curly braces in it.
    """
    year = datetime.now().year
    try:
        return raw.replace("{year}", str(year))
    except Exception:  # noqa: BLE001
        return raw


@router.get("/api/branding", response_model=BrandingResponse)
async def get_branding(db: AsyncSession = Depends(get_db)) -> BrandingResponse:
    """Public endpoint: no auth required."""
    stored = await _load_map(
        db, [_SITE_NAME_KEY, _LOGO_URL_KEY, _COPYRIGHT_KEY, _OFFLINE_PLACEHOLDER_KEY,
             _ICP_FILING_KEY, _MPS_FILING_KEY, _MOEICP_FILING_KEY]
    )
    # Env defaults (from config.Settings) serve as fallback until the admin
    # customises things from the UI for the first time.
    site_name = stored.get(_SITE_NAME_KEY) or settings.site_name
    logo_url = stored.get(_LOGO_URL_KEY) or settings.site_logo_url
    copyright_tpl = stored.get(_COPYRIGHT_KEY) or settings.site_copyright
    offline_placeholder_url = stored.get(_OFFLINE_PLACEHOLDER_KEY) or settings.offline_placeholder_url
    icp_filing = stored.get(_ICP_FILING_KEY) or ""
    mps_filing = stored.get(_MPS_FILING_KEY) or ""
    moeicp_filing = stored.get(_MOEICP_FILING_KEY) or ""

    return BrandingResponse(
        site_name=site_name,
        logo_url=logo_url,
        copyright=_format_copyright(copyright_tpl),
        offline_placeholder_url=offline_placeholder_url,
        icp_filing=icp_filing,
        mps_filing=mps_filing,
        moeicp_filing=moeicp_filing,
    )


@router.put("/api/admin/branding", response_model=BrandingResponse)
async def update_branding(
    payload: BrandingUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> BrandingResponse:
    """Admin-only partial update."""
    updates: dict[str, str] = {}
    if payload.site_name is not None:
        value = payload.site_name.strip()
        if not value:
            raise HTTPException(status_code=400, detail="site_name cannot be empty")
        updates[_SITE_NAME_KEY] = value
    if payload.logo_url is not None:
        updates[_LOGO_URL_KEY] = payload.logo_url.strip()
    if payload.copyright is not None:
        # Store the *template* (e.g. "© {year} Foo"); the GET endpoint expands
        # it per request so "© 2026 Foo" rolls over automatically at midnight
        # on new year.
        updates[_COPYRIGHT_KEY] = payload.copyright
    if payload.offline_placeholder_url is not None:
        updates[_OFFLINE_PLACEHOLDER_KEY] = payload.offline_placeholder_url.strip()
    if payload.icp_filing is not None:
        updates[_ICP_FILING_KEY] = payload.icp_filing.strip()
    if payload.mps_filing is not None:
        updates[_MPS_FILING_KEY] = payload.mps_filing.strip()
    if payload.moeicp_filing is not None:
        updates[_MOEICP_FILING_KEY] = payload.moeicp_filing.strip()

    for key, value in updates.items():
        result = await db.execute(select(AppSetting).where(AppSetting.key == key))
        row = result.scalar_one_or_none()
        if row is None:
            db.add(AppSetting(key=key, value=value))
        else:
            row.value = value
    await db.flush()

    return await get_branding(db)  # type: ignore[return-value]
