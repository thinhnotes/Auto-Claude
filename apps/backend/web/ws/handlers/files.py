"""
WebSocket Handlers - File Operations

Provides WebSocket handlers for file browsing and reading operations.
"""
from typing import Any
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


async def handle_list_files(params: dict[str, Any]) -> dict[str, Any]:
    """List files in a task's spec directory.

    Args:
        params: Dict containing:
            - projectId: Project identifier
            - specId: Spec identifier

    Returns:
        Dict with success status and file list or error
    """
    project_id = params.get("projectId")
    spec_id = params.get("specId")

    if not project_id or not spec_id:
        return {"success": False, "error": "Missing projectId or specId"}

    try:
        # Import here to avoid circular imports
        from web.routers.tasks import get_project_path

        project_path = get_project_path(project_id)
        spec_dir = project_path / ".auto-claude" / "specs" / spec_id

        if not spec_dir.exists():
            return {"success": False, "error": f"Spec directory not found: {spec_id}"}

        # List all files in the spec directory
        files = []
        for file_path in spec_dir.rglob("*"):
            if file_path.is_file():
                relative_path = file_path.relative_to(spec_dir)
                files.append({
                    "path": str(relative_path),
                    "name": file_path.name,
                    "size": file_path.stat().st_size,
                })

        return {"success": True, "data": {"files": files}}

    except Exception as e:
        logger.error(f"Error listing files for spec {spec_id}: {e}")
        return {"success": False, "error": str(e)}


async def handle_get_file_content(params: dict[str, Any]) -> dict[str, Any]:
    """Get content of a specific file.

    Args:
        params: Dict containing:
            - projectId: Project identifier
            - specId: Spec identifier
            - filePath: Path to file relative to spec directory

    Returns:
        Dict with success status and file content or error
    """
    project_id = params.get("projectId")
    spec_id = params.get("specId")
    file_path = params.get("filePath")

    if not all([project_id, spec_id, file_path]):
        return {"success": False, "error": "Missing required parameters"}

    try:
        # Import here to avoid circular imports
        from web.routers.tasks import get_project_path

        project_path = get_project_path(project_id)
        spec_dir = project_path / ".auto-claude" / "specs" / spec_id
        full_path = spec_dir / file_path

        # Security check: ensure path is within spec directory
        if not str(full_path.resolve()).startswith(str(spec_dir.resolve())):
            return {"success": False, "error": "Invalid file path"}

        if not full_path.exists():
            return {"success": False, "error": f"File not found: {file_path}"}

        if not full_path.is_file():
            return {"success": False, "error": f"Not a file: {file_path}"}

        # Read file content
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()

        return {"success": True, "data": {"content": content, "path": file_path}}

    except UnicodeDecodeError:
        return {"success": False, "error": "File is not a text file"}
    except Exception as e:
        logger.error(f"Error reading file {file_path} for spec {spec_id}: {e}")
        return {"success": False, "error": str(e)}
