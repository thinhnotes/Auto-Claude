"""
Tasks Router
============

API endpoints for managing tasks (specs) within projects.
"""

import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from cli.spec_commands import list_specs
from cli.utils import find_spec, get_specs_dir
from progress import count_subtasks
from workspace import get_existing_build_worktree

from .projects import load_projects

router = APIRouter()
logger = logging.getLogger("auto-claude-api")

# Track running task PIDs (not process objects - tasks run detached)
# Maps task_id -> {"pid": int, "started_at": str, "log_file": str}
running_tasks: dict[str, dict[str, Any]] = {}

# File to persist running task state (survives server restart)
RUNNING_TASKS_FILE = Path(__file__).parent.parent.parent / ".auto-claude" / "running_tasks.json"


def _load_running_tasks() -> dict[str, dict[str, Any]]:
    """Load persisted running tasks state."""
    if RUNNING_TASKS_FILE.exists():
        try:
            with open(RUNNING_TASKS_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_running_tasks():
    """Persist running tasks state."""
    RUNNING_TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(RUNNING_TASKS_FILE, "w") as f:
        json.dump(running_tasks, f, indent=2)


def _is_process_running(pid: int) -> bool:
    """Check if a process with given PID is still running."""
    try:
        os.kill(pid, 0)  # Signal 0 just checks if process exists
        return True
    except (OSError, ProcessLookupError):
        return False


def _cleanup_finished_tasks():
    """Remove tasks whose processes have finished."""
    global running_tasks
    finished = []
    for task_id, info in running_tasks.items():
        if not _is_process_running(info["pid"]):
            finished.append(task_id)
    for task_id in finished:
        del running_tasks[task_id]
    if finished:
        _save_running_tasks()


# Load persisted state on module import
running_tasks = _load_running_tasks()
_cleanup_finished_tasks()


class TaskCreate(BaseModel):
    """Request model for creating a task."""

    title: Optional[str] = Field(default=None, description="Task title")
    description: str = Field(..., min_length=1, description="Task description")
    complexity: Optional[str] = Field(default=None, description="Complexity: simple, standard, or complex")
    metadata: Optional[dict[str, Any]] = Field(default=None, description="Additional metadata")


class TaskResponse(BaseModel):
    """Response model for a task."""

    id: str
    name: str
    folder: str
    status: str
    progress: str
    has_build: bool
    project_id: str
    created_at: Optional[str] = None
    spec_content: Optional[str] = None


class TaskListResponse(BaseModel):
    """Response model for listing tasks."""

    tasks: list[TaskResponse]
    total: int


class TaskStartRequest(BaseModel):
    """Request model for starting a task."""

    auto_continue: bool = Field(default=True, description="Auto-continue existing builds")
    skip_qa: bool = Field(default=False, description="Skip QA validation")
    model: Optional[str] = Field(default=None, description="Model to use")


class TaskLogsResponse(BaseModel):
    """Response model for task logs."""

    task_id: str
    logs: list[str]
    is_running: bool


def get_project_path(project_id: str) -> Path:
    """Get project path from project ID."""
    projects = load_projects()
    for p in projects:
        if p.get("id") == project_id:
            return Path(p.get("path", ""))
    raise HTTPException(status_code=404, detail="Project not found")


def get_task_id(project_id: str, folder: str) -> str:
    """Generate a unique task ID from project and folder."""
    return f"{project_id}:{folder}"


def parse_task_id(task_id: str) -> tuple[str, str]:
    """Parse task ID into project_id and folder."""
    parts = task_id.split(":", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid task ID format")
    return parts[0], parts[1]


@router.get("/projects/{project_id}/tasks")
async def list_tasks(project_id: str) -> dict:
    """List all tasks (specs) for a project."""
    project_path = get_project_path(project_id)

    if not project_path.exists():
        return {"success": True, "data": []}

    try:
        specs = list_specs(project_path)
    except Exception as e:
        logger.error(f"Error listing specs: {e}")
        # No specs directory or other error
        return {"success": True, "data": []}

    tasks = []
    for spec in specs:
        task_id = get_task_id(project_id, spec["folder"])
        spec_file = spec["path"] / "spec.md"
        
        # Read description from spec.md
        description = ""
        if spec_file.exists():
            try:
                content = spec_file.read_text()
                # Extract description section
                if "## Description" in content:
                    desc_start = content.find("## Description")
                    desc_content = content[desc_start + len("## Description"):].strip()
                    # Find next section or end
                    next_section = desc_content.find("\n##")
                    if next_section > 0:
                        description = desc_content[:next_section].strip()
                    else:
                        description = desc_content.strip()
            except Exception:
                pass
        
        created_at = None
        updated_at = None
        if spec_file.exists():
            stat = spec_file.stat()
            created_at = datetime.fromtimestamp(stat.st_mtime).isoformat()
            updated_at = created_at

        # Check if task is currently running
        is_running = False
        if task_id in running_tasks:
            is_running = _is_process_running(running_tasks[task_id]["pid"])
            if not is_running:
                # Clean up stale entry
                del running_tasks[task_id]
                _save_running_tasks()

        # Load subtasks and plan from implementation_plan.json
        subtasks = []
        plan = None
        plan_file = spec["path"] / "implementation_plan.json"
        if plan_file.exists():
            try:
                plan = json.loads(plan_file.read_text())
                for phase in plan.get("phases", []):
                    for subtask in phase.get("subtasks", []):
                        subtasks.append({
                            "id": subtask.get("id", ""),
                            "title": subtask.get("description", subtask.get("title", "")),
                            "description": subtask.get("description", ""),
                            "status": subtask.get("status", "pending"),
                            "files": subtask.get("files", []),
                        })
            except Exception as e:
                logger.error(f"Error loading subtasks: {e}")

        # Calculate status based on subtask states (matching Electron app logic)
        # Frontend uses: 'backlog' | 'in_progress' | 'ai_review' | 'human_review' | 'done'
        frontend_status = "backlog"
        review_reason = None
        
        if is_running:
            # Task is actively running
            frontend_status = "in_progress"
        elif len(subtasks) > 0:
            completed = sum(1 for s in subtasks if s.get("status") == "completed")
            in_progress = sum(1 for s in subtasks if s.get("status") == "in_progress")
            failed = sum(1 for s in subtasks if s.get("status") == "failed")
            
            if completed == len(subtasks):
                # All subtasks completed - check QA status
                qa_signoff = plan.get("qa_signoff", {}) if plan else {}
                if qa_signoff.get("status") == "approved":
                    frontend_status = "human_review"
                    review_reason = "completed"
                else:
                    # Default to ai_review when all subtasks complete
                    frontend_status = "ai_review"
            elif failed > 0:
                # Some subtasks failed - needs human attention
                frontend_status = "human_review"
                review_reason = "errors"
            elif in_progress > 0 or completed > 0:
                frontend_status = "in_progress"
        else:
            # No subtasks yet - check raw status from list_specs
            status = spec["status"]
            if "pending" in status or "initialized" in status:
                frontend_status = "backlog"
            elif "in_progress" in status or "planning" in status or "coding" in status:
                frontend_status = "in_progress"
            elif "complete" in status:
                frontend_status = "done"
            elif "review" in status.lower():
                frontend_status = "human_review" if "human" in status.lower() else "ai_review"
        
        # Check for explicit status in plan that overrides calculated status
        if plan and plan.get("status"):
            plan_status = plan["status"]
            status_map = {
                "pending": "backlog",
                "planning": "in_progress",
                "in_progress": "in_progress",
                "coding": "in_progress",
                "review": "ai_review",
                "completed": "done",
                "done": "done",
                "human_review": "human_review",
                "ai_review": "ai_review",
                "backlog": "backlog"
            }
            if plan_status in status_map:
                # User explicitly marked as done - respect that
                if status_map[plan_status] == "done":
                    frontend_status = "done"
                # Human review from plan takes precedence
                elif status_map[plan_status] == "human_review":
                    frontend_status = "human_review"

        tasks.append({
            "id": task_id,
            "specId": spec["folder"],
            "projectId": project_id,
            "title": spec["name"],
            "description": description,
            "status": frontend_status,
            "subtasks": subtasks,
            "logs": [],
            "folder": spec["folder"],
            "progress": spec["progress"],
            "has_build": spec["has_build"],
            "createdAt": created_at,
            "updatedAt": updated_at,
            "isRunning": is_running,
            "reviewReason": review_reason,
        })

    logger.info(f"📋 Returning {len(tasks)} tasks for project {project_id}")
    return {"success": True, "data": tasks}


@router.post("/projects/{project_id}/tasks", status_code=201)
async def create_task(
    project_id: str,
    task: TaskCreate,
    background_tasks: BackgroundTasks,
) -> dict:
    """Create a new task (spec) for a project.
    
    This only creates the spec folder with spec.md - it does NOT run the full
    spec creation pipeline. The full pipeline runs when the user starts the task.
    """
    try:
        project_path = get_project_path(project_id)

        if not project_path.exists():
            raise HTTPException(status_code=404, detail="Project path does not exist")

        # Use title + description or just description
        task_text = f"{task.title}: {task.description}" if task.title else task.description
        task_name = task.title or task.description[:50]

        logger.info(f"📝 Creating task for project {project_id}")
        logger.info(f"📂 Project path: {project_path}")
        logger.info(f"📋 Task: {task_text[:100]}...")

        # Get specs directory
        specs_dir = get_specs_dir(project_path)
        specs_dir.mkdir(parents=True, exist_ok=True)

        # Find next spec number
        existing_specs = list(specs_dir.glob("*"))
        existing_numbers = []
        for spec in existing_specs:
            if spec.is_dir():
                try:
                    num = int(spec.name.split("-")[0])
                    existing_numbers.append(num)
                except (ValueError, IndexError):
                    pass
        next_num = max(existing_numbers, default=0) + 1

        # Create spec folder name (e.g., "001-add-login")
        safe_name = "".join(c if c.isalnum() or c in "-_" else "-" for c in task_name.lower())
        safe_name = "-".join(filter(None, safe_name.split("-")))[:50]
        folder_name = f"{next_num:03d}-{safe_name}"
        spec_dir = specs_dir / folder_name
        spec_dir.mkdir(parents=True, exist_ok=True)

        # Create minimal spec.md
        spec_content = f"""# {task_name}

## Description

{task.description}

## Status

Pending - run build to start implementation.
"""
        spec_file = spec_dir / "spec.md"
        spec_file.write_text(spec_content)

        task_id = get_task_id(project_id, folder_name)
        now = datetime.utcnow().isoformat()

        logger.info(f"✅ Task created: {task_id} at {spec_dir}")

        return {
            "success": True,
            "data": {
                "id": task_id,
                "specId": folder_name,
                "projectId": project_id,
                "title": task_name,
                "description": task.description,
                "status": "backlog",  # New tasks go to Planning/Backlog column
                "subtasks": [],
                "logs": [],
                "folder": folder_name,
                "progress": "-",
                "has_build": False,
                "createdAt": now,
                "updatedAt": now,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Unexpected error creating task: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str) -> TaskResponse:
    """Get details of a specific task."""
    project_id, folder = parse_task_id(task_id)
    project_path = get_project_path(project_id)

    spec_dir = find_spec(project_path, folder)
    if not spec_dir:
        raise HTTPException(status_code=404, detail="Task not found")

    has_build = get_existing_build_worktree(project_path, folder) is not None
    plan_file = spec_dir / "implementation_plan.json"

    status = "pending"
    progress = "-"

    if plan_file.exists():
        completed, total = count_subtasks(spec_dir)
        if total > 0:
            status = "complete" if completed == total else "in_progress"
            progress = f"{completed}/{total}"
        else:
            status = "initialized"
            progress = "0/0"

    if has_build:
        status = f"{status} (has build)"

    spec_content = None
    spec_file = spec_dir / "spec.md"
    if spec_file.exists():
        spec_content = spec_file.read_text()

    parts = folder.split("-", 1)
    name = parts[1] if len(parts) == 2 else folder

    created_at = None
    if spec_file.exists():
        created_at = datetime.fromtimestamp(spec_file.stat().st_mtime).isoformat()

    return TaskResponse(
        id=task_id,
        name=name,
        folder=folder,
        status=status,
        progress=progress,
        has_build=has_build,
        project_id=project_id,
        created_at=created_at,
        spec_content=spec_content,
    )


@router.get("/projects/{project_id}/tasks/{spec_id}/plan")
async def get_task_plan(project_id: str, spec_id: str) -> dict[str, Any]:
    """Get the implementation plan (subtasks) for a task."""
    project_path = get_project_path(project_id)
    spec_dir = find_spec(project_path, spec_id)
    
    if not spec_dir:
        raise HTTPException(status_code=404, detail="Task not found")
    
    plan_file = spec_dir / "implementation_plan.json"
    
    if not plan_file.exists():
        return {"success": True, "data": None}
    
    try:
        plan = json.loads(plan_file.read_text())
        return {"success": True, "data": plan}
    except Exception as e:
        logger.error(f"Error reading implementation plan: {e}")
        return {"success": False, "error": str(e)}


@router.post("/tasks/{task_id}/start")
async def start_task(task_id: str, request: TaskStartRequest) -> dict[str, Any]:
    """Start running a task (build) as a detached background process.
    
    The task runs independently of the web server - it continues even if:
    - The browser is closed
    - The API server restarts
    
    Logs are written to the spec directory for later retrieval.
    """
    _cleanup_finished_tasks()  # Clean up any finished tasks first
    
    project_id, folder = parse_task_id(task_id)
    project_path = get_project_path(project_id)

    spec_dir = find_spec(project_path, folder)
    if not spec_dir:
        raise HTTPException(status_code=404, detail="Task not found")

    # Check if already running (by PID check, not just dict presence)
    if task_id in running_tasks:
        if _is_process_running(running_tasks[task_id]["pid"]):
            return {"status": "already_running", "task_id": task_id, "pid": running_tasks[task_id]["pid"]}
        else:
            # Process finished, clean up stale entry
            del running_tasks[task_id]

    backend_dir = Path(__file__).parent.parent.parent
    run_script = backend_dir / "run.py"

    # Create log file in spec directory
    log_file = spec_dir / "build.log"
    
    cmd = [
        sys.executable,
        str(run_script),
        "--spec",
        folder,
        "--project-dir",
        str(project_path),
    ]

    if request.auto_continue:
        cmd.append("--auto-continue")
    if request.skip_qa:
        cmd.append("--skip-qa")
    if request.model:
        cmd.extend(["--model", request.model])

    logger.info(f"🚀 Starting background task: {task_id}")
    logger.info(f"   Command: {' '.join(cmd)}")
    logger.info(f"   Log file: {log_file}")

    # Start as detached background process
    # - start_new_session=True: Creates new process group (survives parent death)
    # - stdout/stderr to file: Logs persist for later retrieval
    with open(log_file, "a") as log_handle:
        log_handle.write(f"\n{'='*60}\n")
        log_handle.write(f"Task started at: {datetime.utcnow().isoformat()}\n")
        log_handle.write(f"Command: {' '.join(cmd)}\n")
        log_handle.write(f"{'='*60}\n\n")
        log_handle.flush()
        
        process = subprocess.Popen(
            cmd,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # Detach from parent process group
            cwd=str(project_path),
            env={**os.environ, "PYTHONUNBUFFERED": "1"},  # Ensure real-time logging
        )

    # Track the running task
    running_tasks[task_id] = {
        "pid": process.pid,
        "started_at": datetime.utcnow().isoformat(),
        "log_file": str(log_file),
        "project_id": project_id,
        "folder": folder,
    }
    _save_running_tasks()

    logger.info(f"✅ Task {task_id} started with PID {process.pid}")

    return {
        "status": "started", 
        "task_id": task_id, 
        "pid": process.pid,
        "log_file": str(log_file),
        "message": "Task running in background. You can close the browser safely."
    }


@router.post("/tasks/{task_id}/stop")
async def stop_task(task_id: str) -> dict[str, Any]:
    """Stop a running background task."""
    _cleanup_finished_tasks()
    
    if task_id not in running_tasks:
        return {"status": "not_running", "task_id": task_id}

    task_info = running_tasks[task_id]
    pid = task_info["pid"]
    
    if not _is_process_running(pid):
        del running_tasks[task_id]
        _save_running_tasks()
        return {"status": "already_finished", "task_id": task_id}

    try:
        # Send SIGTERM to the process group (kills all child processes too)
        os.killpg(os.getpgid(pid), signal.SIGTERM)
        logger.info(f"🛑 Sent SIGTERM to task {task_id} (PID {pid})")
        
        # Wait a bit for graceful shutdown
        await asyncio.sleep(2)
        
        # Force kill if still running
        if _is_process_running(pid):
            os.killpg(os.getpgid(pid), signal.SIGKILL)
            logger.info(f"💀 Force killed task {task_id} (PID {pid})")
    except (OSError, ProcessLookupError) as e:
        logger.warning(f"Error stopping task {task_id}: {e}")

    del running_tasks[task_id]
    _save_running_tasks()
    
    return {"status": "stopped", "task_id": task_id}


@router.get("/tasks/{task_id}/status")
async def get_task_status(task_id: str) -> dict[str, Any]:
    """Get the running status of a task."""
    _cleanup_finished_tasks()
    
    if task_id in running_tasks:
        task_info = running_tasks[task_id]
        is_running = _is_process_running(task_info["pid"])
        return {
            "task_id": task_id,
            "is_running": is_running,
            "pid": task_info["pid"],
            "started_at": task_info["started_at"],
            "log_file": task_info["log_file"],
        }
    
    return {
        "task_id": task_id,
        "is_running": False,
        "pid": None,
    }


class TaskStatusUpdate(BaseModel):
    """Request model for updating task status."""
    status: str = Field(..., description="New status: backlog, in_progress, ai_review, human_review, done")


@router.patch("/tasks/{task_id}/status")
async def update_task_status(task_id: str, update: TaskStatusUpdate) -> dict[str, Any]:
    """Update the status of a task.
    
    Note: This updates the frontend display status. The actual task state
    is determined by the implementation_plan.json and running process status.
    """
    project_id, folder = parse_task_id(task_id)
    project_path = get_project_path(project_id)
    
    spec_dir = find_spec(project_path, folder)
    if not spec_dir:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # For now, we just acknowledge the status update
    # The real status is computed from implementation_plan.json when listing tasks
    logger.info(f"📝 Status update for {task_id}: {update.status}")
    
    return {
        "success": True,
        "task_id": task_id,
        "status": update.status,
    }


@router.get("/tasks/{task_id}/logs", response_model=TaskLogsResponse)
async def get_task_logs(task_id: str, lines: int = 100) -> TaskLogsResponse:
    """Get logs for a task from persistent log files."""
    _cleanup_finished_tasks()
    
    project_id, folder = parse_task_id(task_id)
    project_path = get_project_path(project_id)

    spec_dir = find_spec(project_path, folder)
    if not spec_dir:
        raise HTTPException(status_code=404, detail="Task not found")

    logs = []
    
    # Check if task is currently running
    is_running = False
    if task_id in running_tasks:
        is_running = _is_process_running(running_tasks[task_id]["pid"])

    # Read from persistent log files
    log_files = [
        spec_dir / "build.log",
        spec_dir / "qa_report.md",
        spec_dir / "QA_FIX_REQUEST.md",
    ]

    for log_file in log_files:
        if log_file.exists():
            try:
                content = log_file.read_text()
                log_lines = content.split("\n")
                # Get last N lines from each file
                logs.extend([f"[{log_file.name}] {line}" for line in log_lines[-lines:] if line.strip()])
            except Exception:
                pass

    return TaskLogsResponse(task_id=task_id, logs=logs[-lines:], is_running=is_running)


@router.get("/projects/{project_id}/tasks/{spec_id}/logs")
async def get_task_logs_detailed(project_id: str, spec_id: str) -> dict[str, Any]:
    """Get detailed phase-based logs for a task (for task detail panel).
    
    Returns logs structured by phase (planning, coding, validation) for the UI.
    """
    project_path = get_project_path(project_id)
    spec_dir = find_spec(project_path, spec_id)
    
    if not spec_dir:
        raise HTTPException(status_code=404, detail="Task not found")
    
    now = datetime.utcnow().isoformat()
    
    # Build phase logs structure
    phases = {
        "planning": {
            "phase": "planning",
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "entries": []
        },
        "coding": {
            "phase": "coding", 
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "entries": []
        },
        "validation": {
            "phase": "validation",
            "status": "pending", 
            "started_at": None,
            "completed_at": None,
            "entries": []
        }
    }
    
    # Read build.log and parse into phases
    build_log = spec_dir / "build.log"
    if build_log.exists():
        try:
            content = build_log.read_text()
            lines = content.split("\n")
            
            current_phase = "planning"
            for i, line in enumerate(lines):
                if not line.strip():
                    continue
                    
                # Detect phase transitions from log content
                line_lower = line.lower()
                if "planning" in line_lower or "planner" in line_lower:
                    current_phase = "planning"
                    if phases["planning"]["status"] == "pending":
                        phases["planning"]["status"] = "active"
                        phases["planning"]["started_at"] = now
                elif "coding" in line_lower or "coder" in line_lower or "implement" in line_lower:
                    current_phase = "coding"
                    if phases["planning"]["status"] == "active":
                        phases["planning"]["status"] = "completed"
                        phases["planning"]["completed_at"] = now
                    if phases["coding"]["status"] == "pending":
                        phases["coding"]["status"] = "active"
                        phases["coding"]["started_at"] = now
                elif "qa" in line_lower or "validation" in line_lower or "review" in line_lower:
                    current_phase = "validation"
                    if phases["coding"]["status"] == "active":
                        phases["coding"]["status"] = "completed"
                        phases["coding"]["completed_at"] = now
                    if phases["validation"]["status"] == "pending":
                        phases["validation"]["status"] = "active"
                        phases["validation"]["started_at"] = now
                
                # Add entry to current phase
                entry = {
                    "type": "text",
                    "content": line,
                    "timestamp": now,
                }
                phases[current_phase]["entries"].append(entry)
                
        except Exception as e:
            logger.error(f"Error reading build log: {e}")
    
    # Check implementation plan for more accurate status
    plan_file = spec_dir / "implementation_plan.json"
    if plan_file.exists():
        try:
            plan = json.loads(plan_file.read_text())
            if plan.get("phases"):
                phases["planning"]["status"] = "completed"
                phases["planning"]["completed_at"] = now
        except Exception:
            pass
    
    # Check QA report for validation status
    qa_report = spec_dir / "qa_report.md"
    if qa_report.exists():
        phases["validation"]["status"] = "completed"
        phases["validation"]["completed_at"] = now
        try:
            content = qa_report.read_text()
            phases["validation"]["entries"].append({
                "type": "text",
                "content": content[:2000],  # Limit size
                "timestamp": now,
            })
        except Exception:
            pass
    
    return {
        "success": True,
        "data": {
            "spec_id": spec_id,
            "created_at": now,
            "updated_at": now,
            "phases": phases
        }
    }
