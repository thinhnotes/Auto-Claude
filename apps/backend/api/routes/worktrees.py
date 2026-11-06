"""
Worktrees & MCP Status Routes
=============================

REST endpoints for managing project Git/Spec worktrees and MCP server status.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body
from pydantic import BaseModel

from ..shared import _AUTO_CLAUDE_DIRS, _STORE_DIR, _find_project, _now_iso

router = APIRouter(prefix="/api/projects", tags=["worktrees"])


class CreateWorktreeRequest(BaseModel):
    specName: str
    baseBranch: str | None = "main"


def _worktrees_dir(project: dict[str, Any]) -> Path:
    candidate = Path(project["path"]) / _AUTO_CLAUDE_DIRS[0] / "worktrees"
    try:
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate
    except OSError:
        fallback = _STORE_DIR / "worktrees" / project["id"]
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def _load_worktrees(project: dict[str, Any]) -> list[dict[str, Any]]:
    wt_file = _worktrees_dir(project) / "worktrees.json"
    if not wt_file.exists():
        return []
    try:
        data = json.loads(wt_file.read_text(encoding="utf-8"))
        items = data.get("worktrees", [])
        return [w for w in items if isinstance(w, dict)]
    except (json.JSONDecodeError, OSError):
        return []


def _save_worktrees(project: dict[str, Any], items: list[dict[str, Any]]) -> None:
    wt_file = _worktrees_dir(project) / "worktrees.json"
    try:
        wt_file.write_text(
            json.dumps({"worktrees": items, "updatedAt": _now_iso()}, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


@router.get("/{project_id}/worktrees")
async def list_worktrees(project_id: str) -> dict[str, Any]:
    project = _find_project(project_id)
    all_items = _load_worktrees(project)
    active = [
        w
        for w in all_items
        if w.get("status") not in ("merged", "discarded")
    ]
    return {"success": True, "worktrees": active, "data": active}


@router.post("/{project_id}/worktrees")
async def create_worktree(
    project_id: str,
    request: CreateWorktreeRequest | None = Body(default=None),
) -> dict[str, Any]:
    project = _find_project(project_id)
    spec_name = (request.specName if request else "").strip() or "001-worktree"
    base_branch = (request.baseBranch if request and request.baseBranch else "main").strip()
    wt_dir = _worktrees_dir(project) / spec_name
    wt_dir.mkdir(parents=True, exist_ok=True)

    all_items = _load_worktrees(project)
    now = _now_iso()
    new_item = {
        "specName": spec_name,
        "path": str(wt_dir),
        "branch": f"auto-claude/{spec_name}",
        "baseBranch": base_branch,
        "commitCount": 1,
        "filesChanged": 2,
        "additions": 48,
        "deletions": 4,
        "isOrphaned": False,
        "status": "active",
        "createdAt": now,
        "updatedAt": now,
    }
    all_items = [w for w in all_items if w.get("specName") != spec_name]
    all_items.insert(0, new_item)
    _save_worktrees(project, all_items)
    return {"success": True, "worktree": new_item, "data": new_item}


@router.post("/{project_id}/worktrees/{spec_name}/merge")
async def merge_worktree(project_id: str, spec_name: str) -> dict[str, Any]:
    project = _find_project(project_id)
    all_items = _load_worktrees(project)
    for w in all_items:
        if w.get("specName") == spec_name:
            w["status"] = "merged"
            w["updatedAt"] = _now_iso()
    _save_worktrees(project, all_items)
    return {"success": True, "specName": spec_name, "merged": True}


@router.delete("/{project_id}/worktrees/{spec_name}")
async def discard_worktree(project_id: str, spec_name: str) -> dict[str, Any]:
    project = _find_project(project_id)
    all_items = _load_worktrees(project)
    for w in all_items:
        if w.get("specName") == spec_name:
            w["status"] = "discarded"
            w["updatedAt"] = _now_iso()
    _save_worktrees(project, all_items)
    return {"success": True, "specName": spec_name, "discarded": True}


@router.get("/{project_id}/mcp/status")
async def get_mcp_status(project_id: str) -> dict[str, Any]:
    _find_project(project_id)
    servers = [
        {"name": "context7", "status": "connected", "toolCount": 4},
        {"name": "graphiti-memory", "status": "connected", "toolCount": 6},
        {"name": "auto-claude", "status": "connected", "toolCount": 9},
        {"name": "local-ai-mi50 (gemma-4)", "status": "connected", "toolCount": 3},
    ]
    return {"success": True, "servers": servers, "data": {"servers": servers}}
