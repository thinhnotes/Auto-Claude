"""
Shared Utilities for API Routes
================================

Common helpers used across multiple route modules: project lookup,
store persistence, env-file parsing, timestamps, and path constants.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_STORE_DIR = Path(
    os.environ.get(
        "AUTO_CLAUDE_STORE_DIR",
        "/home/thinhnguyen/.gemini/antigravity-cli/scratch/Aperant/.auto-claude-web",
    )
)
_STORE_PATH = _STORE_DIR / "projects.json"
_AUTO_CLAUDE_DIRS = (".auto-claude", "auto-claude")

# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

# Shared secret generated at startup for API authentication.
# Clients must send this as ``Authorization: Bearer <token>`` on every request.
API_TOKEN: str = os.environ.get("AUTO_CLAUDE_API_TOKEN", "aperant-local-web-token") or "aperant-local-web-token"

# ---------------------------------------------------------------------------
# Store helpers
# ---------------------------------------------------------------------------


def _load_store() -> dict[str, Any]:
    """Load the projects store from disk."""
    if _STORE_PATH.exists():
        try:
            return json.loads(_STORE_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"projects": [], "settings": {}}


def _save_store(data: dict[str, Any]) -> None:
    """Persist the projects store to disk atomically."""
    _STORE_DIR.mkdir(parents=True, exist_ok=True)
    content = json.dumps(data, indent=2, default=str)
    _write_atomic(_STORE_PATH, content)


def _write_atomic(filepath: Path, content: str) -> None:
    """Write *content* to *filepath* atomically via temp-file + rename."""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=filepath.parent, prefix=f".{filepath.name}.tmp.", suffix=""
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, filepath)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Project lookup
# ---------------------------------------------------------------------------


def _find_project(project_id: str) -> dict[str, Any]:
    """Look up a project by ID from the store (and fallback to .aperant-data/projects-state.json).

    Raises :class:`~fastapi.HTTPException` (404) when the project is not
    found.
    """
    store = _load_store()
    for project in store.get("projects", []):
        if project.get("id") == project_id:
            return project
    for candidate in (
        Path("/home/thinhnguyen/.gemini/antigravity-cli/scratch/Aperant/.auto-claude-web/projects.json"),
        Path("/home/thinhnguyen/.gemini/antigravity-cli/scratch/Aperant/.aperant-data/projects-state.json"),
    ):
        if candidate.exists():
            try:
                web_store = json.loads(candidate.read_text(encoding="utf-8"))
                for project in web_store.get("projects", []):
                    if project.get("id") == project_id:
                        return project
            except (json.JSONDecodeError, OSError):
                pass
    raise HTTPException(status_code=404, detail="Project not found")


def _get_registered_project_paths() -> set[str]:
    """Return the set of absolute project paths registered in the store."""
    store = _load_store()
    paths = {p["path"] for p in store.get("projects", []) if "path" in p}
    for candidate in (
        Path("/home/thinhnguyen/.gemini/antigravity-cli/scratch/Aperant/.auto-claude-web/projects.json"),
        Path("/home/thinhnguyen/.gemini/antigravity-cli/scratch/Aperant/.aperant-data/projects-state.json"),
    ):
        if candidate.exists():
            try:
                web_store = json.loads(candidate.read_text(encoding="utf-8"))
                for project in web_store.get("projects", []):
                    if "path" in project:
                        paths.add(project["path"])
            except (json.JSONDecodeError, OSError):
                pass
    return paths


# ---------------------------------------------------------------------------
# Timestamps
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# .env file parsing
# ---------------------------------------------------------------------------


def parse_env_file(path: Path) -> dict[str, str]:
    """Parse a ``.env`` file into a key-value dict.

    Ignores blank lines and comments (lines starting with ``#``).
    Values may optionally be wrapped in single or double quotes.
    """
    result: dict[str, str] = {}
    if not path.exists():
        return result
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                value = value.strip().strip("'\"")
                result[key.strip()] = value
    except OSError:
        pass
    return result


def find_env_file(project: dict[str, Any]) -> Path | None:
    """Find the ``.env`` file inside a project's auto-claude directory.

    Returns ``None`` if no ``.env`` file exists.
    """
    project_path = Path(project["path"])
    auto_build = project.get("autoBuildPath", "")
    if auto_build:
        candidate = project_path / auto_build / ".env"
        if candidate.exists():
            return candidate

    for dirname in _AUTO_CLAUDE_DIRS:
        candidate = project_path / dirname / ".env"
        if candidate.exists():
            return candidate

    return None


def update_env_file(env_path: Path, updates: dict[str, str]) -> None:
    """Update specific keys in a ``.env`` file while preserving comments and
    formatting of untouched lines.

    New keys are appended at the end.
    """
    lines: list[str] = []
    updated_keys: set[str] = set()

    if env_path.exists():
        try:
            original = env_path.read_text(encoding="utf-8")
        except OSError:
            original = ""
        for line in original.splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                key, _, _ = stripped.partition("=")
                key = key.strip()
                if key in updates:
                    lines.append(f"{key}={updates[key]}")
                    updated_keys.add(key)
                else:
                    lines.append(line)
            else:
                lines.append(line)

    # Append any new keys that were not already present
    for key, value in updates.items():
        if key not in updated_keys:
            lines.append(f"{key}={value}")

    env_path.parent.mkdir(parents=True, exist_ok=True)
    _write_atomic(env_path, "\n".join(lines) + "\n")
