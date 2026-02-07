"""
WebSocket Handlers - Environment Configuration

Provides WebSocket handlers for project environment configuration.
"""
from typing import Any
import json
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


async def handle_get_env(params: dict[str, Any]) -> dict[str, Any]:
    """Get project environment configuration.

    Args:
        params: Dict containing:
            - projectId: Project identifier

    Returns:
        Dict with success status and environment config or error
    """
    project_id = params.get("projectId")
    if not project_id:
        return {"success": False, "error": "Missing projectId"}

    try:
        from web.routers.tasks import get_project_path

        project_path = get_project_path(project_id)
        env_file = project_path / ".auto-claude" / "project_env.json"

        if not env_file.exists():
            return {"success": True, "data": {}}

        with open(env_file, "r") as f:
            data = json.load(f)

        return {"success": True, "data": data}

    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in project_env.json for project {project_id}: {e}")
        return {"success": False, "error": "Invalid JSON in environment file"}
    except Exception as e:
        logger.error(f"Error getting environment config for project {project_id}: {e}")
        return {"success": False, "error": str(e)}


async def handle_update_env(params: dict[str, Any]) -> dict[str, Any]:
    """Update project environment configuration.

    Args:
        params: Dict containing:
            - projectId: Project identifier
            - config: Environment configuration dict

    Returns:
        Dict with success status or error
    """
    project_id = params.get("projectId")
    config = params.get("config")

    if not project_id or config is None:
        return {"success": False, "error": "Missing projectId or config"}

    try:
        from web.routers.tasks import get_project_path

        project_path = get_project_path(project_id)
        env_dir = project_path / ".auto-claude"
        env_dir.mkdir(parents=True, exist_ok=True)
        env_file = env_dir / "project_env.json"

        with open(env_file, "w") as f:
            json.dump(config, f, indent=2)

        return {"success": True}

    except Exception as e:
        logger.error(f"Error updating environment config for project {project_id}: {e}")
        return {"success": False, "error": str(e)}
