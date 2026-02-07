"""
WebSocket Handlers - Tasks
==========================

Request handlers for task operations.
"""

import sys
from pathlib import Path
from typing import Any
from datetime import datetime

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

# Import from routers (reuse existing logic)
import asyncio
import json
import os
import shutil
import signal
import subprocess

from cli.spec_commands import list_specs
from cli.utils import find_spec, get_specs_dir
from core.worktree import WorktreeManager
from web.routers.projects import load_projects, save_projects
from web.routers.tasks import (
    get_project_path,
    get_task_id,
    parse_task_id,
    running_tasks,
    _is_process_running,
    _save_running_tasks,
    _cleanup_finished_tasks,
)
from web.utils.plan_helpers import load_plan_from_spec


async def handle_get_tasks(params: dict[str, Any]) -> dict[str, Any]:
    """Get all tasks for a project."""
    project_id = params.get("projectId")
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    try:
        project_path = get_project_path(project_id)
        if not project_path.exists():
            return {"success": True, "data": []}
        specs = list_specs(project_path)
        tasks = []
        for spec in specs:
            task_id = get_task_id(project_id, spec["folder"])
            spec_file = spec["path"] / "spec.md"
            
            # Read description from spec.md
            description = ""
            if spec_file.exists():
                try:
                    content = spec_file.read_text()
                    if "## Description" in content:
                        desc_start = content.find("## Description")
                        desc_content = content[desc_start + len("## Description"):].strip()
                        next_section = desc_content.find("\n##")
                        if next_section > 0:
                            description = desc_content[:next_section].strip()
                        else:
                            description = desc_content.strip()
                except Exception:
                    pass
            
            created_at = None
            if spec_file.exists():
                stat = spec_file.stat()
                created_at = datetime.fromtimestamp(stat.st_mtime).isoformat()
            
            # Check if running
            is_running = False
            if task_id in running_tasks:
                is_running = _is_process_running(running_tasks[task_id]["pid"])
                if not is_running:
                    del running_tasks[task_id]
                    _save_running_tasks()
            
            # Load plan and subtasks
            plan, subtasks = load_plan_from_spec(spec["path"], project_path, spec["folder"])
            
            # Calculate progress
            total_subtasks = len(subtasks)
            completed = sum(1 for s in subtasks if s.get("status") == "completed")
            progress_pct = int((completed / total_subtasks * 100)) if total_subtasks > 0 else 0
            
            # Determine status
            status = "backlog"
            if is_running:
                status = "running"
            elif plan and plan.get("status"):
                status = plan["status"]
            
            # Check for worktree
            manager = WorktreeManager(project_path)
            worktree_info = manager.get_worktree_info(spec["folder"])
            has_build = worktree_info is not None
            
            tasks.append({
                "id": task_id,
                "specId": spec["folder"],
                "projectId": project_id,
                "title": spec["name"],
                "description": description,
                "status": status,
                "progress": progress_pct,
                "subtasks": subtasks,
                "hasBuild": has_build,
                "createdAt": created_at,
                "location": "worktree" if has_build else "main"
            })
        
        # Return tasks array in expected format
        return {"success": True, "data": tasks}
    
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_create_task(params: dict[str, Any]) -> dict[str, Any]:
    """Create a new task."""
    project_id = params.get("projectId")
    title = params.get("title")
    description = params.get("description")
    metadata = params.get("metadata", {})
    
    if not project_id or not description:
        return {"success": False, "error": "Missing required parameters (projectId, description)"}
    
    try:
        project_path = get_project_path(project_id)
        
        if not project_path.exists():
            return {"success": False, "error": "Project path does not exist"}
        
        # Use title + description or just description
        task_name = title or description[:50]
        
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
        safe_name = "".join(
            c if c.isalnum() or c in "-_" else "-" for c in task_name.lower()
        )
        safe_name = "-".join(filter(None, safe_name.split("-")))[:50]
        folder_name = f"{next_num:03d}-{safe_name}"
        spec_dir = specs_dir / folder_name
        spec_dir.mkdir(parents=True, exist_ok=True)
        
        # Create minimal spec.md
        spec_content = f"""# {task_name}

## Description

{description}

## Status

Pending - run build to start implementation.
"""
        spec_file = spec_dir / "spec.md"
        spec_file.write_text(spec_content)

        task_id = get_task_id(project_id, folder_name)
        now = datetime.utcnow().isoformat()
        
        return {
            "success": True,
            "data": {
                "id": task_id,
                "specId": folder_name,
                "projectId": project_id,
                "title": task_name,
                "description": description,
                "status": "backlog",
                "subtasks": [],
                "folder": folder_name,
                "progress": 0,
                "hasBuild": False,
                "createdAt": now,
            },
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_delete_task(params: dict[str, Any]) -> dict[str, Any]:
    """Delete a task."""
    task_id = params.get("taskId")
    
    if not task_id:
        return {"success": False, "error": "Missing taskId parameter"}
    
    try:
        _cleanup_finished_tasks()
        
        project_id, folder = parse_task_id(task_id)
        project_path = get_project_path(project_id)
        
        spec_dir = find_spec(project_path, folder)
        if not spec_dir:
            return {"success": False, "error": "Task not found"}
        
        # Check if task is running
        if task_id in running_tasks:
            pid = running_tasks[task_id]["pid"]
            if _is_process_running(pid):
                return {
                    "success": False,
                    "error": "Cannot delete a running task. Stop the task first.",
                }
            del running_tasks[task_id]
            _save_running_tasks()
        
        # Delete the spec directory
        shutil.rmtree(spec_dir, ignore_errors=False)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_update_task(params: dict[str, Any]) -> dict[str, Any]:
    """Update a task."""
    task_id = params.get("taskId")
    updates = params.get("updates", {})

    if not task_id:
        return {"success": False, "error": "Missing taskId parameter"}

    try:
        project_id, folder = parse_task_id(task_id)
        project_path = get_project_path(project_id)

        spec_dir = find_spec(project_path, folder)
        if not spec_dir:
            return {"success": False, "error": "Task not found"}

        # For status updates, we acknowledge - real status comes from implementation_plan.json
        status = updates.get("status")
        if status:
            # Log the status update request
            pass

        return {"success": True, "data": {"id": task_id, "status": status, **updates}}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_update_status(params: dict[str, Any]) -> dict[str, Any]:
    """Update task status."""
    task_id = params.get("taskId")
    status = params.get("status")

    if not task_id:
        return {"success": False, "error": "Missing taskId parameter"}

    if not status:
        return {"success": False, "error": "Missing status parameter"}

    try:
        project_id, folder = parse_task_id(task_id)
        project_path = get_project_path(project_id)

        spec_dir = find_spec(project_path, folder)
        if not spec_dir:
            return {"success": False, "error": "Task not found"}

        # Acknowledge status update - real status comes from implementation_plan.json
        # The runner updates the plan file, we just acknowledge the request
        return {"success": True, "data": {"taskId": task_id, "status": status}}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_start_task(params: dict[str, Any]) -> dict[str, Any]:
    """Start task execution."""
    task_id = params.get("taskId")
    auto_continue = params.get("autoContinue", True)
    skip_qa = params.get("skipQa", False)
    model = params.get("model")
    
    if not task_id:
        return {"success": False, "error": "Missing taskId parameter"}
    
    try:
        _cleanup_finished_tasks()
        
        project_id, folder = parse_task_id(task_id)
        project_path = get_project_path(project_id)
        
        spec_dir = find_spec(project_path, folder)
        if not spec_dir:
            return {"success": False, "error": "Task not found"}
        
        # Check if already running
        if task_id in running_tasks:
            pid = running_tasks[task_id]["pid"]
            if _is_process_running(pid):
                return {
                    "success": True,
                    "data": {
                        "status": "already_running",
                        "task_id": task_id,
                        "pid": pid,
                    }
                }
            else:
                del running_tasks[task_id]
        
        # Find the run.py script
        backend_dir = Path(__file__).parent.parent.parent.parent
        run_script = backend_dir / "run.py"
        
        if not run_script.exists():
            return {"success": False, "error": f"run.py not found at {run_script}"}
        
        # Create log file
        log_file = spec_dir / "build.log"
        
        # Build command
        cmd = [
            sys.executable,
            str(run_script),
            "--spec",
            folder,
            "--project-dir",
            str(project_path),
            "--force",
        ]
        
        if auto_continue:
            cmd.append("--auto-continue")
        if skip_qa:
            cmd.append("--skip-qa")
        if model:
            cmd.extend(["--model", model])
        
        # Start as detached background process
        with open(log_file, "a") as log_handle:
            log_handle.write(f"\n{'=' * 60}\n")
            log_handle.write(f"Task started at: {datetime.utcnow().isoformat()}\n")
            log_handle.write(f"Command: {' '.join(cmd)}\n")
            log_handle.write(f"{'=' * 60}\n\n")
            log_handle.flush()
            
            process = subprocess.Popen(
                cmd,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                cwd=str(project_path),
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
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
        
        # CRITICAL: Persist status to implementation_plan.json to prevent status inconsistency
        # This ensures that when getTasks() is called (on refresh), it reads the correct status
        # from the plan file. Without this, the old status would be shown after page refresh.
        plan_file = spec_dir / "implementation_plan.json"
        try:
            if plan_file.exists():
                plan_content = json.loads(plan_file.read_text())
                plan_content["status"] = "in_progress"
                plan_file.write_text(json.dumps(plan_content, indent=2))
            else:
                # Create minimal plan if it doesn't exist yet
                plan_content = {
                    "feature": "Task",
                    "status": "in_progress",
                    "phases": [],
                    "created_at": datetime.utcnow().isoformat(),
                    "updated_at": datetime.utcnow().isoformat(),
                }
                plan_file.write_text(json.dumps(plan_content, indent=2))
        except Exception:
            # Don't fail the entire operation if plan update fails
            pass
        
        return {
            "success": True,
            "data": {
                "status": "started",
                "task_id": task_id,
                "pid": process.pid,
                "log_file": str(log_file),
                "message": "Task running in background.",
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_stop_task(params: dict[str, Any]) -> dict[str, Any]:
    """Stop task execution."""
    task_id = params.get("taskId")
    
    if not task_id:
        return {"success": False, "error": "Missing taskId parameter"}
    
    try:
        _cleanup_finished_tasks()
        
        if task_id not in running_tasks:
            return {"success": True, "data": {"status": "not_running", "task_id": task_id}}
        
        task_info = running_tasks[task_id]
        pid = task_info["pid"]
        
        if not _is_process_running(pid):
            del running_tasks[task_id]
            _save_running_tasks()
            return {"success": True, "data": {"status": "already_finished", "task_id": task_id}}
        
        try:
            # Send SIGTERM to the process group
            os.killpg(os.getpgid(pid), signal.SIGTERM)
            
            # Wait for graceful shutdown
            await asyncio.sleep(2)
            
            # Force kill if still running
            if _is_process_running(pid):
                os.killpg(os.getpgid(pid), signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass
        
        del running_tasks[task_id]
        _save_running_tasks()
        
        # CRITICAL: Persist status to implementation_plan.json to prevent status inconsistency
        # When a task is stopped, it should go back to "backlog" status
        # This matches the behavior of the Electron app version
        project_id, folder = parse_task_id(task_id)
        project_path = get_project_path(project_id)
        spec_dir = find_spec(project_path, folder)
        
        if spec_dir:
            plan_file = spec_dir / "implementation_plan.json"
            try:
                if plan_file.exists():
                    plan_content = json.loads(plan_file.read_text())
                    plan_content["status"] = "backlog"
                    plan_file.write_text(json.dumps(plan_content, indent=2))
            except Exception:
                # Don't fail the entire operation if plan update fails
                pass
        
        return {"success": True, "data": {"status": "stopped", "task_id": task_id}}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_pause_task(params: dict[str, Any]) -> dict[str, Any]:
    """Pause task execution.
    
    Note: Pause is not currently supported. Use stop_task instead.
    """
    task_id = params.get("taskId")
    
    if not task_id:
        return {"success": False, "error": "Missing taskId parameter"}
    
    # Pause is not implemented - tasks can only be stopped and restarted
    return {"success": False, "error": "Pause is not supported. Use stop_task instead."}


async def handle_resume_task(params: dict[str, Any]) -> dict[str, Any]:
    """Resume task execution.
    
    Note: Resume is not currently supported. Use start_task instead.
    """
    task_id = params.get("taskId")
    
    if not task_id:
        return {"success": False, "error": "Missing taskId parameter"}
    
    # Resume is not implemented - use start_task with auto_continue=True
    return {"success": False, "error": "Resume is not supported. Use start_task with autoContinue=True instead."}


async def handle_get_task_status(params: dict[str, Any]) -> dict[str, Any]:
    """Get task status."""
    task_id = params.get("taskId")
    
    if not task_id:
        return {"success": False, "error": "Missing taskId parameter"}
    
    try:
        _cleanup_finished_tasks()
        
        project_id, folder = parse_task_id(task_id)
        project_path = get_project_path(project_id)
        
        spec_dir = find_spec(project_path, folder)
        if not spec_dir:
            return {"success": False, "error": "Task not found"}
        
        # Check if running
        is_running = False
        pid = None
        started_at = None
        log_file = None
        
        if task_id in running_tasks:
            task_info = running_tasks[task_id]
            is_running = _is_process_running(task_info["pid"])
            if is_running:
                pid = task_info["pid"]
                started_at = task_info["started_at"]
                log_file = task_info["log_file"]
        
        # Load plan for progress
        plan, subtasks = load_plan_from_spec(spec_dir, project_path, folder)
        
        # Calculate progress
        total_subtasks = len(subtasks)
        completed = sum(1 for s in subtasks if s.get("status") == "completed")
        progress = int((completed / total_subtasks * 100)) if total_subtasks > 0 else 0
        
        # Determine status
        status = "idle"
        if is_running:
            status = "running"
        elif plan and plan.get("status"):
            status = plan["status"]
        
        return {
            "success": True,
            "data": {
                "task_id": task_id,
                "status": status,
                "progress": progress,
                "is_running": is_running,
                "pid": pid,
                "started_at": started_at,
                "log_file": log_file,
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_submit_review(params: dict[str, Any]) -> dict[str, Any]:
    """Submit review for a task (approve or reject).
    
    This is a critical handler for the review workflow.
    When approved: marks task as done and writes QA report.
    When rejected: restarts QA process with feedback.
    """
    task_id = params.get("taskId")
    approved = params.get("approved")
    feedback = params.get("feedback", "")
    
    if not task_id:
        return {"success": False, "error": "Missing taskId parameter"}
    
    if approved is None:
        return {"success": False, "error": "Missing approved parameter"}
    
    try:
        project_id, folder = parse_task_id(task_id)
        project_path = get_project_path(project_id)
        
        spec_dir = find_spec(project_path, folder)
        if not spec_dir:
            return {"success": False, "error": "Task not found"}
        
        if approved:
            # Write approval to QA report
            qa_report_path = spec_dir / "qa_report.md"
            try:
                qa_report_path.write_text(
                    f"# QA Review\n\nStatus: APPROVED\n\nReviewed at: {datetime.utcnow().isoformat()}\n"
                )
            except Exception as e:
                return {"success": False, "error": f"Failed to write QA report: {e}"}
            
            # CRITICAL: Persist 'done' status to implementation_plan.json
            # This ensures the status persists across page refreshes
            plan_file = spec_dir / "implementation_plan.json"
            try:
                if plan_file.exists():
                    plan_content = json.loads(plan_file.read_text())
                    plan_content["status"] = "done"
                    plan_file.write_text(json.dumps(plan_content, indent=2))
                else:
                    # Create minimal plan if it doesn't exist
                    plan_content = {
                        "feature": "Task",
                        "status": "done",
                        "phases": [],
                        "created_at": datetime.utcnow().isoformat(),
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                    plan_file.write_text(json.dumps(plan_content, indent=2))
            except Exception:
                # Non-fatal: approval already recorded in QA report
                pass
            
            return {"success": True, "data": {"status": "approved", "task_id": task_id}}
        
        else:
            # Write feedback for QA fixer
            fix_request_path = spec_dir / "QA_FIX_REQUEST.md"
            try:
                fix_request_path.write_text(
                    f"# QA Fix Request\n\nStatus: REJECTED\n\n## Feedback\n\n{feedback or 'No feedback provided'}\n\nCreated at: {datetime.utcnow().isoformat()}\n"
                )
            except Exception as e:
                return {"success": False, "error": f"Failed to write QA fix request: {e}"}
            
            # CRITICAL: Persist 'in_progress' status to implementation_plan.json
            # Task goes back to in_progress for QA fixes
            plan_file = spec_dir / "implementation_plan.json"
            try:
                if plan_file.exists():
                    plan_content = json.loads(plan_file.read_text())
                    plan_content["status"] = "in_progress"
                    plan_file.write_text(json.dumps(plan_content, indent=2))
            except Exception:
                # Non-fatal: feedback already recorded in fix request file
                pass
            
            # Note: In web version, we don't automatically restart QA process
            # The user needs to manually start it after addressing feedback
            # This is simpler than the Electron version which has background process management
            
            return {"success": True, "data": {"status": "rejected", "task_id": task_id}}
    
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_get_logs(params: dict[str, Any]) -> dict[str, Any]:
    """Get historical logs for a task (before streaming started).

    Args:
        params: Dict containing:
            - projectId: Project identifier
            - specId: Spec identifier

    Returns:
        Dict with success status and logs or error
    """
    project_id = params.get("projectId")
    spec_id = params.get("specId")

    if not project_id or not spec_id:
        return {"success": False, "error": "Missing projectId or specId"}

    try:
        from pathlib import Path
        # get_project_path is defined in this file

        project_path = get_project_path(project_id)
        log_file = project_path / ".auto-claude" / "specs" / spec_id / "task.log"

        if not log_file.exists():
            return {"success": True, "data": {"logs": ""}}

        # Read log file content
        with open(log_file, "r", encoding="utf-8") as f:
            logs = f.read()

        return {"success": True, "data": {"logs": logs}}

    except UnicodeDecodeError:
        return {"success": False, "error": "Log file contains invalid encoding"}
    except Exception as e:
        logger.error(f"Error reading logs for spec {spec_id}: {e}")
        return {"success": False, "error": str(e)}


async def handle_archive_tasks(params: dict[str, Any]) -> dict[str, Any]:
    """Archive completed tasks.

    Args:
        params: Dict containing:
            - projectId: Project identifier
            - taskIds: List of task IDs to archive

    Returns:
        Dict with success status or error
    """
    project_id = params.get("projectId")
    task_ids = params.get("taskIds", [])

    if not project_id or not task_ids:
        return {"success": False, "error": "Missing projectId or taskIds"}

    try:
        from pathlib import Path
        # get_project_path is defined in this file
        import json

        project_path = get_project_path(project_id)
        archived_count = 0

        for task_id in task_ids:
            # Update task metadata to mark as archived
            spec_dir = project_path / ".auto-claude" / "specs" / task_id
            metadata_file = spec_dir / "task_metadata.json"

            if metadata_file.exists():
                try:
                    with open(metadata_file, "r") as f:
                        metadata = json.load(f)

                    metadata["archived"] = True

                    with open(metadata_file, "w") as f:
                        json.dump(metadata, f, indent=2)

                    archived_count += 1
                except Exception:
                    continue

        return {"success": True, "data": {"archived": archived_count}}

    except Exception as e:
        logger.error(f"Error archiving tasks: {e}")
        return {"success": False, "error": str(e)}


async def handle_unarchive_tasks(params: dict[str, Any]) -> dict[str, Any]:
    """Unarchive tasks.

    Args:
        params: Dict containing:
            - projectId: Project identifier
            - taskIds: List of task IDs to unarchive

    Returns:
        Dict with success status or error
    """
    project_id = params.get("projectId")
    task_ids = params.get("taskIds", [])

    if not project_id or not task_ids:
        return {"success": False, "error": "Missing projectId or taskIds"}

    try:
        from pathlib import Path
        # get_project_path is defined in this file
        import json

        project_path = get_project_path(project_id)
        unarchived_count = 0

        for task_id in task_ids:
            # Update task metadata to remove archived flag
            spec_dir = project_path / ".auto-claude" / "specs" / task_id
            metadata_file = spec_dir / "task_metadata.json"

            if metadata_file.exists():
                try:
                    with open(metadata_file, "r") as f:
                        metadata = json.load(f)

                    metadata["archived"] = False

                    with open(metadata_file, "w") as f:
                        json.dump(metadata, f, indent=2)

                    unarchived_count += 1
                except Exception:
                    continue

        return {"success": True, "data": {"unarchived": unarchived_count}}

    except Exception as e:
        logger.error(f"Error unarchiving tasks: {e}")
        return {"success": False, "error": str(e)}
