"""
Terminal WebSocket Namespace
============================

Socket.IO ``/terminal`` namespace handling real-time terminal I/O.

Events (client -> server):
    terminal:create  -- Create a new PTY session
    terminal:input   -- Write data to a PTY
    terminal:resize  -- Resize a PTY window
    terminal:close   -- Kill a PTY session

Events (server -> client):
    terminal:output  -- PTY output data
    terminal:exit    -- PTY process exited
    terminal:error   -- Error notification
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import socketio

from ..auth import validate_socketio_token
from ..services.terminal_service import TerminalService
from ..shared import _get_registered_project_paths

logger = logging.getLogger(__name__)

# Singleton terminal service shared across all connections
_terminal_service = TerminalService()


def get_terminal_service() -> TerminalService:
    """Return the global TerminalService instance."""
    return _terminal_service


def _validate_cwd(cwd: str | None) -> str | None:
    """Validate that *cwd* is under a registered project directory.

    Returns the validated path, or ``None`` if invalid.
    """
    if cwd is None:
        return None

    try:
        resolved = Path(cwd).resolve()
    except (ValueError, OSError):
        return None

    allowed = _get_registered_project_paths()
    for project_path in allowed:
        try:
            if resolved == Path(project_path).resolve() or resolved.is_relative_to(
                Path(project_path).resolve()
            ):
                return str(resolved)
        except (ValueError, OSError):
            continue

    return None


class TerminalNamespace(socketio.AsyncNamespace):
    """Socket.IO namespace for /terminal."""

    def __init__(self) -> None:
        super().__init__("/terminal")
        self.service = _terminal_service
        # Track sid -> set of session_ids for cleanup on disconnect
        self._sid_sessions: dict[str, set[str]] = {}

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    async def on_connect(
        self, sid: str, environ: dict[str, Any], auth: dict[str, Any] | None = None
    ) -> None:
        if not validate_socketio_token(environ, auth):
            logger.warning("[TerminalNS] Rejected unauthenticated client: %s", sid)
            raise ConnectionRefusedError("Authentication required")
        self._sid_sessions[sid] = set()
        logger.info("[TerminalNS] Client connected: %s", sid)

    async def on_disconnect(self, sid: str) -> None:
        # Clean up any PTY sessions owned by this Socket.IO client
        session_ids = self._sid_sessions.pop(sid, set())
        for session_id in session_ids:
            if self.service.has_session(session_id):
                await self.service.kill(session_id)
                logger.info(
                    "[TerminalNS] Cleaned up orphaned session %s for disconnected client %s",
                    session_id,
                    sid,
                )
        logger.info("[TerminalNS] Client disconnected: %s", sid)

    # ------------------------------------------------------------------
    # Terminal events
    # ------------------------------------------------------------------

    async def on_terminal_create(
        self, sid: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Create a new PTY session.

        Expected *data*::

            {
                "sessionId": str,
                "cwd": str | None,
                "cols": int,   # default 80
                "rows": int,   # default 24
            }
        """
        session_id: str = data.get("sessionId", "")
        if not session_id:
            payload = {"error": "sessionId is required"}
            await self.emit("terminal:error", payload, to=sid)
            await self.emit("error", payload, to=sid)
            return {"ok": False, "error": "sessionId is required"}

        raw_cwd = data.get("cwd")
        cwd = _validate_cwd(raw_cwd)
        if raw_cwd is not None and cwd is None:
            error_msg = "cwd is not within a registered project directory"
            payload = {"sessionId": session_id, "error": error_msg}
            await self.emit("terminal:error", payload, to=sid)
            await self.emit("error", payload, to=sid)
            return {"ok": False, "error": error_msg}

        cols = int(data.get("cols", 80))
        rows = int(data.get("rows", 24))

        try:

            async def _on_output(sess_id: str, raw: bytes) -> None:
                if raw:
                    decoded = raw.decode("utf-8", errors="replace")
                    payload = {
                        "sessionId": sess_id,
                        "data": decoded,
                    }
                    await self.emit("terminal:output", payload, to=sid)
                    await self.emit("output", payload, to=sid)

            await self.service.spawn(session_id, cwd, cols, rows, on_output=_on_output)
            # Track this session for cleanup on disconnect
            if sid in self._sid_sessions:
                self._sid_sessions[sid].add(session_id)
            logger.info(
                "[TerminalNS] Created session %s for client %s", session_id, sid
            )
            return {"ok": True, "sessionId": session_id}
        except Exception as exc:
            logger.exception("[TerminalNS] Failed to create session %s", session_id)
            payload = {"sessionId": session_id, "error": str(exc)}
            await self.emit("terminal:error", payload, to=sid)
            await self.emit("error", payload, to=sid)
            return {"ok": False, "error": str(exc)}

    async def on_create(self, sid: str, data: dict[str, Any]) -> dict[str, Any]:
        """Alias for client event ``create``."""
        return await self.on_terminal_create(sid, data)

    async def on_terminal_input(self, sid: str, data: dict[str, Any]) -> None:
        """
        Write input to a PTY session.

        Expected *data*::

            {"sessionId": str, "data": str}
        """
        session_id = data.get("sessionId", "")
        input_data = data.get("data", "")
        if not session_id:
            return

        try:
            await self.service.write(session_id, input_data)
        except KeyError:
            payload = {"sessionId": session_id, "error": "Session not found"}
            await self.emit("terminal:error", payload, to=sid)
            await self.emit("error", payload, to=sid)

    async def on_input(self, sid: str, data: dict[str, Any]) -> None:
        """Alias for client event ``input``."""
        await self.on_terminal_input(sid, data)

    async def on_terminal_resize(self, sid: str, data: dict[str, Any]) -> None:
        """
        Resize a PTY session.

        Expected *data*::

            {"sessionId": str, "cols": int, "rows": int}
        """
        session_id = data.get("sessionId", "")
        if not session_id:
            return

        cols = int(data.get("cols", 80))
        rows = int(data.get("rows", 24))

        try:
            await self.service.resize(session_id, cols, rows)
        except KeyError:
            payload = {"sessionId": session_id, "error": "Session not found"}
            await self.emit("terminal:error", payload, to=sid)
            await self.emit("error", payload, to=sid)

    async def on_resize(self, sid: str, data: dict[str, Any]) -> None:
        """Alias for client event ``resize``."""
        await self.on_terminal_resize(sid, data)

    async def on_terminal_close(self, sid: str, data: dict[str, Any]) -> None:
        """
        Close (kill) a PTY session.

        Expected *data*::

            {"sessionId": str}
        """
        session_id = data.get("sessionId", "")
        if not session_id:
            return

        await self.service.kill(session_id)
        # Remove from tracking
        if sid in self._sid_sessions:
            self._sid_sessions[sid].discard(session_id)
        payload = {"sessionId": session_id, "code": 0}
        await self.emit("terminal:exit", payload, to=sid)
        await self.emit("exit", payload, to=sid)
        logger.info("[TerminalNS] Closed session %s for client %s", session_id, sid)

    async def on_kill(self, sid: str, data: dict[str, Any]) -> None:
        """Alias for client event ``kill``."""
        await self.on_terminal_close(sid, data)


def register_terminal_namespace(sio_server: socketio.AsyncServer) -> None:
    """Register the /terminal namespace on the given Socket.IO server."""
    sio_server.register_namespace(TerminalNamespace())
    logger.info("[TerminalNS] Registered /terminal namespace")
