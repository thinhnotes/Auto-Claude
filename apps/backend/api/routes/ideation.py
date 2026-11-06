"""
Ideation Routes
===============

REST endpoints for AI-generated project ideas powered by Local AI.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..services.local_ai_service import complete_local_ai_chat
from ..shared import _AUTO_CLAUDE_DIRS, _STORE_DIR, _find_project, _now_iso

router = APIRouter(prefix="/api/projects", tags=["ideation"])

_IDEATION_DIR = "ideation"
_SESSION_FILE = "session.json"


class IdeationGenerateRequest(BaseModel):
    categories: list[str] | None = None
    category: str | None = None
    context: str | None = None
    model: str | None = None


def _ideation_dir(project: dict[str, Any]) -> Path:
    """Return a writable ideation directory for a project."""
    candidate = (
        Path(project["path"])
        / (project.get("autoBuildPath") or _AUTO_CLAUDE_DIRS[0])
        / _IDEATION_DIR
    )
    try:
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate
    except OSError:
        fallback = _STORE_DIR / "ideation" / project["id"]
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def _load_session(project: dict[str, Any]) -> dict[str, Any] | None:
    session_path = _ideation_dir(project) / _SESSION_FILE
    if not session_path.exists():
        return None
    try:
        return json.loads(session_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _save_session(project: dict[str, Any], session: dict[str, Any]) -> None:
    try:
        session_path = _ideation_dir(project) / _SESSION_FILE
        session_path.write_text(
            json.dumps(session, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except OSError:
        pass


@router.get("/{project_id}/ideas")
@router.get("/{project_id}/ideation")
async def get_ideas(project_id: str) -> dict[str, Any]:
    """Get the current ideation session for a project."""
    project = _find_project(project_id)
    session = _load_session(project)
    return {"success": True, "data": session, "session": session}


@router.post("/{project_id}/ideas/generate")
@router.post("/{project_id}/ideation/generate")
async def generate_ideas(
    project_id: str, request: IdeationGenerateRequest
) -> dict[str, Any]:
    """Generate structured project improvement ideas using Local AI."""
    project = _find_project(project_id)
    project_name = project.get("name", "Project")
    project_path = project.get("path", "")
    top_entries: list[str] = []
    try:
        if project_path and os.path.isdir(project_path):
            top_entries = sorted(os.listdir(project_path))[:25]
    except OSError:
        pass

    prompt = (
        f"Phân tích dự án '{project_name}' (cấu trúc thư mục: {', '.join(top_entries)}) "
        f"và trả về đúng 1 JSON array gồm 4 ý tưởng cải tiến kỹ thuật bằng tiếng Việt. "
        f"Mỗi phần tử gồm các trường: title, description, type (một trong: code_improvements, ui_ux_improvements, performance_optimizations, security_hardening), "
        f"priority (high/medium/low), rationale. Chỉ trả về JSON array hợp lệ."
    )
    res = await complete_local_ai_chat(
        messages=[{"role": "user", "content": prompt}],
        model=request.model,
        max_tokens=1200,
    )
    raw_text = res.get("text", "")
    parsed_ideas: list[dict[str, Any]] = []
    match = re.search(r"\[[\s\S]*\]", raw_text)
    if match:
        try:
            items = json.loads(match.group(0))
            if isinstance(items, list):
                for idx, item in enumerate(items[:8]):
                    if isinstance(item, dict):
                        parsed_ideas.append(
                            {
                                "id": f"idea-{uuid.uuid4().hex[:8]}",
                                "title": item.get("title") or f"Ý tưởng #{idx+1}",
                                "description": item.get("description") or "",
                                "type": item.get("type") or "code_improvements",
                                "priority": item.get("priority") or "medium",
                                "status": "new",
                                "rationale": item.get("rationale") or "",
                                "createdAt": _now_iso(),
                            }
                        )
        except Exception:
            pass

    if not parsed_ideas:
        parsed_ideas = [
            {
                "id": f"idea-{uuid.uuid4().hex[:8]}",
                "title": "Tối ưu hoá Pipeline Local AI & Caching",
                "description": raw_text[:400] if raw_text else "Bổ sung semantic cache và healthcheck tự động cho MI50 GPU & CLIProxy.",
                "type": "performance_optimizations",
                "priority": "high",
                "status": "new",
                "rationale": "Giảm độ trễ trung bình khi nhiều agent gọi Local AI đồng thời.",
                "createdAt": _now_iso(),
            }
        ]

    session = {
        "id": f"ideation-{uuid.uuid4().hex[:8]}",
        "projectId": project_id,
        "ideas": parsed_ideas,
        "generatedAt": _now_iso(),
        "updatedAt": _now_iso(),
    }
    _save_session(project, session)
    return {
        "success": True,
        "status": "completed",
        "projectId": project_id,
        "data": session,
        "session": session,
    }
