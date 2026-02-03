"""
WebSocket Handlers - Projects
=============================

Request handlers for project operations.
"""

import sys
import json
from pathlib import Path
from typing import Any

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))


def get_projects_file() -> Path:
    """Get the path to the projects file."""
    config_dir = Path.home() / ".auto-claude"
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "projects.json"


def load_projects() -> list:
    """Load projects from file."""
    projects_file = get_projects_file()
    if not projects_file.exists():
        return []
    try:
        with open(projects_file) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def save_projects(projects: list) -> None:
    """Save projects to file."""
    projects_file = get_projects_file()
    with open(projects_file, "w") as f:
        json.dump(projects, f, indent=2)


async def handle_get_projects(params: dict[str, Any]) -> dict[str, Any]:
    """Get all projects."""
    projects = load_projects()
    return {"success": True, "data": projects}


async def handle_add_project(params: dict[str, Any]) -> dict[str, Any]:
    """Add a new project."""
    import uuid
    import time
    
    name = params.get("name")
    path = params.get("path")
    
    if not path:
        return {"success": False, "error": "Missing path parameter"}
    
    if not name:
        # Derive name from path
        path_parts = path.replace("/", "").split("/")
        name = path_parts[-1] or "Untitled Project"
    
    projects = load_projects()
    
    # Check if project already exists
    if any(p.get("path") == path for p in projects):
        return {"success": False, "error": "Project already exists"}
    
    # Create new project entry
    project = {
        "id": str(uuid.uuid4()),
        "name": name,
        "path": path,
        "createdAt": int(time.time() * 1000),
        "settings": {}
    }
    
    projects.append(project)
    save_projects(projects)
    
    return {"success": True, "data": project}


async def handle_remove_project(params: dict[str, Any]) -> dict[str, Any]:
    """Remove a project."""
    project_id = params.get("projectId")
    
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    projects = load_projects()
    original_count = len(projects)
    
    projects = [p for p in projects if p.get("id") != project_id]
    
    if len(projects) == original_count:
        return {"success": False, "error": "Project not found"}
    
    save_projects(projects)
    return {"success": True}


async def handle_update_project_settings(params: dict[str, Any]) -> dict[str, Any]:
    """Update project settings."""
    project_id = params.get("projectId")
    settings = params.get("settings", {})
    
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    projects = load_projects()
    project = next((p for p in projects if p.get("id") == project_id), None)
    
    if not project:
        return {"success": False, "error": "Project not found"}
    
    # Update settings
    if "settings" not in project:
        project["settings"] = {}
    
    project["settings"].update(settings)
    save_projects(projects)
    
    return {"success": True, "data": project}


async def handle_initialize_project(params: dict[str, Any]) -> dict[str, Any]:
    """Initialize a project."""
    project_id = params.get("projectId")
    
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    # TODO: Implement actual initialization logic
    # This would initialize .auto-claude directory, etc.
    
    return {"success": True, "data": {"initialized": True}}


async def handle_check_project_version(params: dict[str, Any]) -> dict[str, Any]:
    """Check project version."""
    project_id = params.get("projectId")
    
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    # TODO: Implement version checking logic
    
    return {"success": True, "data": {"version": "1.0.0", "needsUpdate": False}}


async def handle_get_available_projects(params: dict[str, Any]) -> dict[str, Any]:
    """Get available projects from /home/code."""
    import os
    
    code_dir = Path("/home/code")
    
    if not code_dir.exists():
        return {"success": True, "data": []}
    
    available = []
    try:
        for entry in code_dir.iterdir():
            if entry.is_dir() and not entry.name.startswith("."):
                available.append({
                    "name": entry.name,
                    "path": str(entry)
                })
    except PermissionError:
        pass
    
    return {"success": True, "data": available}


async def handle_create_project_folder(params: dict[str, Any]) -> dict[str, Any]:
    """Create a new project folder."""
    location = params.get("location")
    name = params.get("name")
    init_git = params.get("initGit", False)
    
    if not location or not name:
        return {"success": False, "error": "Missing location or name parameter"}
    
    import subprocess
    
    project_path = Path(location) / name
    
    try:
        # Create directory
        project_path.mkdir(parents=True, exist_ok=False)
        
        git_initialized = False
        if init_git:
            try:
                subprocess.run(
                    ["git", "init"],
                    cwd=str(project_path),
                    check=True,
                    capture_output=True
                )
                git_initialized = True
            except Exception:
                pass
        
        return {
            "success": True,
            "data": {
                "path": str(project_path),
                "name": name,
                "gitInitialized": git_initialized
            }
        }
        
    except FileExistsError:
        return {"success": False, "error": "Folder already exists"}
    except Exception as e:
        return {"success": False, "error": str(e)}
