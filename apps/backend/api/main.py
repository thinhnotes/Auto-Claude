"""
Auto Claude API — FastAPI Application
======================================

Main FastAPI application with CORS middleware, Socket.IO integration,
Local AI Bridge, and lifespan events. Serves as the backend for the Next.js web frontend.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import socketio
from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load apps/backend/.env before importing routes
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
if _ENV_FILE.exists():
    load_dotenv(_ENV_FILE, override=False)

from .auth import require_auth
from .routes.agents import router as agents_router
from .routes.changelog import router as changelog_router
from .routes.context import router as context_router
from .routes.env import router as env_router
from .routes.github import router as github_router
from .routes.gitlab import router as gitlab_router
from .routes.health import router as health_router
from .routes.ideation import router as ideation_router
from .routes.insights import router as insights_router
from .routes.projects import ProjectSettings, router as projects_router
from .routes.roadmap import router as roadmap_router
from .routes.settings import router as settings_router
from .routes.tasks import router as tasks_router
from .routes.terminal import router as terminal_router
from .routes.worktrees import router as worktrees_router
from .services.local_ai_service import local_ai_router
from .shared import API_TOKEN, _STORE_DIR, _load_store, _now_iso, _save_store
from .websocket.agent_ns import register_agent_namespace
from .websocket.events_ns import register_events_namespace
from .websocket.terminal_ns import get_terminal_service, register_terminal_namespace

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CORS origins — allow localhost + all *.notesvnn.click domains
# ---------------------------------------------------------------------------
_cors_origins_raw = os.environ.get("CORS_ALLOWED_ORIGINS", "")
CORS_ORIGINS: list[str] = (
    [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
    if _cors_origins_raw
    else [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3782",
        "http://127.0.0.1:3782",
        "https://multica.notesvnn.click",
        "https://deeptutor.notesvnn.click",
        "https://deeptutor-api.notesvnn.click",
        "https://aperant.notesvnn.click",
        "https://aperant-api.notesvnn.click",
    ]
)

# ---------------------------------------------------------------------------
# Socket.IO async server for real-time communication
# ---------------------------------------------------------------------------
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
)

# Register Socket.IO namespaces
register_terminal_namespace(sio)
register_agent_namespace(sio)
register_events_namespace(sio)


def _seed_default_projects() -> None:
    """Seed default workspace projects if projects.json is empty."""
    try:
        store = _load_store()
        projects = store.get("projects", [])
        if projects:
            return
        now = _now_iso()
        default_candidates = [
            ("ClawdCodeWorkspace", "/home/thinhnguyen/ClawdCodeWorkspace"),
            ("Aperant Web", "/home/thinhnguyen/.gemini/antigravity-cli/scratch/Aperant"),
        ]
        for name, ppath in default_candidates:
            if os.path.isdir(ppath):
                settings_dump = ProjectSettings(model="gemma-4").model_dump()
                projects.append(
                    {
                        "id": str(uuid.uuid4()),
                        "name": name,
                        "path": ppath,
                        "autoBuildPath": "",
                        "settings": settings_dump,
                        "createdAt": now,
                        "updatedAt": now,
                    }
                )
        if projects:
            store["projects"] = projects
            _save_store(store)
        for p in store.get("projects", []):
            specs_root = _STORE_DIR / "specs" / p["id"]
            if not specs_root.exists():
                t1 = specs_root / "001-local-ai-mi50-integration"
                t1.mkdir(parents=True, exist_ok=True)
                (t1 / "implementation_plan.json").write_text(
                    json.dumps(
                        {
                            "feature": "Kết nối Local AI (MI50 Gemma-4 & CLIProxy)",
                            "description": "Tích hợp AMD Instinct MI50 GPU (gemma-4, qwen3.8-moe) và Local CLIProxy (8317) vào Aperant Web UI & Backend.",
                            "status": "completed",
                            "phases": [
                                {
                                    "name": "Local AI Bridge",
                                    "subtasks": [
                                        {"id": "st-1", "description": "Anthropic /v1/messages Bridge", "status": "completed"},
                                        {"id": "st-2", "description": "Insights & Ideation Streaming", "status": "completed"},
                                    ],
                                }
                            ],
                            "created_at": _now_iso(),
                            "updated_at": _now_iso(),
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )
    except Exception as exc:
        logger.warning("Could not seed default projects: %s", exc)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Application lifespan: startup and shutdown events."""
    logger.info("AUTO_CLAUDE_API_TOKEN=%s", API_TOKEN)
    _seed_default_projects()
    yield
    await get_terminal_service().kill_all()


fastapi_app = FastAPI(
    title="Aperant Web API (Local AI)",
    description="Backend API for Aperant Web Frontend + Local AI Bridge",
    lifespan=lifespan,
)

# CORS middleware with wildcard regex for *.notesvnn.click
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"https?://([a-z0-9-]+\.)?notesvnn\.click|http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Register routes
# ---------------------------------------------------------------------------

# Public endpoints (health + Anthropic /v1/messages & Local AI status)
fastapi_app.include_router(health_router)
fastapi_app.include_router(local_ai_router)

# Protected routes
_auth_dep = [Depends(require_auth)]

fastapi_app.include_router(projects_router, dependencies=_auth_dep)
fastapi_app.include_router(tasks_router, dependencies=_auth_dep)
fastapi_app.include_router(settings_router, dependencies=_auth_dep)
fastapi_app.include_router(env_router, dependencies=_auth_dep)
fastapi_app.include_router(agents_router, dependencies=_auth_dep)
fastapi_app.include_router(terminal_router, dependencies=_auth_dep)
fastapi_app.include_router(github_router, dependencies=_auth_dep)
fastapi_app.include_router(gitlab_router, dependencies=_auth_dep)
fastapi_app.include_router(roadmap_router, dependencies=_auth_dep)
fastapi_app.include_router(ideation_router, dependencies=_auth_dep)
fastapi_app.include_router(insights_router, dependencies=_auth_dep)
fastapi_app.include_router(changelog_router, dependencies=_auth_dep)
fastapi_app.include_router(context_router, dependencies=_auth_dep)
fastapi_app.include_router(worktrees_router, dependencies=_auth_dep)

# Mount Socket.IO as ASGI sub-application
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
