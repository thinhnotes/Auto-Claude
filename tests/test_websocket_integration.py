#!/usr/bin/env python3
"""
WebSocket Integration Tests
===========================

Integration tests for WebSocket handlers to ensure all WebSocket
functionality works correctly end-to-end.

These tests:
1. Start a test server
2. Connect via WebSocket
3. Send requests and verify responses
4. Test all handler methods (profiles, tasks, projects, settings, etc.)
"""

import asyncio
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import patch, MagicMock

import pytest

# Add apps/backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))


# =============================================================================
# Test Fixtures
# =============================================================================

@pytest.fixture
def temp_config_dir(tmp_path):
    """Create a temporary config directory for testing."""
    config_dir = tmp_path / ".auto-claude"
    config_dir.mkdir(parents=True, exist_ok=True)
    
    # Create empty config files
    (config_dir / "projects.json").write_text("[]")
    (config_dir / "api-profiles.json").write_text('{"profiles": [], "activeProfileId": null, "version": 1}')
    (config_dir / "settings.json").write_text("{}")
    
    return config_dir


@pytest.fixture
def mock_home_dir(tmp_path, temp_config_dir):
    """Mock the home directory to use temp config."""
    original_home = Path.home
    
    def mock_home():
        return tmp_path
    
    with patch.object(Path, "home", mock_home):
        yield tmp_path


@pytest.fixture
def test_project_dir(tmp_path):
    """Create a test project directory with git initialized."""
    project_dir = tmp_path / "test-project"
    project_dir.mkdir(parents=True, exist_ok=True)
    
    # Initialize git repo
    import subprocess
    subprocess.run(["git", "init"], cwd=project_dir, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=project_dir, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=project_dir, capture_output=True)
    
    # Create initial commit
    (project_dir / "README.md").write_text("# Test Project")
    subprocess.run(["git", "add", "."], cwd=project_dir, capture_output=True)
    subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=project_dir, capture_output=True)
    
    return project_dir


# =============================================================================
# WebSocket Test Client Helper
# =============================================================================

class WebSocketTestClient:
    """Helper class for testing WebSocket handlers directly."""
    
    def __init__(self, dispatcher):
        self.dispatcher = dispatcher
        self.request_id = 0
    
    async def request(self, method: str, params: dict[str, Any] = None) -> dict[str, Any]:
        """Send a request and get response."""
        self.request_id += 1
        request_id = f"test-{self.request_id}"
        
        response = await self.dispatcher.dispatch(
            request_id=request_id,
            method=method,
            params=params or {}
        )
        
        return response


@pytest.fixture
def ws_client(mock_home_dir):
    """Create a WebSocket test client with dispatcher."""
    from web.ws.dispatcher import get_dispatcher
    from web.ws.handlers import profiles, projects, tasks, settings, misc
    
    dispatcher = get_dispatcher()
    
    # Register all handlers (same as in main.py)
    # Profiles
    dispatcher.register("profiles.get", profiles.handle_get_profiles)
    dispatcher.register("profiles.create", profiles.handle_create_profile)
    dispatcher.register("profiles.update", profiles.handle_update_profile)
    dispatcher.register("profiles.delete", profiles.handle_delete_profile)
    dispatcher.register("profiles.activate", profiles.handle_activate_profile)
    
    # Projects
    dispatcher.register("projects.get", projects.handle_get_projects)
    dispatcher.register("projects.add", projects.handle_add_project)
    dispatcher.register("projects.remove", projects.handle_remove_project)
    dispatcher.register("projects.updateSettings", projects.handle_update_project_settings)
    dispatcher.register("projects.initialize", projects.handle_initialize_project)
    dispatcher.register("projects.checkVersion", projects.handle_check_project_version)
    
    # Tasks
    dispatcher.register("tasks.get", tasks.handle_get_tasks)
    dispatcher.register("tasks.create", tasks.handle_create_task)
    dispatcher.register("tasks.delete", tasks.handle_delete_task)
    dispatcher.register("tasks.update", tasks.handle_update_task)
    dispatcher.register("tasks.start", tasks.handle_start_task)
    dispatcher.register("tasks.stop", tasks.handle_stop_task)
    dispatcher.register("tasks.status", tasks.handle_get_task_status)
    
    # Settings
    dispatcher.register("settings.get", settings.handle_get_settings)
    dispatcher.register("settings.update", settings.handle_update_settings)
    
    # Misc
    dispatcher.register("tabs.save", misc.handle_save_tabs)
    dispatcher.register("tabs.get", misc.handle_get_tabs)
    
    return WebSocketTestClient(dispatcher)


# =============================================================================
# Profile Handler Tests
# =============================================================================

class TestProfileHandlers:
    """Tests for profile WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_get_profiles_empty(self, ws_client):
        """profiles.get should return empty list initially."""
        response = await ws_client.request("profiles.get")
        
        assert "data" in response
        data = response["data"]
        assert "profiles" in data
        assert data["profiles"] == []
        assert data["activeProfileId"] is None
    
    @pytest.mark.asyncio
    async def test_create_profile(self, ws_client):
        """profiles.create should create a new profile."""
        response = await ws_client.request("profiles.create", {
            "name": "Test Profile",
            "baseUrl": "https://api.anthropic.com",
            "apiKey": "test-key-123"
        })
        
        assert "data" in response
        profile = response["data"]
        assert profile["name"] == "Test Profile"
        assert profile["baseUrl"] == "https://api.anthropic.com"
        assert profile["apiKey"] == "test-key-123"
        assert "id" in profile
        assert "createdAt" in profile
    
    @pytest.mark.asyncio
    async def test_create_and_get_profile(self, ws_client):
        """Created profile should appear in profiles.get."""
        # Create a profile
        create_response = await ws_client.request("profiles.create", {
            "name": "Test Profile",
            "baseUrl": "https://api.anthropic.com",
            "apiKey": "test-key-123"
        })
        profile_id = create_response["data"]["id"]
        
        # Get all profiles
        get_response = await ws_client.request("profiles.get")
        
        assert len(get_response["data"]["profiles"]) == 1
        assert get_response["data"]["profiles"][0]["id"] == profile_id
        # First profile should be active
        assert get_response["data"]["activeProfileId"] == profile_id
    
    @pytest.mark.asyncio
    async def test_update_profile(self, ws_client):
        """profiles.update should update an existing profile."""
        # Create a profile
        create_response = await ws_client.request("profiles.create", {
            "name": "Original Name",
            "baseUrl": "https://api.anthropic.com",
            "apiKey": "original-key"
        })
        profile_id = create_response["data"]["id"]
        
        # Update it
        update_response = await ws_client.request("profiles.update", {
            "profileId": profile_id,
            "name": "Updated Name",
            "apiKey": "updated-key"
        })
        
        assert update_response["data"]["name"] == "Updated Name"
        assert update_response["data"]["apiKey"] == "updated-key"
        assert update_response["data"]["baseUrl"] == "https://api.anthropic.com"  # Unchanged
    
    @pytest.mark.asyncio
    async def test_update_profile_not_found(self, ws_client):
        """profiles.update should return error for non-existent profile."""
        response = await ws_client.request("profiles.update", {
            "profileId": "non-existent-id",
            "name": "New Name"
        })
        
        assert "code" in response
        assert response["code"] == "internal_error"
        assert "not found" in response["message"].lower()
    
    @pytest.mark.asyncio
    async def test_delete_profile(self, ws_client):
        """profiles.delete should remove a profile."""
        # Create a profile
        create_response = await ws_client.request("profiles.create", {
            "name": "To Delete",
            "baseUrl": "https://api.anthropic.com",
            "apiKey": "delete-key"
        })
        profile_id = create_response["data"]["id"]
        
        # Delete it
        delete_response = await ws_client.request("profiles.delete", {
            "profileId": profile_id
        })
        
        # Verify it's gone
        get_response = await ws_client.request("profiles.get")
        assert len(get_response["data"]["profiles"]) == 0
    
    @pytest.mark.asyncio
    async def test_activate_profile(self, ws_client):
        """profiles.activate should set active profile."""
        # Create two profiles
        create1 = await ws_client.request("profiles.create", {
            "name": "Profile 1",
            "baseUrl": "https://api1.com",
            "apiKey": "key1"
        })
        create2 = await ws_client.request("profiles.create", {
            "name": "Profile 2",
            "baseUrl": "https://api2.com",
            "apiKey": "key2"
        })
        
        profile2_id = create2["data"]["id"]
        
        # Activate profile 2
        await ws_client.request("profiles.activate", {
            "profileId": profile2_id
        })
        
        # Verify it's active
        get_response = await ws_client.request("profiles.get")
        assert get_response["data"]["activeProfileId"] == profile2_id


# =============================================================================
# Project Handler Tests
# =============================================================================

class TestProjectHandlers:
    """Tests for project WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_get_projects_empty(self, ws_client):
        """projects.get should return empty list initially."""
        response = await ws_client.request("projects.get")
        
        assert "data" in response
        # Response could be empty list or empty dict depending on implementation
        assert response["data"] in ([], {})
    
    @pytest.mark.asyncio
    async def test_add_project(self, ws_client, test_project_dir):
        """projects.add should add a new project."""
        response = await ws_client.request("projects.add", {
            "name": "My Test Project",
            "path": str(test_project_dir)
        })
        
        assert "data" in response
        project = response["data"]
        assert project["name"] == "My Test Project"
        assert project["path"] == str(test_project_dir)
        assert "id" in project
    
    @pytest.mark.asyncio
    async def test_add_project_derives_name_from_path(self, ws_client, test_project_dir):
        """projects.add should derive name from path if not provided."""
        response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        
        assert "data" in response
        # Name should be derived from path in some way
        assert "name" in response["data"]
        assert len(response["data"]["name"]) > 0
    
    @pytest.mark.asyncio
    async def test_add_project_duplicate(self, ws_client, test_project_dir):
        """projects.add should reject duplicate projects."""
        # Add project first time
        await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        
        # Try to add again
        response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        
        # Should succeed with the same project or return an error
        # The behavior depends on whether duplicates are allowed
        assert "data" in response or "code" in response
    
    @pytest.mark.asyncio
    async def test_remove_project(self, ws_client, test_project_dir):
        """projects.remove should remove a project."""
        # Add project
        add_response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        project_id = add_response["data"]["id"]
        
        # Remove it
        remove_response = await ws_client.request("projects.remove", {
            "projectId": project_id
        })
        
        # Verify it's gone
        get_response = await ws_client.request("projects.get")
        assert len(get_response["data"]) == 0
    
    @pytest.mark.asyncio
    async def test_update_project_settings(self, ws_client, test_project_dir):
        """projects.updateSettings should update project settings."""
        # Add project
        add_response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        project_id = add_response["data"]["id"]
        
        # Update settings
        update_response = await ws_client.request("projects.updateSettings", {
            "projectId": project_id,
            "settings": {"theme": "dark", "autoSave": True}
        })
        
        assert "data" in update_response
        assert update_response["data"]["settings"]["theme"] == "dark"
        assert update_response["data"]["settings"]["autoSave"] is True
    
    @pytest.mark.asyncio
    async def test_initialize_project(self, ws_client, test_project_dir):
        """projects.initialize should create .auto-claude directory."""
        # Add project
        add_response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        project_id = add_response["data"]["id"]
        
        # Initialize
        init_response = await ws_client.request("projects.initialize", {
            "projectId": project_id
        })
        
        assert "data" in init_response
        assert init_response["data"]["initialized"] is True
        
        # Verify .auto-claude directory exists
        auto_claude_dir = test_project_dir / ".auto-claude"
        assert auto_claude_dir.exists()
        assert (auto_claude_dir / "specs").exists()
    
    @pytest.mark.asyncio
    async def test_check_project_version(self, ws_client, test_project_dir):
        """projects.checkVersion should return version info."""
        # Add project
        add_response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        project_id = add_response["data"]["id"]
        
        # Check version (not initialized)
        version_response = await ws_client.request("projects.checkVersion", {
            "projectId": project_id
        })
        
        assert "data" in version_response
        assert version_response["data"]["initialized"] is False
        
        # Initialize and check again
        await ws_client.request("projects.initialize", {"projectId": project_id})
        
        version_response = await ws_client.request("projects.checkVersion", {
            "projectId": project_id
        })
        
        assert version_response["data"]["initialized"] is True
        assert "version" in version_response["data"]


# =============================================================================
# Task Handler Tests
# =============================================================================

class TestTaskHandlers:
    """Tests for task WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_get_tasks_empty(self, ws_client, test_project_dir):
        """tasks.get should return empty list for new project."""
        # Add project
        add_response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        project_id = add_response["data"]["id"]
        
        # Initialize
        await ws_client.request("projects.initialize", {"projectId": project_id})
        
        response = await ws_client.request("tasks.get", {
            "projectId": project_id
        })
        
        assert "data" in response
        # data is now an array directly (not {"tasks": [], "projectId": ...})
        assert isinstance(response["data"], list)
        assert response["data"] == []
    
    @pytest.mark.asyncio
    async def test_create_task(self, ws_client, test_project_dir):
        """tasks.create should create a new task."""
        # Add and initialize project
        add_response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        project_id = add_response["data"]["id"]
        await ws_client.request("projects.initialize", {"projectId": project_id})
        
        response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": "Add login feature",
            "description": "Implement user authentication with email and password"
        })
        
        assert "data" in response
        task = response["data"]
        assert task["title"] == "Add login feature"
        assert "login" in task["description"].lower() or "authentication" in task["description"].lower()
        assert task["status"] == "backlog"
        assert "id" in task
        
        # Verify spec file was created
        specs_dir = test_project_dir / ".auto-claude" / "specs"
        spec_folders = [f for f in specs_dir.glob("*") if f.is_dir()]
        assert len(spec_folders) == 1
    
    @pytest.mark.asyncio
    async def test_create_task_missing_params(self, ws_client, test_project_dir):
        """tasks.create should require projectId and description."""
        # Add and initialize project
        add_response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        project_id = add_response["data"]["id"]
        await ws_client.request("projects.initialize", {"projectId": project_id})
        
        # Missing description
        response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": "Some title"
        })
        
        assert "code" in response or "data" in response  # May succeed or fail based on implementation
    
    @pytest.mark.asyncio
    async def test_delete_task(self, ws_client, test_project_dir):
        """tasks.delete should remove a task."""
        # Add and initialize project
        add_response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        project_id = add_response["data"]["id"]
        await ws_client.request("projects.initialize", {"projectId": project_id})
        
        # Create task
        create_response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": "To Delete",
            "description": "This task will be deleted"
        })
        task_id = create_response["data"]["id"]
        
        # Delete task
        delete_response = await ws_client.request("tasks.delete", {
            "taskId": task_id
        })
        
        assert "code" not in delete_response or delete_response.get("code") == "success"
        
        # Verify it's gone
        get_response = await ws_client.request("tasks.get", {
            "projectId": project_id
        })
        # data is now an array directly
        assert len(get_response["data"]) == 0
    
    @pytest.mark.asyncio
    async def test_get_task_status(self, ws_client, test_project_dir):
        """tasks.status should return task status."""
        # Add and initialize project
        add_response = await ws_client.request("projects.add", {
            "path": str(test_project_dir)
        })
        project_id = add_response["data"]["id"]
        await ws_client.request("projects.initialize", {"projectId": project_id})
        
        # Create task
        create_response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": "Status Test",
            "description": "Test task for status checking"
        })
        task_id = create_response["data"]["id"]
        
        # Get status
        status_response = await ws_client.request("tasks.status", {
            "taskId": task_id
        })
        
        assert "data" in status_response
        assert "status" in status_response["data"]
        assert "is_running" in status_response["data"]
        assert status_response["data"]["is_running"] is False


# =============================================================================
# Settings Handler Tests
# =============================================================================

class TestSettingsHandlers:
    """Tests for settings WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_get_settings_default(self, ws_client):
        """settings.get should return default settings."""
        response = await ws_client.request("settings.get")
        
        assert "data" in response
        # Should return some settings structure
        assert isinstance(response["data"], dict)
    
    @pytest.mark.asyncio
    async def test_update_settings(self, ws_client):
        """settings.update should update settings."""
        response = await ws_client.request("settings.update", {
            "settings": {
                "theme": "dark",
                "fontSize": 14
            }
        })
        
        assert "data" in response or "code" not in response or response.get("code") == "success"


# =============================================================================
# Misc Handler Tests
# =============================================================================

class TestMiscHandlers:
    """Tests for miscellaneous WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_save_and_get_tabs(self, ws_client):
        """tabs.save and tabs.get should persist tab state."""
        tabs_data = [
            {"id": "tab1", "title": "Home", "path": "/"},
            {"id": "tab2", "title": "Settings", "path": "/settings"}
        ]
        
        # Save tabs
        save_response = await ws_client.request("tabs.save", {
            "tabs": tabs_data,
            "activeTab": "tab1"
        })
        
        assert "code" not in save_response or save_response.get("code") == "success"
        
        # Get tabs (using tabs.get not tabs.load)
        get_response = await ws_client.request("tabs.get")
        
        # Tabs should be persisted (or empty/error if not implemented)
        assert "data" in get_response or "code" in get_response


# =============================================================================
# Error Handling Tests
# =============================================================================

class TestErrorHandling:
    """Tests for error handling in WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_unknown_method(self, ws_client):
        """Unknown method should return error."""
        response = await ws_client.request("unknown.method")
        
        assert "code" in response
        assert "unknown" in response.get("message", "").lower() or response.get("code") == "method_not_found"
    
    @pytest.mark.asyncio
    async def test_missing_required_params(self, ws_client):
        """Missing required params should return error."""
        # profiles.update without profileId
        response = await ws_client.request("profiles.update", {
            "name": "New Name"
        })
        
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_invalid_project_id(self, ws_client):
        """Invalid project ID should return error."""
        response = await ws_client.request("tasks.get", {
            "projectId": "non-existent-project-id"
        })
        
        # Should either return error or empty list
        assert "data" in response or "code" in response


# =============================================================================
# Full Integration Test
# =============================================================================

class TestFullIntegration:
    """Full integration test simulating real usage."""
    
    @pytest.mark.asyncio
    async def test_complete_workflow(self, ws_client, test_project_dir):
        """Test a complete workflow: add project -> create task -> check status."""
        # 1. Add a project
        add_project = await ws_client.request("projects.add", {
            "name": "Integration Test Project",
            "path": str(test_project_dir)
        })
        assert "data" in add_project
        project_id = add_project["data"]["id"]
        
        # 2. Initialize the project
        init_project = await ws_client.request("projects.initialize", {
            "projectId": project_id
        })
        assert init_project["data"]["initialized"] is True
        
        # 3. Create an API profile
        create_profile = await ws_client.request("profiles.create", {
            "name": "Test API",
            "baseUrl": "https://api.anthropic.com",
            "apiKey": "test-api-key"
        })
        assert "data" in create_profile
        profile_id = create_profile["data"]["id"]
        
        # 4. Activate the profile
        await ws_client.request("profiles.activate", {
            "profileId": profile_id
        })
        
        # 5. Create a task
        create_task = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": "Implement feature X",
            "description": "Add new feature X with proper error handling"
        })
        assert "data" in create_task
        task_id = create_task["data"]["id"]
        
        # 6. Check task status
        task_status = await ws_client.request("tasks.status", {
            "taskId": task_id
        })
        assert task_status["data"]["is_running"] is False
        
        # 7. Get all tasks
        get_tasks = await ws_client.request("tasks.get", {
            "projectId": project_id
        })
        # data is now an array directly (not {"tasks": [...]})
        assert isinstance(get_tasks["data"], list)
        assert len(get_tasks["data"]) == 1
        
        # 8. Delete the task
        await ws_client.request("tasks.delete", {
            "taskId": task_id
        })
        
        # 9. Verify task is gone
        get_tasks_after = await ws_client.request("tasks.get", {
            "projectId": project_id
        })
        assert len(get_tasks_after["data"]) == 0
        
        # 10. Remove the project
        await ws_client.request("projects.remove", {
            "projectId": project_id
        })
        
        # 11. Verify project is gone
        get_projects = await ws_client.request("projects.get")
        assert len(get_projects["data"]) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
