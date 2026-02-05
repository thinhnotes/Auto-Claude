"""
Task Event Broadcasting System
===============================

Broadcasts task lifecycle events to all connected WebSocket clients.
"""

import logging
from datetime import datetime
from typing import Any

from ..ws import publish_event, Channel

logger = logging.getLogger("auto-claude-api")


class TaskEventEmitter:
    """
    Emits task lifecycle events to all connected WebSocket clients.
    
    Supports 5 event types:
    - task_started: Task begins execution
    - task_progress: Task progress updates (subtasks, logs, etc.)
    - task_completed: Task finishes successfully
    - task_failed: Task encounters an error
    - task_cancelled: Task is manually stopped
    """
    
    def __init__(self):
        """Initialize the event emitter."""
        self._logger = logger
    
    async def emit_task_started(
        self,
        project_id: str,
        task_id: str,
        spec_id: str,
        pid: int | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        """
        Emit task_started event.
        
        Args:
            project_id: Project identifier
            task_id: Full task ID (project_id:folder)
            spec_id: Spec folder name
            pid: Process ID of the task
            metadata: Additional metadata (auto_continue, skip_qa, model, etc.)
        """
        try:
            data = {
                "event_type": "task_started",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "pid": pid,
                "metadata": metadata or {},
            }
            
            await publish_event(
                Channel.TASK_STATUS,
                {"projectId": project_id, "taskId": task_id, "specId": spec_id},
                data,
            )
            
            self._logger.info(
                f"📡 [TaskEventEmitter] Emitted task_started: task_id={task_id}, pid={pid}"
            )
        except Exception as e:
            self._logger.error(
                f"❌ [TaskEventEmitter] Failed to emit task_started: {e}",
                exc_info=True,
            )
    
    async def emit_task_progress(
        self,
        project_id: str,
        task_id: str,
        spec_id: str,
        progress: dict[str, Any],
    ):
        """
        Emit task_progress event.
        
        Args:
            project_id: Project identifier
            task_id: Full task ID (project_id:folder)
            spec_id: Spec folder name
            progress: Progress data (subtasks, current phase, completion %, etc.)
        """
        try:
            data = {
                "event_type": "task_progress",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "progress": progress,
            }
            
            await publish_event(
                Channel.TASK_PROGRESS,
                {"projectId": project_id, "taskId": task_id, "specId": spec_id},
                data,
            )
            
            self._logger.debug(
                f"📡 [TaskEventEmitter] Emitted task_progress: task_id={task_id}"
            )
        except Exception as e:
            self._logger.error(
                f"❌ [TaskEventEmitter] Failed to emit task_progress: {e}",
                exc_info=True,
            )
    
    async def emit_task_completed(
        self,
        project_id: str,
        task_id: str,
        spec_id: str,
        result: dict[str, Any] | None = None,
    ):
        """
        Emit task_completed event.
        
        Args:
            project_id: Project identifier
            task_id: Full task ID (project_id:folder)
            spec_id: Spec folder name
            result: Task result data (files created, tests passed, etc.)
        """
        try:
            data = {
                "event_type": "task_completed",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "result": result or {},
            }
            
            await publish_event(
                Channel.TASK_STATUS,
                {"projectId": project_id, "taskId": task_id, "specId": spec_id},
                data,
            )
            
            self._logger.info(
                f"📡 [TaskEventEmitter] Emitted task_completed: task_id={task_id}"
            )
        except Exception as e:
            self._logger.error(
                f"❌ [TaskEventEmitter] Failed to emit task_completed: {e}",
                exc_info=True,
            )
    
    async def emit_task_failed(
        self,
        project_id: str,
        task_id: str,
        spec_id: str,
        error: str,
        error_details: dict[str, Any] | None = None,
    ):
        """
        Emit task_failed event.
        
        Args:
            project_id: Project identifier
            task_id: Full task ID (project_id:folder)
            spec_id: Spec folder name
            error: Error message
            error_details: Additional error context (traceback, failed subtask, etc.)
        """
        try:
            data = {
                "event_type": "task_failed",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "error": error,
                "error_details": error_details or {},
            }
            
            await publish_event(
                Channel.TASK_STATUS,
                {"projectId": project_id, "taskId": task_id, "specId": spec_id},
                data,
            )
            
            self._logger.warning(
                f"📡 [TaskEventEmitter] Emitted task_failed: task_id={task_id}, error={error}"
            )
        except Exception as e:
            self._logger.error(
                f"❌ [TaskEventEmitter] Failed to emit task_failed: {e}",
                exc_info=True,
            )
    
    async def emit_task_cancelled(
        self,
        project_id: str,
        task_id: str,
        spec_id: str,
        reason: str | None = None,
    ):
        """
        Emit task_cancelled event.
        
        Args:
            project_id: Project identifier
            task_id: Full task ID (project_id:folder)
            spec_id: Spec folder name
            reason: Optional cancellation reason
        """
        try:
            data = {
                "event_type": "task_cancelled",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "reason": reason or "Manually stopped by user",
            }
            
            await publish_event(
                Channel.TASK_STATUS,
                {"projectId": project_id, "taskId": task_id, "specId": spec_id},
                data,
            )
            
            self._logger.info(
                f"📡 [TaskEventEmitter] Emitted task_cancelled: task_id={task_id}"
            )
        except Exception as e:
            self._logger.error(
                f"❌ [TaskEventEmitter] Failed to emit task_cancelled: {e}",
                exc_info=True,
            )


# Global event emitter instance
_event_emitter: TaskEventEmitter | None = None


def get_event_emitter() -> TaskEventEmitter:
    """Get the global task event emitter instance."""
    global _event_emitter
    if _event_emitter is None:
        _event_emitter = TaskEventEmitter()
    return _event_emitter
