"""
Insights Routes
===============

REST endpoints for the AI insights/chat interface. Mirrors the data contract
from the Electron IPC handlers (insights-handlers.ts) and the Next.js Web UI
(`apiClient.streamInsights` / `apiClient.queryInsights`).
"""

from __future__ import annotations

import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.local_ai_service import complete_local_ai_chat, stream_local_ai_chat
from ..shared import _AUTO_CLAUDE_DIRS, _STORE_DIR, _find_project, _now_iso

router = APIRouter(prefix="/api/projects", tags=["insights"])

_INSIGHTS_DIR = "insights"
_SESSION_FILE = "session.json"


class InsightsQueryRequest(BaseModel):
    message: str
    model: str | None = None
    thinkingLevel: str | None = None


def _insights_dir(project: dict[str, Any]) -> Path:
    """Return a writable insights directory for a project."""
    candidate = (
        Path(project["path"])
        / (project.get("autoBuildPath") or _AUTO_CLAUDE_DIRS[0])
        / _INSIGHTS_DIR
    )
    try:
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate
    except OSError:
        fallback = _STORE_DIR / "insights" / project["id"]
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def _load_session(project: dict[str, Any]) -> dict[str, Any] | None:
    """Load the insights session from disk, or None if not found."""
    session_path = _insights_dir(project) / _SESSION_FILE
    if not session_path.exists():
        return None
    try:
        return json.loads(session_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _save_session(project: dict[str, Any], session: dict[str, Any]) -> None:
    """Save the insights session to disk."""
    try:
        d = _insights_dir(project)
        session_path = d / _SESSION_FILE
        session_path.write_text(
            json.dumps(session, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except OSError:
        pass


def _build_project_system_prompt(project: dict[str, Any]) -> str:
    """Build a concise codebase-aware system prompt for Local AI."""
    project_name = project.get("name", "Project")
    project_path = project.get("path", "")
    top_entries: list[str] = []
    try:
        if project_path and os.path.isdir(project_path):
            top_entries = sorted(os.listdir(project_path))[:30]
    except OSError:
        pass
    entries_str = ", ".join(top_entries) if top_entries else "N/A"
    return (
        f"Bạn là Aperant AI Assistant (chạy trên hệ thống Local AI: AMD Instinct MI50 GPU & Local CLIProxy) "
        f"hỗ trợ kỹ sư phần mềm phân tích dự án '{project_name}' tại '{project_path}'.\n"
        f"Các file/thư mục gốc trong dự án: {entries_str}.\n"
        f"Hãy trả lời ngắn gọn, chính xác, có cấu trúc Markdown rõ ràng (ưu tiên tiếng Việt trừ khi người dùng hỏi bằng tiếng Anh)."
    )


@router.get("/{project_id}/insights")
@router.get("/{project_id}/insights/session")
async def get_insights_session(project_id: str) -> dict[str, Any]:
    """Retrieve the current insights chat session for a project."""
    project = _find_project(project_id)
    session = _load_session(project)
    return {"success": True, "data": session}


@router.post("/{project_id}/insights/stream")
@router.post("/{project_id}/insights/query")
async def query_insights_stream(
    project_id: str, request: InsightsQueryRequest
) -> StreamingResponse:
    """Send a message to the Local AI and stream back SSE chunks."""
    project = _find_project(project_id)
    session = _load_session(project) or {
        "id": f"session-{uuid.uuid4().hex[:8]}",
        "projectId": project_id,
        "messages": [],
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    }

    history_messages: list[dict[str, str]] = []
    for m in (session.get("messages") or [])[-8:]:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role in ("user", "assistant") and content:
            history_messages.append({"role": role, "content": content})
    history_messages.append({"role": "user", "content": request.message})

    user_msg = {
        "id": f"msg-{uuid.uuid4().hex[:8]}",
        "role": "user",
        "content": request.message,
        "timestamp": _now_iso(),
    }
    session.setdefault("messages", []).append(user_msg)
    system_prompt = _build_project_system_prompt(project)

    async def event_stream():
        yield f"data: {json.dumps({'type': 'start', 'projectId': project_id})}\n\n"
        full_reply: list[str] = []
        try:
            async for chunk in stream_local_ai_chat(
                messages=history_messages,
                model=request.model,
                system_prompt=system_prompt,
            ):
                full_reply.append(chunk)
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk}, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)}, ensure_ascii=False)}\n\n"

        reply_text = "".join(full_reply)
        if reply_text:
            session["messages"].append(
                {
                    "id": f"msg-{uuid.uuid4().hex[:8]}",
                    "role": "assistant",
                    "content": reply_text,
                    "timestamp": _now_iso(),
                }
            )
            session["updatedAt"] = _now_iso()
            _save_session(project, session)

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{project_id}/insights")
async def query_insights_sync(
    project_id: str, request: InsightsQueryRequest
) -> dict[str, Any]:
    """Non-streaming insights query endpoint."""
    project = _find_project(project_id)
    system_prompt = _build_project_system_prompt(project)
    res = await complete_local_ai_chat(
        messages=[{"role": "user", "content": request.message}],
        model=request.model,
        system_prompt=system_prompt,
    )
    return {"success": True, "data": {"response": res.get("text", ""), "model": res.get("model")}}


@router.delete("/{project_id}/insights")
@router.delete("/{project_id}/insights/session")
async def clear_insights_session(project_id: str) -> dict[str, Any]:
    """Clear the insights chat session for a project."""
    project = _find_project(project_id)
    d = _insights_dir(project)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    return {"success": True}
