"""
WebSocket Handlers - Git Operations

Provides WebSocket handlers for git-related operations.
"""
from typing import Any
import logging

logger = logging.getLogger(__name__)


async def handle_get_branches(params: dict[str, Any]) -> dict[str, Any]:
    """Get list of git branches.

    Args:
        params: Dict containing:
            - projectPath: Path to project

    Returns:
        Dict with success status and branch list or error
    """
    project_path = params.get("projectPath")
    if not project_path:
        return {"success": False, "error": "Missing projectPath"}

    try:
        from web.routers.git import get_git_branches
        return await get_git_branches(project_path)
    except Exception as e:
        logger.error(f"Error getting git branches: {e}")
        return {"success": False, "error": str(e)}


async def handle_get_current_branch(params: dict[str, Any]) -> dict[str, Any]:
    """Get current git branch.

    Args:
        params: Dict containing:
            - projectPath: Path to project

    Returns:
        Dict with success status and current branch or error
    """
    project_path = params.get("projectPath")
    if not project_path:
        return {"success": False, "error": "Missing projectPath"}

    try:
        from web.routers.git import get_current_git_branch
        return await get_current_git_branch(project_path)
    except Exception as e:
        logger.error(f"Error getting current git branch: {e}")
        return {"success": False, "error": str(e)}


async def handle_detect_main_branch(params: dict[str, Any]) -> dict[str, Any]:
    """Detect main branch (main/master).

    Args:
        params: Dict containing:
            - projectPath: Path to project

    Returns:
        Dict with success status and main branch name or error
    """
    project_path = params.get("projectPath")
    if not project_path:
        return {"success": False, "error": "Missing projectPath"}

    try:
        from web.routers.git import detect_main_branch
        return await detect_main_branch(project_path)
    except Exception as e:
        logger.error(f"Error detecting main branch: {e}")
        return {"success": False, "error": str(e)}


async def handle_git_status(params: dict[str, Any]) -> dict[str, Any]:
    """Get git status.

    Args:
        params: Dict containing:
            - projectPath: Path to project

    Returns:
        Dict with success status and git status or error
    """
    project_path = params.get("projectPath")
    if not project_path:
        return {"success": False, "error": "Missing projectPath"}

    try:
        from web.routers.git import check_git_status
        return await check_git_status(project_path)
    except Exception as e:
        logger.error(f"Error getting git status: {e}")
        return {"success": False, "error": str(e)}


async def handle_git_init(params: dict[str, Any]) -> dict[str, Any]:
    """Initialize git repository.

    Args:
        params: Dict containing:
            - path: Path to initialize git in

    Returns:
        Dict with success status or error
    """
    path = params.get("path")
    if not path:
        return {"success": False, "error": "Missing path"}

    try:
        from web.routers.git import initialize_git
        from pydantic import BaseModel

        class GitInitRequest(BaseModel):
            path: str

        request = GitInitRequest(path=path)
        return await initialize_git(request)
    except Exception as e:
        logger.error(f"Error initializing git: {e}")
        return {"success": False, "error": str(e)}
