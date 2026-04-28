"""Transcode API routes."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.transcode import TranscodeNode, TranscodeProfile, TranscodeTask
from app.auth import require_admin

router = APIRouter(prefix="/api/admin/transcode", tags=["transcode"])


# Pydantic models
class TranscodeNodeCreate(BaseModel):
    id: str
    name: str
    region: str
    ip_address: str | None = None
    max_tasks: int = 4
    capabilities: dict[str, Any] | None = None


class TranscodeNodeHeartbeat(BaseModel):
    cpu_usage: float | None = None
    memory_usage: float | None = None
    gpu_usage: float | None = None
    current_tasks: int
    network_latency: int | None = None


class TranscodeProfileCreate(BaseModel):
    name: str
    description: str | None = None
    source_protocol: str
    outputs: list[dict[str, Any]]
    latency_mode: str = "low"


class TranscodeTaskCreate(BaseModel):
    stream_name: str
    profile_id: int
    region: str | None = None
    auto_start: bool = True


class TranscodeTaskResponse(BaseModel):
    id: int
    stream_name: str
    profile_id: int
    node_id: str | None
    source_protocol: str | None
    source_url: str | None
    outputs: list[dict[str, Any]] | None
    status: str
    started_at: datetime | None
    stopped_at: datetime | None
    error_message: str | None
    metrics: dict[str, Any] | None

    class Config:
        from_attributes = True


# Node management
@router.post("/nodes/register")
async def register_node(
    node: TranscodeNodeCreate,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Register a new transcode node."""
    db_node = TranscodeNode(
        id=node.id,
        name=node.name,
        region=node.region,
        ip_address=node.ip_address,
        max_tasks=node.max_tasks,
        status="online",
        current_tasks=0,
        capabilities=node.capabilities or {},
        last_heartbeat=datetime.utcnow(),
    )
    db.add(db_node)
    await db.commit()
    await db.refresh(db_node)
    return db_node


@router.get("/nodes")
async def list_nodes(
    region: str | None = None,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """List all transcode nodes."""
    query = select(TranscodeNode)
    if region:
        query = query.where(TranscodeNode.region == region)
    result = await db.execute(query)
    nodes = result.scalars().all()
    return {"nodes": nodes}


@router.post("/nodes/{node_id}/heartbeat")
async def node_heartbeat(
    node_id: str,
    heartbeat: TranscodeNodeHeartbeat,
    db: AsyncSession = Depends(get_db),
):
    """Update node heartbeat and status."""
    result = await db.execute(select(TranscodeNode).where(TranscodeNode.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    node.cpu_usage = heartbeat.cpu_usage
    node.memory_usage = heartbeat.memory_usage
    node.gpu_usage = heartbeat.gpu_usage
    node.current_tasks = heartbeat.current_tasks
    node.network_latency = heartbeat.network_latency
    node.last_heartbeat = datetime.utcnow()
    node.status = "online" if heartbeat.current_tasks < node.max_tasks else "busy"

    await db.commit()
    return {"status": "ok"}


@router.delete("/nodes/{node_id}")
async def delete_node(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Delete a transcode node."""
    result = await db.execute(select(TranscodeNode).where(TranscodeNode.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    await db.delete(node)
    await db.commit()
    return {"status": "deleted"}


# Profile management
@router.post("/profiles")
async def create_profile(
    profile: TranscodeProfileCreate,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Create a transcode profile."""
    db_profile = TranscodeProfile(
        name=profile.name,
        description=profile.description,
        source_protocol=profile.source_protocol,
        outputs=profile.outputs,
        latency_mode=profile.latency_mode,
    )
    db.add(db_profile)
    await db.commit()
    await db.refresh(db_profile)
    return db_profile


@router.get("/profiles")
async def list_profiles(
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """List all transcode profiles."""
    result = await db.execute(select(TranscodeProfile))
    profiles = result.scalars().all()
    return {"profiles": profiles}


@router.get("/profiles/{profile_id}")
async def get_profile(
    profile_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Get a transcode profile."""
    result = await db.execute(select(TranscodeProfile).where(TranscodeProfile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


@router.put("/profiles/{profile_id}")
async def update_profile(
    profile_id: int,
    profile: TranscodeProfileCreate,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Update a transcode profile."""
    result = await db.execute(select(TranscodeProfile).where(TranscodeProfile.id == profile_id))
    db_profile = result.scalar_one_or_none()
    if not db_profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    db_profile.name = profile.name
    db_profile.description = profile.description
    db_profile.source_protocol = profile.source_protocol
    db_profile.outputs = profile.outputs
    db_profile.latency_mode = profile.latency_mode

    await db.commit()
    await db.refresh(db_profile)
    return db_profile


@router.delete("/profiles/{profile_id}")
async def delete_profile(
    profile_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Delete a transcode profile."""
    result = await db.execute(select(TranscodeProfile).where(TranscodeProfile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    await db.delete(profile)
    await db.commit()
    return {"status": "deleted"}


# Task management
def select_transcode_node(region: str | None, nodes: list[TranscodeNode]) -> TranscodeNode | None:
    """Select best transcode node based on region and load."""
    if not nodes:
        return None

    available = [n for n in nodes if n.status == "online" and n.current_tasks < n.max_tasks]
    if not available:
        return None

    if region:
        local = [n for n in available if n.region == region]
        if local:
            return min(local, key=lambda n: n.current_tasks)

    return min(available, key=lambda n: n.current_tasks)


@router.post("/tasks")
async def create_task(
    task: TranscodeTaskCreate,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Create a transcode task."""
    result = await db.execute(select(TranscodeProfile).where(TranscodeProfile.id == task.profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    result = await db.execute(select(TranscodeNode))
    nodes = result.scalars().all()
    selected_node = select_transcode_node(task.region, nodes)

    db_task = TranscodeTask(
        stream_name=task.stream_name,
        profile_id=task.profile_id,
        node_id=selected_node.id if selected_node else None,
        source_protocol=profile.source_protocol,
        status="pending",
    )
    db.add(db_task)
    await db.commit()
    await db.refresh(db_task)

    return TranscodeTaskResponse.model_validate(db_task)


@router.get("/tasks")
async def list_tasks(
    region: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """List all transcode tasks."""
    query = select(TranscodeTask)
    if status:
        query = query.where(TranscodeTask.status == status)
    result = await db.execute(query)
    tasks = result.scalars().all()
    return {"tasks": [TranscodeTaskResponse.model_validate(t) for t in tasks]}


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Get a transcode task."""
    result = await db.execute(select(TranscodeTask).where(TranscodeTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return TranscodeTaskResponse.model_validate(task)


@router.post("/tasks/{task_id}/start")
async def start_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Start a transcode task."""
    result = await db.execute(select(TranscodeTask).where(TranscodeTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = "running"
    task.started_at = datetime.utcnow()
    await db.commit()
    return TranscodeTaskResponse.model_validate(task)


@router.post("/tasks/{task_id}/stop")
async def stop_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Stop a transcode task."""
    result = await db.execute(select(TranscodeTask).where(TranscodeTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = "stopped"
    task.stopped_at = datetime.utcnow()
    await db.commit()
    return TranscodeTaskResponse.model_validate(task)


@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Delete a transcode task."""
    result = await db.execute(select(TranscodeTask).where(TranscodeTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    await db.delete(task)
    await db.commit()
    return {"status": "deleted"}


@router.get("/regions")
async def list_regions(
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """List all regions with node statistics."""
    result = await db.execute(select(TranscodeNode))
    nodes = result.scalars().all()

    regions: dict[str, dict] = {}
    for node in nodes:
        if node.region not in regions:
            regions[node.region] = {
                "name": node.region,
                "display_name": node.region.capitalize(),
                "nodes": 0,
                "online_nodes": 0,
                "total_capacity": 0,
                "used_capacity": 0,
                "avg_latency": 0,
            }

        r = regions[node.region]
        r["nodes"] += 1
        if node.status == "online":
            r["online_nodes"] += 1
        r["total_capacity"] += node.max_tasks
        r["used_capacity"] += node.current_tasks
        if node.network_latency:
            r["avg_latency"] = (r["avg_latency"] * (r["nodes"] - 1) + node.network_latency) / r["nodes"]

    return {"regions": list(regions.values())}
