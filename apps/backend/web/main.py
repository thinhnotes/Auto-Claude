"""
Auto Claude Web API - Main Application
=======================================

FastAPI application with CORS, routers, and WebSocket support.
"""

import logging
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

# Load .env BEFORE any other imports (critical for phase_config, etc.)
_BACKEND_DIR = Path(__file__).parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"
if _ENV_FILE.exists():
    try:
        from dotenv import load_dotenv

        load_dotenv(_ENV_FILE)
        print(f"[Web API] Loaded .env from {_ENV_FILE}")
    except ImportError:
        # Fallback: manually load .env
        import os

        with open(_ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip())
        print(f"[Web API] Loaded .env (manual) from {_ENV_FILE}")

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)

# Import secure logger AFTER basicConfig
from .utils.security import get_secure_logger

logger = get_secure_logger("auto-claude-api")

# Ensure parent directory is in path for imports
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from .routers import (
    claude_cli_router,
    context_router,
    git_router,
    insights_router,
    ollama_router,
    profiles_router,
    projects_router,
    roadmap_router,
    settings_router,
    source_env_router,
    tasks_router,
    terminals_router,
    worktrees_router,
)
from .ws import (
    ConnectionManager,
    ErrorCode,
    MessageType,
    create_ack,
    create_error,
    get_manager,
    validate_channel,
)
from .ws.dispatcher import get_dispatcher
from .ws.handlers import settings as settings_handlers
from .ws.handlers import profiles as profiles_handlers
from .ws.handlers import projects as projects_handlers
from .ws.handlers import tasks as tasks_handlers
from .ws.handlers import misc as misc_handlers
from .ws.handlers import context as context_handlers
from .ws.handlers import task_worktree as task_worktree_handlers
from .ws.handlers import files as files_handlers
from .ws.handlers import git as git_handlers
from .ws.handlers import env as env_handlers
from .ws.handlers import roadmap as roadmap_handlers
from .ws.handlers import ollama as ollama_handlers

from .ws.events import get_event_emitter

# Get global WebSocket manager
manager = get_manager()

# Get global request dispatcher
dispatcher = get_dispatcher()

event_emitter = get_event_emitter()
logger.info("📡 [Agent 1] Task event broadcasting system initialized")


def register_ws_handlers():
    """Register all WebSocket request handlers."""
    # Settings handlers
    dispatcher.register("settings.get", settings_handlers.handle_get_settings)
    dispatcher.register("settings.update", settings_handlers.handle_update_settings)
    dispatcher.register("settings.patch", settings_handlers.handle_patch_settings)
    
    # Profiles handlers
    dispatcher.register("profiles.get", profiles_handlers.handle_get_profiles)
    dispatcher.register("profiles.create", profiles_handlers.handle_create_profile)
    dispatcher.register("profiles.update", profiles_handlers.handle_update_profile)
    dispatcher.register("profiles.delete", profiles_handlers.handle_delete_profile)
    dispatcher.register("profiles.activate", profiles_handlers.handle_activate_profile)
    
    # Projects handlers
    dispatcher.register("projects.get", projects_handlers.handle_get_projects)
    dispatcher.register("projects.add", projects_handlers.handle_add_project)
    dispatcher.register("projects.remove", projects_handlers.handle_remove_project)
    dispatcher.register("projects.updateSettings", projects_handlers.handle_update_project_settings)
    dispatcher.register("projects.initialize", projects_handlers.handle_initialize_project)
    dispatcher.register("projects.checkVersion", projects_handlers.handle_check_project_version)
    dispatcher.register("projects.getAvailable", projects_handlers.handle_get_available_projects)
    dispatcher.register("projects.createFolder", projects_handlers.handle_create_project_folder)
    
    # Tasks handlers
    dispatcher.register("tasks.get", tasks_handlers.handle_get_tasks)
    dispatcher.register("tasks.create", tasks_handlers.handle_create_task)
    dispatcher.register("tasks.delete", tasks_handlers.handle_delete_task)
    dispatcher.register("tasks.update", tasks_handlers.handle_update_task)
    dispatcher.register("tasks.updateStatus", tasks_handlers.handle_update_status)
    dispatcher.register("tasks.start", tasks_handlers.handle_start_task)
    dispatcher.register("tasks.stop", tasks_handlers.handle_stop_task)
    dispatcher.register("tasks.pause", tasks_handlers.handle_pause_task)
    dispatcher.register("tasks.resume", tasks_handlers.handle_resume_task)
    dispatcher.register("tasks.getStatus", tasks_handlers.handle_get_task_status)
    dispatcher.register("tasks.submitReview", tasks_handlers.handle_submit_review)
    
    # Context handlers
    dispatcher.register("context.get", context_handlers.handle_get_context)
    dispatcher.register("context.refresh", context_handlers.handle_refresh_context)
    dispatcher.register("context.searchMemories", context_handlers.handle_search_memories)
    dispatcher.register("context.getRecentMemories", context_handlers.handle_get_recent_memories)
    
    # Misc handlers
    dispatcher.register("tabs.get", misc_handlers.handle_get_tabs)
    dispatcher.register("tabs.save", misc_handlers.handle_save_tabs)
    dispatcher.register("health", misc_handlers.handle_health_check)
    dispatcher.register("folders.browse", misc_handlers.handle_browse_folders)
    dispatcher.register("connection.test", misc_handlers.handle_test_connection)

    # Worktree Operations (Agent 4)
    dispatcher.register("tasks.worktree.status", task_worktree_handlers.handle_worktree_status)
    dispatcher.register("tasks.worktree.diff", task_worktree_handlers.handle_worktree_diff)
    dispatcher.register("tasks.worktree.merge", task_worktree_handlers.handle_worktree_merge)
    dispatcher.register("tasks.worktree.mergePreview", task_worktree_handlers.handle_worktree_merge_preview)
    dispatcher.register("tasks.worktree.discard", task_worktree_handlers.handle_worktree_discard)
    dispatcher.register("tasks.listWorktrees", task_worktree_handlers.handle_list_worktrees)
    dispatcher.register("tasks.clearStagedState", task_worktree_handlers.handle_clear_staged_state)

    # File Operations
    dispatcher.register("files.list", files_handlers.handle_list_files)
    dispatcher.register("files.getContent", files_handlers.handle_get_file_content)

    # Git Operations
    dispatcher.register("git.branches", git_handlers.handle_get_branches)
    dispatcher.register("git.currentBranch", git_handlers.handle_get_current_branch)
    dispatcher.register("git.detectMainBranch", git_handlers.handle_detect_main_branch)
    dispatcher.register("git.status", git_handlers.handle_git_status)
    dispatcher.register("git.init", git_handlers.handle_git_init)

    # Environment Config
    dispatcher.register("env.get", env_handlers.handle_get_env)
    dispatcher.register("env.update", env_handlers.handle_update_env)

    # Roadmap Operations
    dispatcher.register("roadmap.get", roadmap_handlers.handle_get_roadmap)
    dispatcher.register("roadmap.save", roadmap_handlers.handle_save_roadmap)
    dispatcher.register("roadmap.generate", roadmap_handlers.handle_generate_roadmap)
    dispatcher.register("roadmap.updateFeatureStatus", roadmap_handlers.handle_update_feature_status)

    # Ollama Operations
    dispatcher.register("ollama.status", ollama_handlers.handle_ollama_status)
    dispatcher.register("ollama.checkInstalled", ollama_handlers.handle_ollama_check_installed)
    dispatcher.register("ollama.listModels", ollama_handlers.handle_ollama_list_models)
    dispatcher.register("ollama.listEmbeddingModels", ollama_handlers.handle_ollama_list_embedding_models)
    dispatcher.register("ollama.pull", ollama_handlers.handle_ollama_pull)

    # Task Logs and Archive
    dispatcher.register("tasks.getLogs", tasks_handlers.handle_get_logs)
    dispatcher.register("tasks.archive", tasks_handlers.handle_archive_tasks)
    dispatcher.register("tasks.unarchive", tasks_handlers.handle_unarchive_tasks)


# Register handlers on module load
register_ws_handlers()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events for startup/shutdown."""
    # Startup
    logger.info("🚀 Auto Claude Web API starting...")
    logger.info("📡 API available at http://localhost:8000")
    logger.info("📖 API docs at http://localhost:8000/docs")

    # Log environment info for debugging
    from .utils.logging_utils import log_environment_info

    try:
        log_environment_info()
    except Exception as e:
        logger.warning(f"Could not log environment info: {e}")

    app.state.connection_manager = manager

    yield

    # Shutdown
    logger.info("👋 Auto Claude Web API shutting down...")
    for websocket in list(manager.connections.keys()):
        try:
            await websocket.close()
        except Exception:
            pass


app = FastAPI(
    title="Auto Claude API",
    description="Web API for Auto Claude autonomous coding framework",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware - allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming HTTP requests."""
    start_time = time.time()

    # Log incoming request
    client_host = request.client.host if request.client else "unknown"
    logger.info(f"➡️  {request.method} {request.url.path} from {client_host}")

    # Process request
    response = await call_next(request)

    # Log response
    duration_ms = (time.time() - start_time) * 1000
    status_emoji = "✅" if response.status_code < 400 else "❌"
    logger.info(
        f"{status_emoji} {request.method} {request.url.path} → {response.status_code} ({duration_ms:.1f}ms)"
    )

    return response


# Include routers
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])
app.include_router(tasks_router, prefix="/api", tags=["tasks"])
app.include_router(settings_router, prefix="/api/settings", tags=["settings"])
app.include_router(profiles_router, prefix="/api/profiles", tags=["profiles"])
app.include_router(worktrees_router, prefix="/api", tags=["worktrees"])
app.include_router(insights_router, prefix="/api", tags=["insights"])
app.include_router(claude_cli_router, prefix="/api", tags=["claude-cli"])
# Only include terminals router on Unix (Windows doesn't support pty/termios)
if sys.platform != "win32":
    app.include_router(terminals_router, prefix="/api", tags=["terminals"])
app.include_router(context_router, prefix="/api", tags=["context"])
app.include_router(git_router, prefix="/api", tags=["git"])
app.include_router(source_env_router, prefix="/api", tags=["source-env"])
app.include_router(ollama_router, prefix="/api", tags=["ollama"])
app.include_router(roadmap_router, prefix="/api", tags=["roadmap"])

# Mount static files for web UI
_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=_STATIC_DIR / "assets"), name="assets")

    @app.get("/")
    async def serve_spa():
        """Serve the web UI SPA."""
        index_file = _STATIC_DIR / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return {"message": "Auto Claude API is running. Web UI not found."}

    @app.get("/{full_path:path}")
    async def serve_spa_catchall(full_path: str):
        """Catch-all route for SPA - return index.html for all non-API routes."""
        # Don't intercept API routes - return 404
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            from fastapi import HTTPException

            raise HTTPException(status_code=404, detail="Not Found")

        # Serve index.html for all other routes (SPA routing)
        index_file = _STATIC_DIR / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return {"detail": "Not Found"}


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy", "service": "auto-claude-api"}


@app.post("/api/test-connection")
async def test_api_connection(request: dict) -> dict:
    """Test connection to an external API endpoint."""
    import httpx

    base_url = request.get("baseUrl", "")
    api_key = request.get("apiKey", "")

    if not base_url or not api_key:
        return {"success": False, "error": "Missing baseUrl or apiKey"}

    # Validate URL format
    if not base_url.startswith(("http://", "https://")):
        return {
            "success": False,
            "error": "Base URL must start with http:// or https://",
        }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Try multiple endpoint patterns for different API providers
            base = base_url.rstrip("/")
            endpoints_to_try = [
                ("/v1/models", {"x-api-key": api_key}),  # Anthropic-style
                ("/v1/models", {"Authorization": f"Bearer {api_key}"}),  # OpenAI-style
                ("/models", {"Authorization": f"Bearer {api_key}"}),  # Generic
            ]

            last_error = None
            for endpoint, headers in endpoints_to_try:
                try:
                    response = await client.get(f"{base}{endpoint}", headers=headers)
                    if response.status_code == 200:
                        return {
                            "success": True,
                            "data": {
                                "success": True,
                                "message": "Connection successful",
                            },
                        }
                    elif response.status_code == 401:
                        return {
                            "success": False,
                            "error": "Authentication failed - check your API key",
                        }
                    elif response.status_code == 403:
                        return {
                            "success": False,
                            "error": "Access forbidden - check API key permissions",
                        }
                    last_error = f"API returned status {response.status_code}"
                except httpx.RequestError as e:
                    last_error = str(e)
                    continue

            return {"success": False, "error": last_error or "Failed to connect to API"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/browse-folders")
async def browse_folders(path: str = "") -> dict:
    """Browse folders on the server for project selection."""

    # Default to home directory
    if not path:
        path = str(Path.home())

    try:
        base_path = Path(path).resolve()
        if not base_path.exists():
            return {"success": False, "error": "Path does not exist"}

        entries = []
        for entry in sorted(base_path.iterdir()):
            if entry.is_dir() and not entry.name.startswith("."):
                entries.append(
                    {"name": entry.name, "path": str(entry), "isDirectory": True}
                )

        return {
            "success": True,
            "data": {
                "currentPath": str(base_path),
                "parentPath": str(base_path.parent)
                if base_path.parent != base_path
                else None,
                "entries": entries,
            },
        }
    except PermissionError:
        return {"success": False, "error": "Permission denied"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# Tab state storage (in-memory for now, could be persisted)
_tab_state: dict = {}


@app.get("/api/tabs")
async def get_tab_state() -> dict:
    """Get the current tab state."""
    logger.info("📋 Tab state requested")
    return {"success": True, "data": _tab_state}


@app.put("/api/tabs")
async def save_tab_state(tab_state: dict) -> dict:
    """Save the tab state."""
    global _tab_state
    _tab_state = tab_state
    logger.info("💾 Tab state saved")
    return {"success": True}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time updates.

    Protocol:
    - Client sends: { "type": "hello|subscribe|unsubscribe|ping", ... }
    - Server sends: { "type": "ack|event|error|pong", ... }

    Supported channels:
    - task.status: Task status changes
    - task.progress: Subtask progress updates
    - task.logs: Real-time log streaming
    - roadmap.status: Roadmap generation status
    - project.updated: Project configuration changes
    """
    client_host = websocket.client.host if websocket.client else "unknown"
    logger.info(f"🔌 WebSocket connection from {client_host}")

    state = await manager.connect(websocket)
    logger.info(f"📊 Active WebSocket connections: {len(manager.connections)}")

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "ping")
            msg_id = data.get("id")
            
            logger.debug(f"📨 WebSocket message: {msg_type} from {client_host}")

            if msg_type == MessageType.PING.value:
                await websocket.send_json({"type": MessageType.PONG.value, "ts": data.get("ts")})
            
            elif msg_type == MessageType.HELLO.value:
                # Client handshake
                state.client_id = data.get("clientId")
                logger.info(f"👋 Client {client_host} ({state.client_id}) connected")
                await websocket.send_json(create_ack(msg_id or "hello"))
            
            elif msg_type == MessageType.SUBSCRIBE.value:
                channel = data.get("channel")
                scope = data.get("scope", {})
                
                if not channel:
                    await websocket.send_json(
                        create_error(ErrorCode.INVALID_MESSAGE, "Missing channel", msg_id)
                    )
                    continue
                
                if not validate_channel(channel):
                    await websocket.send_json(
                        create_error(ErrorCode.UNKNOWN_CHANNEL, f"Unknown channel: {channel}", msg_id)
                    )
                    continue
                
                success, error = await manager.subscribe(websocket, channel, scope)
                if success:
                    logger.info(f"📢 Client {client_host} subscribed to {channel} with scope {scope}")
                    await websocket.send_json(create_ack(msg_id or "subscribe", channel))
                else:
                    await websocket.send_json(
                        create_error(ErrorCode.INVALID_SCOPE, error or "Subscription failed", msg_id)
                    )
            
            elif msg_type == MessageType.UNSUBSCRIBE.value:
                channel = data.get("channel")
                scope = data.get("scope", {})
                
                if channel:
                    await manager.unsubscribe(websocket, channel, scope)
                    logger.info(f"🔕 Client {client_host} unsubscribed from {channel}")
                    await websocket.send_json(create_ack(msg_id or "unsubscribe", channel))
            
            elif msg_type == MessageType.REQUEST.value:
                # Handle request-response
                method = data.get("method")
                request_params = data.get("params", {})
                
                if not method:
                    await websocket.send_json(
                        create_error(ErrorCode.INVALID_MESSAGE, "Missing method", msg_id)
                    )
                    continue
                
                logger.info(f"📨 Request from {client_host}: {method}")
                
                # Dispatch to handler and send response
                response = await dispatcher.dispatch(msg_id or "request", method, request_params)
                await websocket.send_json(response)
            
            else:
                await websocket.send_json(
                    create_error(
                        ErrorCode.INVALID_MESSAGE,
                        f"Unknown message type: {msg_type}",
                        msg_id,
                    )
                )
    
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
        logger.info(f"🔌 WebSocket disconnected: {client_host}")
    except Exception as e:
        await manager.disconnect(websocket)
        logger.error(f"❌ WebSocket error from {client_host}: {e}")


async def broadcast_event(event_type: str, payload: dict[str, Any]):
    """Helper function to broadcast events to all connected clients."""
    await manager.broadcast({"type": event_type, **payload})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
