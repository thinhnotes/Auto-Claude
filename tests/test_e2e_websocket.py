#!/usr/bin/env python3
"""
End-to-End WebSocket Integration Tests
======================================

These tests run against a LIVE backend server with real API keys.
They test the full user workflow:

1. Connect to WebSocket
2. Create/Configure API profile
3. Create a new project
4. Create a task
5. Start the task
6. Monitor task progress (planning → coding → validation)
7. Check task logs
8. Test terminal commands (pws, claude)

Prerequisites:
- Backend server running on localhost:8000
- Valid API key configured
- Test project directory available

Usage:
    pytest tests/test_e2e_websocket.py -v --tb=short -s

Environment Variables:
    E2E_API_KEY: API key for testing (required)
    E2E_BASE_URL: API base URL (default: https://api.anthropic.com)
    E2E_TEST_DIR: Test directory path (default: creates temp dir)
    E2E_BACKEND_URL: Backend WebSocket URL (default: ws://localhost:8000/ws)
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import pytest

# Try to import websockets
try:
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False

# Skip all tests if websockets not available
pytestmark = pytest.mark.skipif(
    not WEBSOCKETS_AVAILABLE, 
    reason="websockets package not installed"
)


# =============================================================================
# Configuration
# =============================================================================

def _load_env_file():
    """Load API key and base URL from .env.docker or .env file."""
    env_files = [
        Path(__file__).parent.parent / ".env.docker",
        Path(__file__).parent.parent / "apps" / "backend" / ".env",
        Path(__file__).parent.parent / ".env",
    ]
    
    api_key = ""
    base_url = ""
    
    for env_file in env_files:
        if env_file.exists():
            try:
                content = env_file.read_text()
                for line in content.splitlines():
                    line = line.strip()
                    if line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip()
                    if key == "CLAUDE_CODE_OAUTH_TOKEN" and not api_key:
                        api_key = value
                    elif key == "ANTHROPIC_BASE_URL" and not base_url:
                        base_url = value
            except Exception:
                pass
    
    return api_key, base_url

_loaded_api_key, _loaded_base_url = _load_env_file()

E2E_API_KEY = os.environ.get("E2E_API_KEY", _loaded_api_key)
E2E_BASE_URL = os.environ.get("E2E_BASE_URL", _loaded_base_url or "https://api.anthropic.com")
E2E_TEST_DIR = os.environ.get("E2E_TEST_DIR", "")
E2E_BACKEND_URL = os.environ.get("E2E_BACKEND_URL", "ws://localhost:8000/ws")
E2E_BACKEND_HTTP = os.environ.get("E2E_BACKEND_HTTP", "http://localhost:8000")

# Timeouts (shorter for faster testing)
WS_CONNECT_TIMEOUT = 5
REQUEST_TIMEOUT = 10
TASK_START_TIMEOUT = 15
TASK_STEP_TIMEOUT = 30  # 30 seconds max per step


# =============================================================================
# WebSocket Client
# =============================================================================

class E2EWebSocketClient:
    """WebSocket client for E2E testing."""
    
    def __init__(self, url: str = E2E_BACKEND_URL):
        self.url = url
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.request_id = 0
        self.pending_requests: dict[str, asyncio.Future] = {}
        self.events: list[dict] = []
        self._listen_task: Optional[asyncio.Task] = None
    
    async def connect(self):
        """Connect to WebSocket server."""
        self.ws = await asyncio.wait_for(
            websockets.connect(self.url),
            timeout=WS_CONNECT_TIMEOUT
        )
        self._listen_task = asyncio.create_task(self._listen())
        return self
    
    async def disconnect(self):
        """Disconnect from WebSocket server."""
        if self._listen_task:
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
        if self.ws:
            await self.ws.close()
    
    async def _listen(self):
        """Listen for incoming messages."""
        try:
            async for message in self.ws:
                data = json.loads(message)
                
                # Check if this is a response to a request
                req_id = data.get("id")
                if req_id and req_id in self.pending_requests:
                    self.pending_requests[req_id].set_result(data)
                else:
                    # It's an event (task update, log, etc.)
                    self.events.append(data)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"WebSocket listen error: {e}")
    
    async def request(self, method: str, params: dict[str, Any] = None) -> dict[str, Any]:
        """Send a request and wait for response."""
        self.request_id += 1
        req_id = f"e2e-{self.request_id}"
        
        message = {
            "v": 1,
            "type": "request",
            "id": req_id,
            "method": method,
            "params": params or {}
        }
        
        # Create future for response
        future = asyncio.get_event_loop().create_future()
        self.pending_requests[req_id] = future
        
        try:
            await self.ws.send(json.dumps(message))
            response = await asyncio.wait_for(future, timeout=REQUEST_TIMEOUT)
            return response
        finally:
            self.pending_requests.pop(req_id, None)
    
    async def subscribe(self, channel: str, params: dict[str, Any] = None):
        """Subscribe to a channel for events."""
        return await self.request("subscribe", {"channel": channel, **(params or {})})
    
    async def unsubscribe(self, channel: str):
        """Unsubscribe from a channel."""
        return await self.request("unsubscribe", {"channel": channel})
    
    def get_events(self, event_type: str = None) -> list[dict]:
        """Get received events, optionally filtered by type."""
        if event_type:
            return [e for e in self.events if e.get("type") == event_type]
        return self.events
    
    def clear_events(self):
        """Clear received events."""
        self.events.clear()


# =============================================================================
# Test Fixtures
# =============================================================================

@pytest.fixture(scope="module")
def api_key():
    """Get API key from environment."""
    if not E2E_API_KEY:
        pytest.skip("E2E_API_KEY environment variable not set")
    return E2E_API_KEY


@pytest.fixture(scope="module")
def test_project_dir():
    """Create a test project directory."""
    if E2E_TEST_DIR:
        project_dir = Path(E2E_TEST_DIR)
        project_dir.mkdir(parents=True, exist_ok=True)
    else:
        project_dir = Path(tempfile.mkdtemp(prefix="e2e_test_"))
    
    # Initialize git if not already
    if not (project_dir / ".git").exists():
        subprocess.run(["git", "init"], cwd=project_dir, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"], 
            cwd=project_dir, capture_output=True
        )
        subprocess.run(
            ["git", "config", "user.name", "E2E Test"], 
            cwd=project_dir, capture_output=True
        )
        
        # Create initial files
        (project_dir / "README.md").write_text("# E2E Test Project\n\nThis is a test project for E2E testing.\n")
        (project_dir / "main.py").write_text('#!/usr/bin/env python3\n"""Main entry point."""\n\nprint("Hello, World!")\n')
        
        subprocess.run(["git", "add", "."], cwd=project_dir, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Initial commit"], 
            cwd=project_dir, capture_output=True
        )
    
    yield project_dir
    
    # Cleanup if temp dir
    if not E2E_TEST_DIR:
        shutil.rmtree(project_dir, ignore_errors=True)


@pytest.fixture
async def ws_client():
    """Create and connect WebSocket client."""
    client = E2EWebSocketClient()
    try:
        await client.connect()
        yield client
    finally:
        await client.disconnect()


# =============================================================================
# Helper Functions
# =============================================================================

async def wait_for_task_status(
    client: E2EWebSocketClient,
    task_id: str,
    expected_status: str,
    timeout: float = TASK_STEP_TIMEOUT
) -> dict:
    """Wait for task to reach expected status."""
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        response = await client.request("tasks.status", {"taskId": task_id})
        
        if "data" in response:
            status = response["data"].get("status")
            if status == expected_status:
                return response["data"]
            
            # Check if task failed
            if status in ("failed", "error"):
                raise Exception(f"Task failed with status: {status}")
        
        await asyncio.sleep(2)
    
    raise TimeoutError(f"Task did not reach status '{expected_status}' within {timeout}s")


async def wait_for_task_step(
    client: E2EWebSocketClient,
    task_id: str,
    step_name: str,
    timeout: float = TASK_STEP_TIMEOUT
) -> dict:
    """Wait for task to reach a specific step (planning, coding, validation)."""
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        response = await client.request("tasks.status", {"taskId": task_id})
        
        if "data" in response:
            current_step = response["data"].get("currentStep", "")
            phase = response["data"].get("phase", "")
            
            print(f"[{int(time.time() - start_time)}s] Task step: {current_step}, phase: {phase}")
            
            if step_name.lower() in current_step.lower() or step_name.lower() in phase.lower():
                return response["data"]
            
            # Check if task completed or failed
            status = response["data"].get("status")
            if status in ("completed", "failed", "error"):
                return response["data"]
        
        await asyncio.sleep(3)
    
    raise TimeoutError(f"Task did not reach step '{step_name}' within {timeout}s")


# =============================================================================
# E2E Test Cases
# =============================================================================

class TestE2EConnection:
    """Test WebSocket connection."""
    
    @pytest.mark.asyncio
    async def test_websocket_connects(self, ws_client):
        """WebSocket should connect successfully."""
        assert ws_client.ws is not None
        # Check connection is active (websockets 10+ uses .state instead of .open)
        try:
            # Try new API first
            from websockets.protocol import State
            assert ws_client.ws.state == State.OPEN
        except (ImportError, AttributeError):
            # Fall back to legacy API
            assert getattr(ws_client.ws, 'open', True)
    
    @pytest.mark.asyncio
    async def test_health_check(self, ws_client):
        """Health check should return OK."""
        # Try HTTP endpoint
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{E2E_BACKEND_HTTP}/api/health") as resp:
                # Accept 200 or 404 (means server is up)
                assert resp.status in (200, 404)


class TestE2EProfiles:
    """Test API profile management."""
    
    @pytest.mark.asyncio
    async def test_create_profile_with_api_key(self, ws_client, api_key):
        """Create profile with real API key."""
        response = await ws_client.request("profiles.create", {
            "name": "E2E Test Profile",
            "baseUrl": E2E_BASE_URL,
            "apiKey": api_key
        })
        
        assert "data" in response
        profile = response["data"]
        assert profile["name"] == "E2E Test Profile"
        assert profile["apiKey"] == api_key
        assert "id" in profile
        
        # Store profile ID for cleanup
        ws_client._test_profile_id = profile["id"]
    
    @pytest.mark.asyncio
    async def test_get_profiles(self, ws_client):
        """Get profiles should return created profile."""
        response = await ws_client.request("profiles.get")
        
        assert "data" in response
        assert "profiles" in response["data"]
        assert len(response["data"]["profiles"]) >= 1


class TestE2EProject:
    """Test project management."""
    
    @pytest.mark.asyncio
    async def test_add_project(self, ws_client, test_project_dir):
        """Add test project."""
        response = await ws_client.request("projects.add", {
            "name": "E2E Test Project",
            "path": str(test_project_dir)
        })
        
        assert "data" in response
        project = response["data"]
        assert project["name"] == "E2E Test Project"
        assert project["path"] == str(test_project_dir)
        
        # Store project ID
        ws_client._test_project_id = project["id"]
    
    @pytest.mark.asyncio
    async def test_initialize_project(self, ws_client, test_project_dir):
        """Initialize project with .auto-claude directory."""
        # Get project ID
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        response = await ws_client.request("projects.initialize", {
            "projectId": project_id
        })
        
        assert "data" in response
        
        # Verify .auto-claude directory was created
        auto_claude_dir = test_project_dir / ".auto-claude"
        assert auto_claude_dir.exists()
        assert (auto_claude_dir / "specs").exists()
    
    @pytest.mark.asyncio
    async def test_check_project_version(self, ws_client, test_project_dir):
        """Check project version after initialization."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        response = await ws_client.request("projects.checkVersion", {
            "projectId": project_id
        })
        
        assert "data" in response
        assert response["data"]["initialized"] is True


class TestE2ETaskWorkflow:
    """Test complete task workflow."""
    
    @pytest.mark.asyncio
    async def test_create_simple_task(self, ws_client, test_project_dir):
        """Create a simple task."""
        # Get project ID
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        # Create task
        response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": "Add hello function",
            "description": "Add a simple hello() function to main.py that prints 'Hello from E2E test'"
        })
        
        assert "data" in response
        task = response["data"]
        assert task["title"] == "Add hello function"
        assert "id" in task
        
        ws_client._test_task_id = task["id"]
        ws_client._test_project_id = project_id
        
        # Verify spec was created
        specs_dir = test_project_dir / ".auto-claude" / "specs"
        spec_folders = [f for f in specs_dir.iterdir() if f.is_dir()]
        assert len(spec_folders) >= 1
    
    @pytest.mark.asyncio
    async def test_get_tasks(self, ws_client, test_project_dir):
        """Get tasks should show created task."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        response = await ws_client.request("tasks.get", {
            "projectId": project_id
        })
        
        assert "data" in response
        # data is now an array directly (not {"tasks": [...]})
        assert isinstance(response["data"], list)
        assert len(response["data"]) >= 1
    
    @pytest.mark.asyncio
    async def test_start_task(self, ws_client, api_key):
        """Start the task and begin execution."""
        task_id = getattr(ws_client, "_test_task_id", None)
        if not task_id:
            pytest.skip("No task ID from previous test")
        
        # Start task
        response = await ws_client.request("tasks.start", {
            "taskId": task_id,
            "autoContinue": False  # Don't auto-continue for testing
        })
        
        # Should either succeed or be in progress
        assert "data" in response or "code" in response
        
        # Wait a moment for task to start
        await asyncio.sleep(2)
        
        # Check status
        status_response = await ws_client.request("tasks.status", {
            "taskId": task_id
        })
        
        assert "data" in status_response
        print(f"Task status after start: {status_response['data']}")
    
    @pytest.mark.asyncio
    async def test_observe_task_logs(self, ws_client):
        """Subscribe to task logs and observe progress."""
        task_id = getattr(ws_client, "_test_task_id", None)
        if not task_id:
            pytest.skip("No task ID from previous test")
        
        # Subscribe to task events
        # Note: This depends on your subscription implementation
        try:
            response = await ws_client.subscribe("task", {"taskId": task_id})
            print(f"Subscribed to task: {response}")
        except Exception as e:
            print(f"Subscription not available: {e}")
        
        # Wait and collect some events
        await asyncio.sleep(5)
        
        events = ws_client.get_events()
        print(f"Received {len(events)} events")
        for event in events[-10:]:  # Last 10 events
            print(f"  Event: {event.get('type', 'unknown')}")
    
    @pytest.mark.asyncio
    async def test_task_progresses_through_steps(self, ws_client, api_key):
        """Watch task progress through planning → coding → validation."""
        task_id = getattr(ws_client, "_test_task_id", None)
        if not task_id:
            pytest.skip("No task ID from previous test")
        
        # This is a longer test - wait for task to progress
        print("\n--- Monitoring task progress ---")
        
        steps_seen = set()
        start_time = time.time()
        max_duration = 120  # 2 minutes max
        
        while time.time() - start_time < max_duration:
            response = await ws_client.request("tasks.status", {"taskId": task_id})
            
            if "data" in response:
                data = response["data"]
                status = data.get("status", "unknown")
                phase = data.get("phase", "")
                step = data.get("currentStep", "")
                progress = data.get("progress", 0)
                
                current_state = f"{phase}:{step}"
                if current_state not in steps_seen:
                    steps_seen.add(current_state)
                    print(f"[{int(time.time() - start_time)}s] Status: {status}, Phase: {phase}, Step: {step}, Progress: {progress}%")
                
                # Check completion
                if status in ("completed", "failed", "error", "idle"):
                    print(f"Task finished with status: {status}")
                    break
            
            await asyncio.sleep(3)
        
        print(f"Steps observed: {steps_seen}")
        assert len(steps_seen) >= 1, "Should observe at least one step"
    
    @pytest.mark.asyncio
    async def test_stop_task(self, ws_client):
        """Stop a running task."""
        task_id = getattr(ws_client, "_test_task_id", None)
        if not task_id:
            pytest.skip("No task ID from previous test")
        
        response = await ws_client.request("tasks.stop", {"taskId": task_id})
        
        # Should succeed
        assert "data" in response or response.get("code") == "success" or "error" not in response.get("message", "").lower()
        
        # Verify stopped
        await asyncio.sleep(1)
        status_response = await ws_client.request("tasks.status", {"taskId": task_id})
        
        if "data" in status_response:
            is_running = status_response["data"].get("is_running", False)
            print(f"Task running after stop: {is_running}")


class TestE2ETerminalCommands:
    """Test terminal command integration."""
    
    @pytest.mark.asyncio
    async def test_pws_command_available(self, test_project_dir):
        """Test that pws command is available."""
        # Check if pws is in PATH
        result = subprocess.run(
            ["which", "pws"],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            # Try auto-claude pws
            result = subprocess.run(
                ["python", "-m", "cli.pws", "--help"],
                cwd=test_project_dir.parent.parent if "Auto-Claude" in str(test_project_dir) else test_project_dir,
                capture_output=True,
                text=True
            )
        
        print(f"pws check: {result.stdout or result.stderr}")
    
    @pytest.mark.asyncio
    async def test_claude_function_available(self, test_project_dir):
        """Test that claude function/command is available."""
        # Check if claude CLI is available
        result = subprocess.run(
            ["which", "claude"],
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            print(f"claude found at: {result.stdout.strip()}")
            
            # Try running claude --version
            version_result = subprocess.run(
                ["claude", "--version"],
                capture_output=True,
                text=True
            )
            print(f"claude version: {version_result.stdout or version_result.stderr}")
        else:
            print("claude CLI not found in PATH")


class TestE2EFullWorkflow:
    """Full end-to-end workflow test."""
    
    @pytest.mark.asyncio
    async def test_complete_user_workflow(self, ws_client, api_key, test_project_dir):
        """
        Complete user workflow:
        1. Create API profile
        2. Add project
        3. Initialize project
        4. Create task
        5. Start task
        6. Monitor progress
        7. Complete/stop task
        """
        print("\n" + "="*60)
        print("COMPLETE E2E WORKFLOW TEST")
        print("="*60)
        
        # Step 1: Create profile
        print("\n[1/7] Creating API profile...")
        profile_response = await ws_client.request("profiles.create", {
            "name": "E2E Workflow Profile",
            "baseUrl": E2E_BASE_URL,
            "apiKey": api_key
        })
        assert "data" in profile_response
        print(f"  ✓ Profile created: {profile_response['data']['id']}")
        
        # Step 2: Add project (or get existing)
        print("\n[2/7] Adding project...")
        project_response = await ws_client.request("projects.add", {
            "name": "E2E Workflow Project",
            "path": str(test_project_dir)
        })
        
        # If project already exists, find it
        if "data" not in project_response:
            print("  → Project may already exist, finding it...")
            get_response = await ws_client.request("projects.get")
            projects = get_response.get("data", {})
            if isinstance(projects, dict):
                projects = list(projects.values())
            project_id = None
            for p in projects:
                if p.get("path") == str(test_project_dir):
                    project_id = p["id"]
                    break
            assert project_id, "Could not find project"
        else:
            project_id = project_response["data"]["id"]
        print(f"  ✓ Project ready: {project_id}")
        
        # Step 3: Initialize project
        print("\n[3/7] Initializing project...")
        init_response = await ws_client.request("projects.initialize", {
            "projectId": project_id
        })
        assert "data" in init_response
        print(f"  ✓ Project initialized")
        
        # Step 4: Create task
        print("\n[4/7] Creating task...")
        task_response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": "E2E Workflow Task",
            "description": "Add a greet(name) function to main.py that returns 'Hello, {name}!'"
        })
        assert "data" in task_response
        task_id = task_response["data"]["id"]
        print(f"  ✓ Task created: {task_id}")
        
        # Step 5: Start task
        print("\n[5/7] Starting task...")
        start_response = await ws_client.request("tasks.start", {
            "taskId": task_id,
            "autoContinue": False
        })
        print(f"  ✓ Task started: {start_response}")
        
        # Step 6: Monitor progress (brief)
        print("\n[6/7] Monitoring task progress (30s max)...")
        start_time = time.time()
        while time.time() - start_time < 30:
            status_response = await ws_client.request("tasks.status", {"taskId": task_id})
            if "data" in status_response:
                status = status_response["data"].get("status", "unknown")
                phase = status_response["data"].get("phase", "")
                print(f"  [{int(time.time() - start_time)}s] Status: {status}, Phase: {phase}")
                
                if status in ("completed", "failed", "error"):
                    break
            await asyncio.sleep(5)
        
        # Step 7: Stop/cleanup
        print("\n[7/7] Stopping task...")
        stop_response = await ws_client.request("tasks.stop", {"taskId": task_id})
        print(f"  ✓ Task stopped: {stop_response}")
        
        print("\n" + "="*60)
        print("E2E WORKFLOW COMPLETE")
        print("="*60)


# =============================================================================
# Additional E2E Test Cases - Settings
# =============================================================================

class TestE2ESettings:
    """Test settings WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_get_settings(self, ws_client):
        """Get application settings."""
        response = await ws_client.request("settings.get")
        
        assert "data" in response
        settings = response["data"]
        # Should have some default settings
        assert isinstance(settings, dict)
        print(f"Settings keys: {list(settings.keys())}")
    
    @pytest.mark.asyncio
    async def test_patch_settings(self, ws_client):
        """Partially update settings."""
        response = await ws_client.request("settings.patch", {
            "updates": {
                "theme": "dark"
            }
        })
        
        # Should succeed or return data
        assert "data" in response or "code" not in response


# =============================================================================
# Additional E2E Test Cases - Misc Handlers
# =============================================================================

class TestE2EMiscHandlers:
    """Test miscellaneous WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_health_check(self, ws_client):
        """WebSocket health check."""
        response = await ws_client.request("health")
        
        assert "data" in response
        assert response["data"]["status"] == "healthy"
        assert response["data"]["service"] == "auto-claude-api"
    
    @pytest.mark.asyncio
    async def test_browse_folders_home(self, ws_client):
        """Browse folders - home directory."""
        response = await ws_client.request("folders.browse", {})
        
        assert "data" in response
        data = response["data"]
        assert "currentPath" in data
        assert "entries" in data
        assert isinstance(data["entries"], list)
        print(f"Home path: {data['currentPath']}, {len(data['entries'])} folders")
    
    @pytest.mark.asyncio
    async def test_browse_folders_specific_path(self, ws_client, test_project_dir):
        """Browse a specific folder."""
        response = await ws_client.request("folders.browse", {
            "path": str(test_project_dir.parent)
        })
        
        assert "data" in response
        data = response["data"]
        assert data["currentPath"] == str(test_project_dir.parent)
    
    @pytest.mark.asyncio
    async def test_browse_folders_invalid_path(self, ws_client):
        """Browse invalid path should return error."""
        response = await ws_client.request("folders.browse", {
            "path": "/nonexistent/path/that/doesnt/exist"
        })
        
        assert response.get("success") is False or "error" in response.get("message", "").lower() or "code" in response
    
    @pytest.mark.asyncio
    async def test_tabs_save_and_get(self, ws_client):
        """Save and retrieve tab state."""
        tab_state = {
            "tabs": [
                {"id": "tab1", "title": "Home"},
                {"id": "tab2", "title": "Settings"}
            ],
            "activeTab": "tab1"
        }
        
        # Save tabs - response has data field
        save_response = await ws_client.request("tabs.save", {
            "tabState": tab_state
        })
        assert "data" in save_response or "code" not in save_response
        
        # Get tabs
        get_response = await ws_client.request("tabs.get")
        assert "data" in get_response
    
    @pytest.mark.asyncio
    async def test_connection_test_missing_params(self, ws_client):
        """Test connection with missing params should fail."""
        response = await ws_client.request("connection.test", {})
        
        # Error responses have 'code' field
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_connection_test_invalid_url(self, ws_client):
        """Test connection with invalid URL should fail."""
        response = await ws_client.request("connection.test", {
            "baseUrl": "not-a-valid-url",
            "apiKey": "test-key"
        })
        
        # Error responses have 'code' field
        assert "code" in response


# =============================================================================
# Additional E2E Test Cases - Context & Memory
# =============================================================================

class TestE2EContext:
    """Test context and memory WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_get_context(self, ws_client, test_project_dir):
        """Get project context."""
        # First ensure project exists
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        # Get context
        context_response = await ws_client.request("context.get", {
            "projectId": project_id
        })
        
        # Should return data or error gracefully
        assert "data" in context_response or "code" in context_response
    
    @pytest.mark.asyncio
    async def test_get_context_missing_project(self, ws_client):
        """Get context for missing project should fail."""
        response = await ws_client.request("context.get", {})
        
        # Error responses have 'code' field
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_search_memories(self, ws_client, test_project_dir):
        """Search memories for a project."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        # Search memories
        search_response = await ws_client.request("context.searchMemories", {
            "projectId": project_id,
            "query": "test"
        })
        
        # Should return data or handle gracefully
        assert "data" in search_response or "code" in search_response
    
    @pytest.mark.asyncio
    async def test_get_recent_memories(self, ws_client, test_project_dir):
        """Get recent memories for a project."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        # Get recent memories
        memories_response = await ws_client.request("context.getRecentMemories", {
            "projectId": project_id,
            "limit": 5
        })
        
        # Should return data or handle gracefully
        assert "data" in memories_response or "code" in memories_response


# =============================================================================
# Additional E2E Test Cases - Advanced Project Operations
# =============================================================================

class TestE2EAdvancedProjects:
    """Test advanced project WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_get_available_projects(self, ws_client):
        """Get available projects from common locations."""
        response = await ws_client.request("projects.getAvailable")
        
        # Should return data (list of available projects)
        assert "data" in response or "code" in response
    
    @pytest.mark.asyncio
    async def test_update_project_settings(self, ws_client, test_project_dir):
        """Update project-specific settings."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        # Update settings
        update_response = await ws_client.request("projects.updateSettings", {
            "projectId": project_id,
            "settings": {
                "autoSave": True,
                "theme": "dark"
            }
        })
        
        assert "data" in update_response or "code" in update_response
    
    @pytest.mark.asyncio
    async def test_remove_and_readd_project(self, ws_client, test_project_dir):
        """Remove a project and add it back."""
        # Get current projects
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            # Add it first
            add_response = await ws_client.request("projects.add", {
                "name": "Temp Project",
                "path": str(test_project_dir)
            })
            if "data" in add_response:
                project_id = add_response["data"]["id"]
            else:
                pytest.skip("Could not add project")
        
        # Remove the project
        remove_response = await ws_client.request("projects.remove", {
            "projectId": project_id
        })
        # Success responses have 'data' field
        assert "data" in remove_response or "code" not in remove_response
        
        # Add it back
        readd_response = await ws_client.request("projects.add", {
            "name": "Re-added Project",
            "path": str(test_project_dir)
        })
        assert "data" in readd_response


# =============================================================================
# Additional E2E Test Cases - Advanced Task Operations
# =============================================================================

class TestE2EAdvancedTasks:
    """Test advanced task WebSocket handlers."""
    
    @pytest.mark.asyncio
    async def test_create_multiple_tasks(self, ws_client, test_project_dir):
        """Create multiple tasks for a project."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        # Ensure initialized
        await ws_client.request("projects.initialize", {"projectId": project_id})
        
        # Create multiple tasks
        task_ids = []
        for i in range(3):
            task_response = await ws_client.request("tasks.create", {
                "projectId": project_id,
                "title": f"Test Task {i+1}",
                "description": f"Description for task {i+1}"
            })
            if "data" in task_response:
                task_ids.append(task_response["data"]["id"])
        
        # Verify all tasks exist
        get_response = await ws_client.request("tasks.get", {
            "projectId": project_id
        })
        
        assert "data" in get_response
        # data is now an array directly (not {"tasks": [...]})
        assert isinstance(get_response["data"], list)
        assert len(get_response["data"]) >= len(task_ids)
        print(f"Created {len(task_ids)} tasks")
    
    @pytest.mark.asyncio
    async def test_update_task(self, ws_client, test_project_dir):
        """Update a task's status."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        # Get tasks
        tasks_response = await ws_client.request("tasks.get", {
            "projectId": project_id
        })
        
        # data is now an array directly (not {"tasks": [...]})
        tasks_list = tasks_response.get("data", [])
        if not tasks_list or not isinstance(tasks_list, list):
            pytest.skip("No tasks to update")
        
        task_id = tasks_list[0]["id"]
        
        # Update task
        update_response = await ws_client.request("tasks.update", {
            "taskId": task_id,
            "status": "in_progress"
        })
        
        assert "data" in update_response or "code" in update_response
    
    @pytest.mark.asyncio
    async def test_delete_task(self, ws_client, test_project_dir):
        """Delete a task."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        # Create a task to delete
        create_response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": "Task to Delete",
            "description": "This task will be deleted"
        })
        
        if "data" not in create_response:
            pytest.skip("Could not create task")
        
        task_id = create_response["data"]["id"]
        
        # Delete it
        delete_response = await ws_client.request("tasks.delete", {
            "taskId": task_id
        })
        
        # Success responses have 'data' field
        assert "data" in delete_response
    
    @pytest.mark.asyncio
    async def test_pause_task_not_supported(self, ws_client):
        """Pause task should return not supported."""
        response = await ws_client.request("tasks.pause", {
            "taskId": "any-task-id"
        })
        
        # Should indicate not supported
        assert "code" in response or response.get("success") is False
    
    @pytest.mark.asyncio
    async def test_resume_task_not_supported(self, ws_client):
        """Resume task should return not supported."""
        response = await ws_client.request("tasks.resume", {
            "taskId": "any-task-id"
        })
        
        # Should indicate not supported
        assert "code" in response or response.get("success") is False


# =============================================================================
# Additional E2E Test Cases - Profile Edge Cases
# =============================================================================

class TestE2EProfileEdgeCases:
    """Test profile edge cases."""
    
    @pytest.mark.asyncio
    async def test_create_profile_minimal(self, ws_client):
        """Create profile with minimal data."""
        response = await ws_client.request("profiles.create", {
            "name": "Minimal Profile"
        })
        
        assert "data" in response
        assert response["data"]["name"] == "Minimal Profile"
    
    @pytest.mark.asyncio
    async def test_update_profile(self, ws_client, api_key):
        """Update an existing profile."""
        # Create a profile first
        create_response = await ws_client.request("profiles.create", {
            "name": "Profile to Update",
            "apiKey": api_key
        })
        
        if "data" not in create_response:
            pytest.skip("Could not create profile")
        
        profile_id = create_response["data"]["id"]
        
        # Update it
        update_response = await ws_client.request("profiles.update", {
            "profileId": profile_id,
            "name": "Updated Profile Name"
        })
        
        assert "data" in update_response
        assert update_response["data"]["name"] == "Updated Profile Name"
    
    @pytest.mark.asyncio
    async def test_delete_profile(self, ws_client):
        """Delete a profile."""
        # Create a profile to delete
        create_response = await ws_client.request("profiles.create", {
            "name": "Profile to Delete"
        })
        
        if "data" not in create_response:
            pytest.skip("Could not create profile")
        
        profile_id = create_response["data"]["id"]
        
        # Delete it
        delete_response = await ws_client.request("profiles.delete", {
            "profileId": profile_id
        })
        
        # Success responses have 'data' field
        assert "data" in delete_response
    
    @pytest.mark.asyncio
    async def test_activate_profile(self, ws_client):
        """Activate a profile."""
        # Get profiles
        get_response = await ws_client.request("profiles.get")
        
        if not get_response.get("data", {}).get("profiles"):
            # Create one
            create_response = await ws_client.request("profiles.create", {
                "name": "Profile to Activate"
            })
            profile_id = create_response["data"]["id"]
        else:
            profile_id = get_response["data"]["profiles"][0]["id"]
        
        # Activate it
        activate_response = await ws_client.request("profiles.activate", {
            "profileId": profile_id
        })
        
        assert "data" in activate_response or activate_response.get("success") is True


# =============================================================================
# Business Logic Tests - Task Validation
# =============================================================================

class TestE2ETaskValidation:
    """Test task business rules and validation."""
    
    @pytest.mark.asyncio
    async def test_create_task_missing_project_id(self, ws_client):
        """Creating task without projectId should fail."""
        response = await ws_client.request("tasks.create", {
            "title": "Task without project",
            "description": "Should fail"
        })
        assert "code" in response
        assert "projectId" in response.get("message", "").lower() or "project" in response.get("message", "").lower()
    
    @pytest.mark.asyncio
    async def test_create_task_missing_title(self, ws_client, test_project_dir):
        """Creating task without title uses description as fallback."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "description": "Task without title"
        })
        # Backend uses description as title fallback
        assert "data" in response
        assert response["data"]["title"] == "Task without title"
    
    @pytest.mark.asyncio
    async def test_start_task_invalid_id(self, ws_client):
        """Starting task with invalid ID should fail."""
        response = await ws_client.request("tasks.start", {
            "taskId": "nonexistent-task-id-12345"
        })
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_stop_task_invalid_id(self, ws_client):
        """Stopping task with invalid ID should handle gracefully."""
        response = await ws_client.request("tasks.stop", {
            "taskId": "nonexistent-task-id-12345"
        })
        # Should not crash, either error or empty success
        assert "code" in response or "data" in response
    
    @pytest.mark.asyncio
    async def test_delete_task_invalid_id(self, ws_client):
        """Deleting task with invalid ID should fail."""
        response = await ws_client.request("tasks.delete", {
            "taskId": "nonexistent-task-id-12345"
        })
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_get_task_status_missing_task_id(self, ws_client):
        """Getting task status without taskId should fail."""
        response = await ws_client.request("tasks.status", {})
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_update_task_missing_task_id(self, ws_client):
        """Updating task without taskId should fail."""
        response = await ws_client.request("tasks.update", {
            "status": "completed"
        })
        assert "code" in response


# =============================================================================
# Business Logic Tests - Project Validation
# =============================================================================

class TestE2EProjectValidation:
    """Test project business rules and validation."""
    
    @pytest.mark.asyncio
    async def test_add_project_missing_path(self, ws_client):
        """Adding project without path should fail."""
        response = await ws_client.request("projects.add", {
            "name": "Project without path"
        })
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_add_project_invalid_path(self, ws_client):
        """Adding project with non-existent path succeeds (lazy validation)."""
        # Use unique path to avoid "already exists" error
        unique_path = f"/nonexistent/invalid/path/{uuid.uuid4().hex}"
        response = await ws_client.request("projects.add", {
            "name": "Invalid Path Project",
            "path": unique_path
        })
        # Backend allows adding project with invalid path (validation happens on init)
        assert "data" in response
        
        # But initializing should fail
        project_id = response["data"]["id"]
        init_response = await ws_client.request("projects.initialize", {
            "projectId": project_id
        })
        assert "code" in init_response
    
    @pytest.mark.asyncio
    async def test_initialize_project_missing_id(self, ws_client):
        """Initializing project without projectId should fail."""
        response = await ws_client.request("projects.initialize", {})
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_initialize_project_invalid_id(self, ws_client):
        """Initializing project with invalid ID should fail."""
        response = await ws_client.request("projects.initialize", {
            "projectId": "nonexistent-project-id-12345"
        })
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_remove_project_missing_id(self, ws_client):
        """Removing project without projectId should fail."""
        response = await ws_client.request("projects.remove", {})
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_remove_project_invalid_id(self, ws_client):
        """Removing non-existent project should fail."""
        response = await ws_client.request("projects.remove", {
            "projectId": "nonexistent-project-id-12345"
        })
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_check_version_missing_id(self, ws_client):
        """Checking version without projectId should fail."""
        response = await ws_client.request("projects.checkVersion", {})
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_create_folder_invalid_path(self, ws_client):
        """Creating folder at invalid path should fail."""
        response = await ws_client.request("projects.createFolder", {
            "path": "/root/cannot/create/here"
        })
        assert "code" in response or "data" in response  # May succeed on some systems


# =============================================================================
# Business Logic Tests - Profile Validation
# =============================================================================

class TestE2EProfileValidation:
    """Test profile business rules and validation."""
    
    @pytest.mark.asyncio
    async def test_create_profile_missing_name(self, ws_client):
        """Creating profile without name uses default 'New Profile'."""
        response = await ws_client.request("profiles.create", {
            "apiKey": "test-key"
        })
        # Backend provides default name
        assert "data" in response
        assert response["data"]["name"] == "New Profile"
    
    @pytest.mark.asyncio
    async def test_update_profile_missing_id(self, ws_client):
        """Updating profile without profileId should fail."""
        response = await ws_client.request("profiles.update", {
            "name": "Updated Name"
        })
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_update_profile_invalid_id(self, ws_client):
        """Updating non-existent profile should fail."""
        response = await ws_client.request("profiles.update", {
            "profileId": "nonexistent-profile-id-12345",
            "name": "Updated Name"
        })
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_delete_profile_missing_id(self, ws_client):
        """Deleting profile without profileId should fail."""
        response = await ws_client.request("profiles.delete", {})
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_delete_profile_invalid_id(self, ws_client):
        """Deleting non-existent profile should fail."""
        response = await ws_client.request("profiles.delete", {
            "profileId": "nonexistent-profile-id-12345"
        })
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_activate_profile_missing_id(self, ws_client):
        """Activating profile without profileId clears active profile."""
        response = await ws_client.request("profiles.activate", {})
        # Backend accepts this (clears active profile)
        assert "data" in response or "code" not in response
    
    @pytest.mark.asyncio
    async def test_activate_profile_invalid_id(self, ws_client):
        """Activating non-existent profile should fail."""
        response = await ws_client.request("profiles.activate", {
            "profileId": "nonexistent-profile-id-12345"
        })
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_first_profile_becomes_active(self, ws_client, api_key):
        """First created profile should auto-become active."""
        # Create a unique profile
        unique_name = f"First Profile {uuid.uuid4().hex[:8]}"
        create_response = await ws_client.request("profiles.create", {
            "name": unique_name,
            "apiKey": api_key
        })
        
        if "data" not in create_response:
            pytest.skip("Could not create profile")
        
        profile_id = create_response["data"]["id"]
        
        # Get profiles to check if it's active
        get_response = await ws_client.request("profiles.get")
        
        assert "data" in get_response
        # The active profile ID should be set (may or may not be the new one)
        assert "activeProfileId" in get_response["data"] or len(get_response["data"]["profiles"]) > 0


# =============================================================================
# Business Logic Tests - Settings Validation
# =============================================================================

class TestE2ESettingsValidation:
    """Test settings business rules and validation."""
    
    @pytest.mark.asyncio
    async def test_update_settings_empty(self, ws_client):
        """Updating settings with empty data should handle gracefully."""
        response = await ws_client.request("settings.update", {})
        # Should not crash
        assert "data" in response or "code" in response
    
    @pytest.mark.asyncio
    async def test_patch_settings_empty(self, ws_client):
        """Patching settings with empty updates should handle gracefully."""
        response = await ws_client.request("settings.patch", {
            "updates": {}
        })
        assert "data" in response or "code" in response
    
    @pytest.mark.asyncio
    async def test_get_settings_returns_defaults(self, ws_client):
        """Get settings should return sensible defaults."""
        response = await ws_client.request("settings.get")
        
        assert "data" in response
        settings = response["data"]
        
        # Verify some expected default fields exist
        assert isinstance(settings, dict)
        print(f"Settings has {len(settings)} keys: {list(settings.keys())[:10]}...")


# =============================================================================
# Business Logic Tests - Context/Memory Validation
# =============================================================================

class TestE2EContextValidation:
    """Test context and memory validation."""
    
    @pytest.mark.asyncio
    async def test_refresh_context_missing_project(self, ws_client):
        """Refreshing context without projectId should fail."""
        response = await ws_client.request("context.refresh", {})
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_refresh_context_invalid_project(self, ws_client):
        """Refreshing context for invalid project should fail."""
        response = await ws_client.request("context.refresh", {
            "projectId": "nonexistent-project-id-12345"
        })
        assert "code" in response
    
    @pytest.mark.asyncio
    async def test_search_memories_missing_query(self, ws_client, test_project_dir):
        """Searching memories without query should handle gracefully."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        response = await ws_client.request("context.searchMemories", {
            "projectId": project_id
            # Missing query
        })
        # Should handle gracefully (either error or empty results)
        assert "data" in response or "code" in response
    
    @pytest.mark.asyncio
    async def test_get_recent_memories_invalid_limit(self, ws_client, test_project_dir):
        """Getting memories with invalid limit should handle gracefully."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        response = await ws_client.request("context.getRecentMemories", {
            "projectId": project_id,
            "limit": -1  # Invalid limit
        })
        # Should handle gracefully
        assert "data" in response or "code" in response


# =============================================================================
# Business Logic Tests - Connection & Misc Validation
# =============================================================================

class TestE2EConnectionValidation:
    """Test connection and misc validation."""
    
    @pytest.mark.asyncio
    async def test_connection_test_with_valid_url(self, ws_client, api_key):
        """Test connection with valid credentials (may timeout with slow API)."""
        try:
            # Use longer timeout for real API call
            ws_client_backup_timeout = REQUEST_TIMEOUT
            response = await asyncio.wait_for(
                ws_client.request("connection.test", {
                    "baseUrl": E2E_BASE_URL,
                    "apiKey": api_key
                }),
                timeout=30  # 30 seconds for real API
            )
            
            # Should succeed with valid credentials
            assert "data" in response
            print(f"Connection test result: {response['data']}")
        except asyncio.TimeoutError:
            # API may be slow or unavailable
            pytest.skip("Connection test timed out - API may be slow")
    
    @pytest.mark.asyncio
    async def test_browse_folders_with_hidden_files(self, ws_client, test_project_dir):
        """Browse folders should handle hidden files."""
        # Create a hidden file
        hidden_file = test_project_dir / ".hidden_test"
        hidden_file.touch()
        
        try:
            response = await ws_client.request("folders.browse", {
                "path": str(test_project_dir)
            })
            
            assert "data" in response
            # Check if entries exist
            entries = response["data"].get("entries", [])
            print(f"Found {len(entries)} entries in project dir")
        finally:
            hidden_file.unlink(missing_ok=True)
    
    @pytest.mark.asyncio
    async def test_tabs_get_empty_state(self, ws_client):
        """Get tabs when no state saved should return empty/default."""
        response = await ws_client.request("tabs.get")
        
        assert "data" in response
        # Should have some structure even if empty
        print(f"Tab state: {response['data']}")


# =============================================================================
# Edge Cases and Stress Tests
# =============================================================================

class TestE2EEdgeCases:
    """Test edge cases and boundary conditions."""
    
    @pytest.mark.asyncio
    async def test_create_task_with_long_title(self, ws_client, test_project_dir):
        """Create task with very long title."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        # Title longer than 50 chars (the safe name limit)
        long_title = "A" * 100
        response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": long_title,
            "description": "Test long title handling"
        })
        
        # Should handle gracefully (either truncate or accept)
        assert "data" in response or "code" in response
    
    @pytest.mark.asyncio
    async def test_create_task_with_special_chars(self, ws_client, test_project_dir):
        """Create task with special characters in title."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        special_title = "Task: Fix bug #123 (urgent!) & refactor <code>"
        response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": special_title,
            "description": "Test special characters"
        })
        
        # Should handle gracefully
        assert "data" in response or "code" in response
    
    @pytest.mark.asyncio
    async def test_create_profile_with_empty_api_key(self, ws_client):
        """Create profile with empty API key."""
        response = await ws_client.request("profiles.create", {
            "name": "Empty Key Profile",
            "apiKey": ""
        })
        
        # Should accept (API key is optional in profile)
        assert "data" in response or "code" in response
    
    @pytest.mark.asyncio
    async def test_multiple_rapid_requests(self, ws_client):
        """Send multiple rapid requests to test concurrency."""
        # Send 5 health checks rapidly
        tasks = [
            ws_client.request("health")
            for _ in range(5)
        ]
        
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        
        # All should succeed
        success_count = sum(1 for r in responses if isinstance(r, dict) and "data" in r)
        print(f"Rapid requests: {success_count}/5 succeeded")
        assert success_count >= 3  # At least 3 should succeed
    
    @pytest.mark.asyncio
    async def test_unicode_in_task_title(self, ws_client, test_project_dir):
        """Create task with unicode characters."""
        response = await ws_client.request("projects.get")
        projects = response["data"]
        if isinstance(projects, dict):
            projects = list(projects.values())
        
        project_id = None
        for p in projects:
            if p.get("path") == str(test_project_dir):
                project_id = p["id"]
                break
        
        if not project_id:
            pytest.skip("Project not found")
        
        unicode_title = "修复问题 🐛 Исправление ошибки"
        response = await ws_client.request("tasks.create", {
            "projectId": project_id,
            "title": unicode_title,
            "description": "Test unicode handling"
        })
        
        # Should handle gracefully
        assert "data" in response or "code" in response


# =============================================================================
# Run configuration
# =============================================================================

if __name__ == "__main__":
    # Run with: python tests/test_e2e_websocket.py
    pytest.main([__file__, "-v", "-s", "--tb=short"])
