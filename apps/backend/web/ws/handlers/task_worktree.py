"""
WebSocket Handlers - Task Worktree Operations
==============================================

Handlers for worktree-related operations on tasks:
- Status checking
- Diff viewing
- Merge operations
- Branch management
- PR creation
"""

import sys
import subprocess
from pathlib import Path
from typing import Any

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

# Import from existing routers (reuse logic)
from web.routers.tasks import get_project_path, parse_task_id
from cli.utils import find_spec, get_specs_dir
from core.worktree import WorktreeManager


async def handle_worktree_status(params: dict[str, Any]) -> dict[str, Any]:
    """
    Get worktree status for a task.

    Args:
        params: Request parameters
            - projectId: str (required)
            - taskId: str (required)

    Returns:
        {
            "success": True,
            "data": {
                "exists": bool,
                "clean": bool (if exists),
                "files": [...] (if exists),
                "branch": str (if exists),
                "commitCount": int (if exists)
            }
        }
    """
    try:
        # Extract parameters
        project_id = params.get("projectId")
        task_id = params.get("taskId")

        if not project_id or not task_id:
            return {"success": False, "error": "Missing required parameters (projectId, taskId)"}

        # Parse task ID to get spec name
        _, spec_name = parse_task_id(task_id)

        # Get project path
        project_path = get_project_path(project_id)
        if not project_path.exists():
            return {"success": False, "error": "Project path does not exist"}

        # Create WorktreeManager
        manager = WorktreeManager(project_path)

        # Get worktree info
        worktree_info = manager.get_worktree_info(spec_name)

        # If worktree doesn't exist, return early
        if not worktree_info:
            return {"success": True, "data": {"exists": False}}

        # Run git status --porcelain in worktree directory
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=worktree_info.path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        if result.returncode != 0:
            return {"success": False, "error": f"Failed to get git status: {result.stderr}"}

        # Parse git status output (XY format: first char=index, second char=worktree)
        files = []
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            # Format: XY filename
            # X = index status, Y = worktree status
            status = line[:2]
            filename = line[3:].strip()
            files.append({"status": status, "filename": filename})

        # Determine if working tree is clean
        is_clean = len(files) == 0

        # Get branch name from worktree info
        branch = worktree_info.branch

        # Get commit count ahead of base branch
        commit_count_result = subprocess.run(
            ["git", "rev-list", "--count", f"HEAD", f"^{manager.base_branch}"],
            cwd=worktree_info.path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        commit_count = 0
        if commit_count_result.returncode == 0:
            try:
                commit_count = int(commit_count_result.stdout.strip())
            except ValueError:
                pass

        return {
            "success": True,
            "data": {
                "exists": True,
                "clean": is_clean,
                "files": files,
                "branch": branch,
                "commitCount": commit_count,
            }
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_worktree_diff(params: dict[str, Any]) -> dict[str, Any]:
    """
    Get git diff for a task's worktree.

    Args:
        params: Request parameters
            - projectId: str (required)
            - taskId: str (required)

    Returns:
        {
            "success": True,
            "data": {
                "diff": str (full diff output)
            }
        }
    """
    try:
        # Extract parameters
        project_id = params.get("projectId")
        task_id = params.get("taskId")

        if not project_id or not task_id:
            return {"success": False, "error": "Missing required parameters (projectId, taskId)"}

        # Parse task ID to get spec name
        _, spec_name = parse_task_id(task_id)

        # Get project path
        project_path = get_project_path(project_id)
        if not project_path.exists():
            return {"success": False, "error": "Project path does not exist"}

        # Create WorktreeManager
        manager = WorktreeManager(project_path)

        # Get worktree info
        worktree_info = manager.get_worktree_info(spec_name)

        # If worktree doesn't exist, return error
        if not worktree_info:
            return {"success": False, "error": "Worktree does not exist for this task"}

        # Run git diff HEAD in worktree directory
        result = subprocess.run(
            ["git", "diff", "HEAD"],
            cwd=worktree_info.path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        if result.returncode != 0:
            return {"success": False, "error": f"Failed to get git diff: {result.stderr}"}

        # Return full diff output
        return {
            "success": True,
            "data": {
                "diff": result.stdout
            }
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_worktree_merge_preview(params: dict[str, Any]) -> dict[str, Any]:
    """
    Preview merge conflicts before merging a worktree.

    This performs a test merge in the project root to detect conflicts,
    then aborts the merge to leave the repository in a clean state.

    Args:
        params: Request parameters
            - projectId: str (required)
            - taskId: str (required)

    Returns:
        {
            "success": True,
            "data": {
                "hasConflicts": bool,
                "conflicts": list[str]  # List of conflicting file paths
            }
        }
    """
    try:
        # Extract parameters
        project_id = params.get("projectId")
        task_id = params.get("taskId")

        if not project_id or not task_id:
            return {"success": False, "error": "Missing required parameters (projectId, taskId)"}

        # Parse task ID to get spec name
        _, spec_name = parse_task_id(task_id)

        # Get project path
        project_path = get_project_path(project_id)
        if not project_path.exists():
            return {"success": False, "error": "Project path does not exist"}

        # Create WorktreeManager
        manager = WorktreeManager(project_path)

        # Get worktree info to verify it exists and get branch name
        worktree_info = manager.get_worktree_info(spec_name)
        if not worktree_info:
            return {"success": False, "error": f"No worktree found for task: {spec_name}"}

        # Perform test merge in PROJECT ROOT (not worktree)
        # Use --no-commit --no-ff to stage the merge without committing
        merge_result = subprocess.run(
            ["git", "merge", "--no-commit", "--no-ff", worktree_info.branch],
            cwd=project_path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        # Check for conflicts using git status
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=project_path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        # Parse conflicts from status output
        # Conflict markers: UU (both modified), AA (both added), DD (both deleted)
        conflicts = []
        if status_result.returncode == 0 and status_result.stdout:
            for line in status_result.stdout.strip().split("\n"):
                if line:
                    # Format: "XY filename" where XY is the status code
                    status_code = line[:2]
                    if status_code in ["UU", "AA", "DD", "AU", "UA", "DU", "UD"]:
                        # Extract filename (skip status code and space)
                        filename = line[3:].strip()
                        conflicts.append(filename)

        # Determine if there are conflicts
        has_conflicts = len(conflicts) > 0 or merge_result.returncode != 0

        # Check merge output for conflict indicators
        merge_output = (merge_result.stdout + merge_result.stderr).lower()
        if "conflict" in merge_output and not conflicts:
            # Merge reported conflicts but we didn't detect files
            # This can happen with complex conflicts
            has_conflicts = True

        # CRITICAL: Always abort the merge to clean up the repository state
        # This ensures we don't leave the repository in a merge state
        abort_result = subprocess.run(
            ["git", "merge", "--abort"],
            cwd=project_path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        # Check if abort succeeded
        if abort_result.returncode != 0:
            # Merge abort failed - this is serious
            # Try to recover by resetting
            subprocess.run(
                ["git", "reset", "--merge"],
                cwd=project_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )

        return {
            "success": True,
            "data": {
                "hasConflicts": has_conflicts,
                "conflicts": conflicts
            }
        }

    except Exception as e:
        # If we fail during the merge preview, try to abort/reset
        try:
            subprocess.run(
                ["git", "merge", "--abort"],
                cwd=project_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except:
            try:
                subprocess.run(
                    ["git", "reset", "--merge"],
                    cwd=project_path,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
            except:
                pass

        return {"success": False, "error": f"Merge preview failed: {str(e)}"}


async def handle_worktree_merge(params: dict[str, Any]) -> dict[str, Any]:
    """
    Merge a worktree branch into the base branch.

    This performs the actual merge using WorktreeManager.merge_worktree().
    Conflicts are returned as a non-fatal error with conflict details.

    Args:
        params: Request parameters
            - projectId: str (required)
            - taskId: str (required)
            - targetBranch: str (optional) - Target branch to merge into (defaults to base branch)
            - noCommit: bool (optional) - If True, stage merge without committing (default: False)

    Returns:
        {
            "success": True/False,
            "data": {
                "message": str,
                "conflicts": list[str]  # Empty if no conflicts
            },
            "error": str (if failed)
        }
    """
    try:
        # Extract parameters
        project_id = params.get("projectId")
        task_id = params.get("taskId")
        target_branch = params.get("targetBranch")
        no_commit = params.get("noCommit", False)

        if not project_id or not task_id:
            return {"success": False, "error": "Missing required parameters (projectId, taskId)"}

        # Parse task ID to get spec name
        _, spec_name = parse_task_id(task_id)

        # Get project path
        project_path = get_project_path(project_id)
        if not project_path.exists():
            return {"success": False, "error": "Project path does not exist"}

        # Create WorktreeManager
        manager = WorktreeManager(project_path)

        # Verify worktree exists
        worktree_info = manager.get_worktree_info(spec_name)
        if not worktree_info:
            return {"success": False, "error": f"No worktree found for task: {spec_name}"}

        # Perform the merge using WorktreeManager.merge_worktree()
        merge_success = manager.merge_worktree(
            spec_name,
            no_commit=no_commit,
            base_branch=target_branch
        )

        if merge_success:
            # Merge succeeded
            if no_commit:
                message = f"Changes from {worktree_info.branch} staged successfully. Review and commit when ready."
            else:
                message = f"Successfully merged {worktree_info.branch} into {target_branch or manager.base_branch}."

            return {
                "success": True,
                "data": {
                    "message": message,
                    "conflicts": []
                }
            }
        else:
            # Merge failed - likely due to conflicts
            # Detect conflicts using git status
            status_result = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=project_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )

            conflicts = []
            if status_result.returncode == 0 and status_result.stdout:
                for line in status_result.stdout.strip().split("\n"):
                    if line:
                        status_code = line[:2]
                        if status_code in ["UU", "AA", "DD", "AU", "UA", "DU", "UD"]:
                            filename = line[3:].strip()
                            conflicts.append(filename)

            # Return failure with conflict info
            # Conflicts are expected outcomes, not errors
            return {
                "success": False,
                "data": {
                    "message": "Merge failed due to conflicts. Resolve conflicts and try again.",
                    "conflicts": conflicts
                },
                "error": "Merge conflicts detected"
            }

    except Exception as e:
        return {"success": False, "error": f"Merge failed: {str(e)}"}


async def handle_worktree_discard(params: dict[str, Any]) -> dict[str, Any]:
    """
    Discard all changes in a task's worktree (reset to HEAD).

    This performs a hard reset and cleans untracked files in the worktree.
    WARNING: This is destructive and cannot be undone.

    Args:
        params: Request parameters
            - projectId: str (required)
            - taskId: str (required)

    Returns:
        {
            "success": True,
            "data": {"discarded": True}
        }
    """
    try:
        # Extract parameters
        project_id = params.get("projectId")
        task_id = params.get("taskId")

        if not project_id or not task_id:
            return {"success": False, "error": "Missing required parameters (projectId, taskId)"}

        # Parse task_id to get spec_name
        _, spec_name = parse_task_id(task_id)

        # Get project path
        project_path = get_project_path(project_id)
        if not project_path.exists():
            return {"success": False, "error": "Project path does not exist"}

        # Create WorktreeManager instance
        manager = WorktreeManager(project_path)

        # Get worktree info to verify it exists
        worktree_info = manager.get_worktree_info(spec_name)

        if not worktree_info:
            return {"success": False, "error": f"No worktree found for task: {spec_name}"}

        worktree_path = worktree_info.path

        # Run git reset --hard HEAD in worktree directory
        reset_result = subprocess.run(
            ["git", "reset", "--hard", "HEAD"],
            cwd=worktree_path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30
        )

        if reset_result.returncode != 0:
            return {"success": False, "error": f"Failed to reset worktree: {reset_result.stderr}"}

        # Run git clean -fd to remove untracked files
        clean_result = subprocess.run(
            ["git", "clean", "-fd"],
            cwd=worktree_path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30
        )

        if clean_result.returncode != 0:
            return {"success": False, "error": f"Failed to clean worktree: {clean_result.stderr}"}

        return {"success": True, "data": {"discarded": True}}

    except Exception as e:
        return {"success": False, "error": f"Failed to discard worktree changes: {str(e)}"}


async def handle_clear_staged_state(params: dict[str, Any]) -> dict[str, Any]:
    """
    Clear staged state in a task's worktree (unstage all files).

    This runs 'git reset' (no flags) to unstage all files without
    modifying the working directory.

    Args:
        params: Request parameters
            - projectId: str (required)
            - taskId: str (required)

    Returns:
        {
            "success": True,
            "data": {"cleared": True}
        }
    """
    try:
        # Extract parameters
        project_id = params.get("projectId")
        task_id = params.get("taskId")

        if not project_id or not task_id:
            return {"success": False, "error": "Missing required parameters (projectId, taskId)"}

        # Parse task_id to get spec_name
        _, spec_name = parse_task_id(task_id)

        # Get project path
        project_path = get_project_path(project_id)
        if not project_path.exists():
            return {"success": False, "error": "Project path does not exist"}

        # Create WorktreeManager instance
        manager = WorktreeManager(project_path)

        # Get worktree path
        worktree_info = manager.get_worktree_info(spec_name)

        if not worktree_info:
            return {"success": False, "error": f"No worktree found for task: {spec_name}"}

        worktree_path = worktree_info.path

        # Run git reset (no flags - just unstage all) in worktree directory
        reset_result = subprocess.run(
            ["git", "reset"],
            cwd=worktree_path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30
        )

        if reset_result.returncode != 0:
            return {"success": False, "error": f"Failed to clear staged state: {reset_result.stderr}"}

        return {"success": True, "data": {"cleared": True}}

    except Exception as e:
        return {"success": False, "error": f"Failed to clear staged state: {str(e)}"}


async def handle_list_worktrees(params: dict[str, Any]) -> dict[str, Any]:
    """
    List all worktrees for a project with statistics.

    Args:
        params: Request parameters
            - projectId: str (required)

    Returns:
        {
            "success": True,
            "data": {
                "worktrees": [
                    {
                        "path": str,
                        "branch": str,
                        "specName": str,
                        "filesChanged": int,
                        "commitCount": int
                    }
                ]
            }
        }
    """
    try:
        # Extract parameters (only needs project, not specific task)
        project_id = params.get("projectId")

        if not project_id:
            return {"success": False, "error": "Missing required parameter (projectId)"}

        # Get project path
        project_path = get_project_path(project_id)
        if not project_path.exists():
            return {"success": False, "error": "Project path does not exist"}

        # Create WorktreeManager instance
        manager = WorktreeManager(project_path)

        # Use manager.list_all_worktrees() to get list of WorktreeInfo objects
        worktree_infos = manager.list_all_worktrees()

        worktrees_data = []

        for worktree_info in worktree_infos:
            # Get changed files count using manager.get_changed_files()
            changed_files = manager.get_changed_files(worktree_info.spec_name)
            files_changed = len(changed_files)

            # Get commit count ahead of base branch
            commit_count = 0
            try:
                # Run git rev-list --count HEAD ^origin/main to count commits
                result = subprocess.run(
                    [
                        "git", "rev-list", "--count",
                        "HEAD", f"^origin/{manager.base_branch}"
                    ],
                    cwd=worktree_info.path,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=10
                )

                if result.returncode == 0:
                    commit_count = int(result.stdout.strip() or "0")
                else:
                    # Fallback: try without origin/ prefix (local branch comparison)
                    result = subprocess.run(
                        [
                            "git", "rev-list", "--count",
                            f"{manager.base_branch}..HEAD"
                        ],
                        cwd=worktree_info.path,
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=10
                    )
                    if result.returncode == 0:
                        commit_count = int(result.stdout.strip() or "0")

            except (ValueError, subprocess.TimeoutExpired):
                # If we can't get commit count, default to 0
                commit_count = 0

            worktrees_data.append({
                "path": str(worktree_info.path),
                "branch": worktree_info.branch,
                "specName": worktree_info.spec_name,
                "filesChanged": files_changed,
                "commitCount": commit_count
            })

        return {"success": True, "data": {"worktrees": worktrees_data}}

    except Exception as e:
        return {"success": False, "error": f"Failed to list worktrees: {str(e)}"}


# Placeholders for additional handlers to be implemented by other agents
# TODO: handle_worktree_create_pr
# TODO: handle_worktree_push_branch
