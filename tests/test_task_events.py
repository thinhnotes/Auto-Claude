"""
Unit Tests for Task Event Broadcasting System
==============================================

Tests the TaskEventEmitter class and event broadcasting functionality.
"""

import asyncio
import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from apps.backend.web.ws.events import TaskEventEmitter, get_event_emitter
from apps.backend.web.ws.protocol import Channel


@pytest.fixture
def event_emitter():
    """Create a fresh TaskEventEmitter instance for each test."""
    return TaskEventEmitter()


@pytest.fixture
def mock_publish_event():
    """Mock the publish_event function."""
    with patch("apps.backend.web.ws.events.publish_event", new_callable=AsyncMock) as mock:
        yield mock


class TestTaskEventEmitter:
    """Test TaskEventEmitter class."""
    
    @pytest.mark.asyncio
    async def test_emit_task_started(self, event_emitter, mock_publish_event):
        """Test emitting task_started event."""
        project_id = "test-project"
        task_id = "test-project:my-task"
        spec_id = "my-task"
        pid = 12345
        metadata = {"auto_continue": True, "skip_qa": False, "model": "claude-3-5-sonnet"}
        
        await event_emitter.emit_task_started(
            project_id=project_id,
            task_id=task_id,
            spec_id=spec_id,
            pid=pid,
            metadata=metadata,
        )
        
        # Verify publish_event was called correctly
        mock_publish_event.assert_called_once()
        call_args = mock_publish_event.call_args
        
        # Check channel
        assert call_args[0][0] == Channel.TASK_STATUS
        
        # Check scope
        scope = call_args[0][1]
        assert scope["projectId"] == project_id
        assert scope["taskId"] == task_id
        assert scope["specId"] == spec_id
        
        # Check data
        data = call_args[0][2]
        assert data["event_type"] == "task_started"
        assert data["pid"] == pid
        assert data["metadata"] == metadata
        assert "timestamp" in data
    
    @pytest.mark.asyncio
    async def test_emit_task_progress(self, event_emitter, mock_publish_event):
        """Test emitting task_progress event."""
        project_id = "test-project"
        task_id = "test-project:my-task"
        spec_id = "my-task"
        progress = {
            "subtasks_completed": 3,
            "subtasks_total": 10,
            "current_phase": "coding",
            "completion_percentage": 30,
        }
        
        await event_emitter.emit_task_progress(
            project_id=project_id,
            task_id=task_id,
            spec_id=spec_id,
            progress=progress,
        )
        
        # Verify publish_event was called correctly
        mock_publish_event.assert_called_once()
        call_args = mock_publish_event.call_args
        
        # Check channel (progress uses TASK_PROGRESS channel)
        assert call_args[0][0] == Channel.TASK_PROGRESS
        
        # Check data
        data = call_args[0][2]
        assert data["event_type"] == "task_progress"
        assert data["progress"] == progress
        assert "timestamp" in data
    
    @pytest.mark.asyncio
    async def test_emit_task_completed(self, event_emitter, mock_publish_event):
        """Test emitting task_completed event."""
        project_id = "test-project"
        task_id = "test-project:my-task"
        spec_id = "my-task"
        result = {
            "files_created": 5,
            "files_modified": 3,
            "tests_passed": True,
            "duration_seconds": 120,
        }
        
        await event_emitter.emit_task_completed(
            project_id=project_id,
            task_id=task_id,
            spec_id=spec_id,
            result=result,
        )
        
        # Verify publish_event was called correctly
        mock_publish_event.assert_called_once()
        call_args = mock_publish_event.call_args
        
        # Check channel
        assert call_args[0][0] == Channel.TASK_STATUS
        
        # Check data
        data = call_args[0][2]
        assert data["event_type"] == "task_completed"
        assert data["result"] == result
        assert "timestamp" in data
    
    @pytest.mark.asyncio
    async def test_emit_task_failed(self, event_emitter, mock_publish_event):
        """Test emitting task_failed event."""
        project_id = "test-project"
        task_id = "test-project:my-task"
        spec_id = "my-task"
        error = "Task execution failed"
        error_details = {
            "failed_subtask": "implement_feature_x",
            "error_code": "EXECUTION_ERROR",
            "traceback": "...",
        }
        
        await event_emitter.emit_task_failed(
            project_id=project_id,
            task_id=task_id,
            spec_id=spec_id,
            error=error,
            error_details=error_details,
        )
        
        # Verify publish_event was called correctly
        mock_publish_event.assert_called_once()
        call_args = mock_publish_event.call_args
        
        # Check channel
        assert call_args[0][0] == Channel.TASK_STATUS
        
        # Check data
        data = call_args[0][2]
        assert data["event_type"] == "task_failed"
        assert data["error"] == error
        assert data["error_details"] == error_details
        assert "timestamp" in data
    
    @pytest.mark.asyncio
    async def test_emit_task_cancelled(self, event_emitter, mock_publish_event):
        """Test emitting task_cancelled event."""
        project_id = "test-project"
        task_id = "test-project:my-task"
        spec_id = "my-task"
        reason = "User requested stop"
        
        await event_emitter.emit_task_cancelled(
            project_id=project_id,
            task_id=task_id,
            spec_id=spec_id,
            reason=reason,
        )
        
        # Verify publish_event was called correctly
        mock_publish_event.assert_called_once()
        call_args = mock_publish_event.call_args
        
        # Check channel
        assert call_args[0][0] == Channel.TASK_STATUS
        
        # Check data
        data = call_args[0][2]
        assert data["event_type"] == "task_cancelled"
        assert data["reason"] == reason
        assert "timestamp" in data
    
    @pytest.mark.asyncio
    async def test_emit_task_cancelled_default_reason(self, event_emitter, mock_publish_event):
        """Test emitting task_cancelled event with default reason."""
        project_id = "test-project"
        task_id = "test-project:my-task"
        spec_id = "my-task"
        
        await event_emitter.emit_task_cancelled(
            project_id=project_id,
            task_id=task_id,
            spec_id=spec_id,
        )
        
        # Verify default reason is used
        call_args = mock_publish_event.call_args
        data = call_args[0][2]
        assert data["reason"] == "Manually stopped by user"
    
    @pytest.mark.asyncio
    async def test_error_handling(self, event_emitter):
        """Test that event emission errors are caught and logged."""
        # Mock publish_event to raise an exception
        with patch("apps.backend.web.ws.events.publish_event", new_callable=AsyncMock) as mock_publish:
            mock_publish.side_effect = Exception("Network error")
            
            # Should not raise exception (error is caught and logged)
            await event_emitter.emit_task_started(
                project_id="test",
                task_id="test:task",
                spec_id="task",
                pid=123,
            )
            
            # Verify it was called (and failed internally)
            mock_publish.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_multiple_events_in_sequence(self, event_emitter, mock_publish_event):
        """Test emitting multiple events in sequence."""
        project_id = "test-project"
        task_id = "test-project:my-task"
        spec_id = "my-task"
        
        # Emit multiple events
        await event_emitter.emit_task_started(project_id, task_id, spec_id, pid=123)
        await event_emitter.emit_task_progress(
            project_id, task_id, spec_id, {"completed": 1}
        )
        await event_emitter.emit_task_progress(
            project_id, task_id, spec_id, {"completed": 2}
        )
        await event_emitter.emit_task_completed(project_id, task_id, spec_id)
        
        # Verify all events were emitted
        assert mock_publish_event.call_count == 4


class TestGetEventEmitter:
    """Test the get_event_emitter singleton function."""
    
    def test_singleton_pattern(self):
        """Test that get_event_emitter returns the same instance."""
        emitter1 = get_event_emitter()
        emitter2 = get_event_emitter()
        
        assert emitter1 is emitter2
    
    def test_returns_task_event_emitter(self):
        """Test that get_event_emitter returns a TaskEventEmitter instance."""
        emitter = get_event_emitter()
        
        assert isinstance(emitter, TaskEventEmitter)


class TestEventSerialization:
    """Test event data serialization."""
    
    @pytest.mark.asyncio
    async def test_event_data_is_json_serializable(self, event_emitter, mock_publish_event):
        """Test that all event data can be JSON serialized."""
        project_id = "test-project"
        task_id = "test-project:my-task"
        spec_id = "my-task"
        
        # Test task_started
        await event_emitter.emit_task_started(
            project_id, task_id, spec_id, pid=123, metadata={"key": "value"}
        )
        data = mock_publish_event.call_args[0][2]
        json.dumps(data)  # Should not raise
        
        # Test task_progress
        await event_emitter.emit_task_progress(
            project_id, task_id, spec_id, {"completed": 5, "total": 10}
        )
        data = mock_publish_event.call_args[0][2]
        json.dumps(data)  # Should not raise
        
        # Test task_completed
        await event_emitter.emit_task_completed(
            project_id, task_id, spec_id, {"files": 10}
        )
        data = mock_publish_event.call_args[0][2]
        json.dumps(data)  # Should not raise
        
        # Test task_failed
        await event_emitter.emit_task_failed(
            project_id, task_id, spec_id, "Error", {"code": 500}
        )
        data = mock_publish_event.call_args[0][2]
        json.dumps(data)  # Should not raise
        
        # Test task_cancelled
        await event_emitter.emit_task_cancelled(project_id, task_id, spec_id)
        data = mock_publish_event.call_args[0][2]
        json.dumps(data)  # Should not raise


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
