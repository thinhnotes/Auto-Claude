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


# Directories to create inside .auto-claude (same as routers/projects.py)
DATA_DIRECTORIES = ["specs", "ideation", "insights", "roadmap"]

# Entries to add to .gitignore
GITIGNORE_ENTRIES = [".auto-claude/"]


def ensure_gitignore_entries(project_path: Path, entries: list[str]) -> None:
    """Ensure entries exist in .gitignore file."""
    gitignore_path = project_path / ".gitignore"

    existing_content = ""
    if gitignore_path.exists():
        existing_content = gitignore_path.read_text()

    lines_to_add = []
    for entry in entries:
        if entry not in existing_content:
            lines_to_add.append(entry)

    if lines_to_add:
        with open(gitignore_path, "a") as f:
            if existing_content and not existing_content.endswith("\n"):
                f.write("\n")
            f.write("\n# Auto Claude\n")
            for line in lines_to_add:
                f.write(f"{line}\n")


def check_git_status(project_path: Path) -> dict:
    """Check if project is a git repo with at least one commit."""
    import subprocess

    git_dir = project_path / ".git"
    if not git_dir.exists():
        return {
            "isGitRepo": False,
            "hasCommits": False,
            "error": "Not a git repository. Auto Claude requires git for worktree-based builds.",
        }

    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=project_path,
            capture_output=True,
            text=True,
        )
        has_commits = result.returncode == 0

        return {
            "isGitRepo": True,
            "hasCommits": has_commits,
            "error": None
            if has_commits
            else "No commits found. Please make at least one commit before initializing.",
        }
    except Exception as e:
        return {"isGitRepo": True, "hasCommits": False, "error": str(e)}


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
    """Initialize a project.
    
    Creates the .auto-claude directory structure and updates .gitignore.
    Requires the project to be a git repository with at least one commit.
    """
    project_id = params.get("projectId")
    
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    projects = load_projects()
    
    project = None
    for p in projects:
        if p.get("id") == project_id:
            project = p
            break
    
    if not project:
        return {"success": False, "error": "Project not found"}
    
    project_path = Path(project.get("path", ""))
    
    if not project_path.exists():
        return {"success": False, "error": f"Project directory not found: {project_path}"}
    
    # Check git status
    git_status = check_git_status(project_path)
    if not git_status["isGitRepo"] or not git_status["hasCommits"]:
        return {
            "success": False,
            "error": git_status.get(
                "error", "Git repository with at least one commit is required."
            ),
        }
    
    # Check if already initialized
    auto_claude_path = project_path / ".auto-claude"
    
    if auto_claude_path.exists():
        # Already initialized
        project["autoBuildPath"] = ".auto-claude"
        save_projects(projects)
        return {
            "success": True,
            "data": {
                "message": "Project already initialized",
                "autoBuildPath": ".auto-claude",
                "initialized": True,
            },
        }
    
    try:
        # Create .auto-claude directory
        auto_claude_path.mkdir(parents=True, exist_ok=True)
        
        # Create data directories
        for data_dir in DATA_DIRECTORIES:
            dir_path = auto_claude_path / data_dir
            dir_path.mkdir(parents=True, exist_ok=True)
            (dir_path / ".gitkeep").touch()
        
        # Update .gitignore
        ensure_gitignore_entries(project_path, GITIGNORE_ENTRIES)
        
        # Update project with autoBuildPath
        project["autoBuildPath"] = ".auto-claude"
        save_projects(projects)
        
        return {
            "success": True,
            "data": {
                "message": "Project initialized successfully",
                "autoBuildPath": ".auto-claude",
                "initialized": True,
            },
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_check_project_version(params: dict[str, Any]) -> dict[str, Any]:
    """Check project version.
    
    Returns version info for the project's .auto-claude installation.
    """
    project_id = params.get("projectId")
    
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    projects = load_projects()
    
    for p in projects:
        if p.get("id") == project_id:
            project_path = Path(p.get("path", ""))
            auto_claude_path = project_path / ".auto-claude"
            
            if not auto_claude_path.exists():
                return {
                    "success": True,
                    "data": {"initialized": False, "version": None, "needsUpdate": False},
                }
            
            return {
                "success": True,
                "data": {
                    "initialized": True,
                    "version": "1.0.0",  # Current version
                    "autoBuildPath": ".auto-claude",
                    "needsUpdate": False,
                },
            }
    
    return {"success": False, "error": "Project not found"}


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
