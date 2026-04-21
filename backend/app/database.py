"""Database setup and session management."""

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(settings.database_url, echo=settings.debug)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """Dependency to get database session."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ---------------------------------------------------------------------------
# Lightweight in-place schema migrations.
#
# We don't pull in Alembic for what is currently a tiny, single-table-evolution
# project. Each entry below is idempotent: it inspects the live schema and adds
# the column only if it doesn't already exist.
#
# When the schema grows enough to need rollbacks/branching, swap this for
# Alembic — but until then this keeps `docker compose up` zero-friction for
# users upgrading from older builds.
# ---------------------------------------------------------------------------
_ADDITIVE_COLUMNS: list[tuple[str, str, str]] = [
    # (table, column, "TYPE [NOT NULL] DEFAULT ...")
    ("stream_configs", "webrtc_play_enabled", "BOOLEAN NOT NULL DEFAULT 1"),
]


async def _apply_additive_migrations() -> None:
    async with engine.begin() as conn:
        for table, column, ddl in _ADDITIVE_COLUMNS:
            try:
                cols_result = await conn.execute(text(f"PRAGMA table_info({table})"))
                existing = {row[1] for row in cols_result.fetchall()}
            except Exception:  # non-sqlite or table missing — let create_all handle it
                continue
            if column in existing:
                continue
            try:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                logger.info("Migrated: added %s.%s", table, column)
            except Exception as e:
                logger.warning("Skipping migration for %s.%s: %s", table, column, e)


async def init_db():
    """Initialize database tables and apply additive migrations."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _apply_additive_migrations()
