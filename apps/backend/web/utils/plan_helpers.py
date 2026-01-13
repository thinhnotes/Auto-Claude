"""
Implementation Plan Helpers
===========================

Helper functions to normalize implementation_plan.json formats for the web API.

The planner agent may create plans in two formats:
1. Nested format: subtasks are inside each phase
2. Flat format: subtasks are at root level with "phase" reference

These helpers normalize the data to work with the core backend which expects
the nested format.
"""

import json
import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("auto-claude-api")


def get_all_subtasks(plan: dict) -> list[dict]:
    """
    Extract all subtasks from an implementation plan, handling both schema formats.
    
    Format 1 (nested): subtasks are inside each phase
    Format 2 (flat): subtasks are at root level with "phase" reference
    
    Args:
        plan: The parsed implementation plan dict
        
    Returns:
        List of all subtask dicts
    """
    all_subtasks = []
    
    # Check for nested format: subtasks inside phases
    for phase in plan.get("phases", []):
        phase_subtasks = phase.get("subtasks", [])
        if phase_subtasks:
            all_subtasks.extend(phase_subtasks)
    
    # Check for flat format: subtasks at root level
    if not all_subtasks:
        root_subtasks = plan.get("subtasks", [])
        if root_subtasks:
            all_subtasks = root_subtasks
    
    return all_subtasks


def get_subtasks_by_phase(plan: dict) -> dict[str, list[dict]]:
    """
    Get subtasks organized by phase, handling both schema formats.
    
    Args:
        plan: The parsed implementation plan dict
        
    Returns:
        Dict mapping phase_id to list of subtasks
    """
    by_phase: dict[str, list[dict]] = {}
    
    # Check for nested format: subtasks inside phases
    for phase in plan.get("phases", []):
        phase_id = phase.get("id") or phase.get("phase")
        phase_subtasks = phase.get("subtasks", [])
        if phase_subtasks:
            by_phase[phase_id] = phase_subtasks
    
    # Check for flat format: subtasks at root level with "phase" reference
    if not by_phase:
        for subtask in plan.get("subtasks", []):
            phase_ref = subtask.get("phase", "default")
            if phase_ref not in by_phase:
                by_phase[phase_ref] = []
            by_phase[phase_ref].append(subtask)
    
    return by_phase


def normalize_plan(plan: dict) -> dict:
    """
    Normalize a plan to the nested format expected by the core backend.
    
    If the plan is in flat format (subtasks at root level), this moves
    the subtasks into their respective phases.
    
    Args:
        plan: The parsed implementation plan dict
        
    Returns:
        The plan dict with subtasks nested inside phases
    """
    # Check if already in nested format
    has_nested_subtasks = any(
        phase.get("subtasks", []) for phase in plan.get("phases", [])
    )
    
    if has_nested_subtasks:
        # Already in correct format
        return plan
    
    # Check for flat format: subtasks at root level
    root_subtasks = plan.get("subtasks", [])
    if not root_subtasks:
        # No subtasks at all
        return plan
    
    # Convert flat to nested format
    subtasks_by_phase = get_subtasks_by_phase(plan)
    
    # Create a copy of the plan
    normalized = dict(plan)
    
    # Add subtasks to each phase
    normalized_phases = []
    for phase in plan.get("phases", []):
        phase_copy = dict(phase)
        phase_id = phase.get("id") or phase.get("phase")
        phase_copy["subtasks"] = subtasks_by_phase.get(phase_id, [])
        normalized_phases.append(phase_copy)
    
    normalized["phases"] = normalized_phases
    
    # Remove root-level subtasks to avoid confusion
    if "subtasks" in normalized:
        del normalized["subtasks"]
    
    return normalized


def load_plan_from_spec(
    spec_path: Path,
    project_path: Path,
    spec_folder: str,
) -> tuple[Optional[dict], list[dict]]:
    """
    Load implementation plan from spec, checking both main project and worktree.
    
    When a build is running in a worktree, the implementation_plan.json is 
    updated there, not in the main project. This function checks both locations
    and returns the most up-to-date plan.
    
    Args:
        spec_path: Path to the spec directory in the main project
        project_path: Path to the project root
        spec_folder: The spec folder name (e.g., "001-feature-name")
        
    Returns:
        Tuple of (plan_dict, subtasks_list)
    """
    # Import here to avoid circular imports
    from workspace import get_existing_build_worktree
    
    logger.debug(f"📂 [load_plan_from_spec] spec_path={spec_path}, project_path={project_path}, spec_folder={spec_folder}")
    
    plan = None
    subtasks = []
    
    # First, check for worktree (has most up-to-date data when build is running)
    worktree_path = get_existing_build_worktree(project_path, spec_folder)
    logger.debug(f"📂 [load_plan_from_spec] worktree_path={worktree_path}")
    
    worktree_plan_file = None
    if worktree_path:
        worktree_spec_dir = worktree_path / ".auto-claude" / "specs" / spec_folder
        worktree_plan_file = worktree_spec_dir / "implementation_plan.json"
        logger.debug(f"📂 [load_plan_from_spec] worktree_plan_file={worktree_plan_file}, exists={worktree_plan_file.exists() if worktree_plan_file else False}")
    
    # Check main project spec directory
    main_plan_file = spec_path / "implementation_plan.json"
    logger.debug(f"📂 [load_plan_from_spec] main_plan_file={main_plan_file}, exists={main_plan_file.exists()}")
    
    # Determine which plan file to use (prefer worktree if it exists and is newer)
    plan_file = None
    if worktree_plan_file and worktree_plan_file.exists():
        if main_plan_file.exists():
            # Use the newer one
            wt_mtime = worktree_plan_file.stat().st_mtime
            main_mtime = main_plan_file.stat().st_mtime
            if wt_mtime > main_mtime:
                plan_file = worktree_plan_file
                logger.info(f"📂 [load_plan_from_spec] Using worktree plan (newer)")
            else:
                plan_file = main_plan_file
                logger.info(f"📂 [load_plan_from_spec] Using main plan (newer)")
        else:
            plan_file = worktree_plan_file
            logger.info(f"📂 [load_plan_from_spec] Using worktree plan (main doesn't exist)")
    elif main_plan_file.exists():
        plan_file = main_plan_file
        logger.info(f"📂 [load_plan_from_spec] Using main plan (no worktree)")
    else:
        logger.warning(f"📂 [load_plan_from_spec] No plan file found!")
    
    if plan_file and plan_file.exists():
        try:
            logger.info(f"📂 [load_plan_from_spec] Reading plan from: {plan_file}")
            plan = json.loads(plan_file.read_text())
            # Use helper function that handles both nested and flat formats
            all_subtasks = get_all_subtasks(plan)
            logger.info(f"📂 [load_plan_from_spec] Found {len(all_subtasks)} subtasks")
            for subtask in all_subtasks:
                subtasks.append({
                    "id": subtask.get("id", ""),
                    "title": subtask.get("description", subtask.get("title", "")),
                    "description": subtask.get("description", ""),
                    "status": subtask.get("status", "pending"),
                    "files": subtask.get("files", subtask.get("files_to_modify", [])),
                })
        except Exception as e:
            logger.error(f"📂 [load_plan_from_spec] Error reading plan: {e}")
    
    return plan, subtasks


def load_task_logs_from_spec(
    spec_path: Path,
    project_path: Path,
    spec_folder: str,
) -> Optional[dict]:
    """
    Load task_logs.json from spec, checking both main project and worktree.
    
    Args:
        spec_path: Path to the spec directory in the main project
        project_path: Path to the project root
        spec_folder: The spec folder name
        
    Returns:
        The task_logs dict or None
    """
    # Import here to avoid circular imports
    from workspace import get_existing_build_worktree
    
    logger.debug(f"📝 [load_task_logs_from_spec] spec_path={spec_path}, spec_folder={spec_folder}")
    
    # First, check for worktree (has most up-to-date data when build is running)
    worktree_path = get_existing_build_worktree(project_path, spec_folder)
    logger.debug(f"📝 [load_task_logs_from_spec] worktree_path={worktree_path}")
    
    worktree_logs_file = None
    if worktree_path:
        worktree_spec_dir = worktree_path / ".auto-claude" / "specs" / spec_folder
        worktree_logs_file = worktree_spec_dir / "task_logs.json"
        logger.debug(f"📝 [load_task_logs_from_spec] worktree_logs_file={worktree_logs_file}, exists={worktree_logs_file.exists() if worktree_logs_file else False}")
    
    # Check main project spec directory
    main_logs_file = spec_path / "task_logs.json"
    logger.debug(f"📝 [load_task_logs_from_spec] main_logs_file={main_logs_file}, exists={main_logs_file.exists()}")
    
    # Determine which file to use (prefer worktree if it exists and is newer)
    logs_file = None
    if worktree_logs_file and worktree_logs_file.exists():
        if main_logs_file.exists():
            # Use the newer one
            if worktree_logs_file.stat().st_mtime > main_logs_file.stat().st_mtime:
                logs_file = worktree_logs_file
                logger.info(f"📝 [load_task_logs_from_spec] Using worktree logs (newer)")
            else:
                logs_file = main_logs_file
                logger.info(f"📝 [load_task_logs_from_spec] Using main logs (newer)")
        else:
            logs_file = worktree_logs_file
            logger.info(f"📝 [load_task_logs_from_spec] Using worktree logs (main doesn't exist)")
    elif main_logs_file.exists():
        logs_file = main_logs_file
        logger.info(f"📝 [load_task_logs_from_spec] Using main logs (no worktree)")
    else:
        logger.debug(f"📝 [load_task_logs_from_spec] No task_logs.json found")
    
    if logs_file and logs_file.exists():
        try:
            logger.info(f"📝 [load_task_logs_from_spec] Reading logs from: {logs_file}")
            return json.loads(logs_file.read_text())
        except Exception as e:
            logger.error(f"📝 [load_task_logs_from_spec] Error reading logs: {e}")
    
    return None

