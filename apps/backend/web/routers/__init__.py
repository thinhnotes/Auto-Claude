"""
Web API Routers
===============

FastAPI routers for different API endpoints.

- projects: Project management endpoints
- tasks: Task/spec management endpoints
- settings: Application settings endpoints
- profiles: Claude profile management endpoints
- worktrees: Git worktree management endpoints
- insights: AI chat insights endpoints
- claude_cli: Claude Code CLI detection and management
- terminals: WebSocket-based terminal (PTY) support
- context: Project context (index and memory) endpoints
"""

from .projects import router as projects_router
from .settings import router as settings_router
from .tasks import router as tasks_router
from .profiles import router as profiles_router
from .worktrees import router as worktrees_router
from .insights import router as insights_router
from .claude_cli import router as claude_cli_router
from .terminals import router as terminals_router
from .context import router as context_router

__all__ = [
    "projects_router",
    "tasks_router",
    "settings_router",
    "profiles_router",
    "worktrees_router",
    "insights_router",
    "claude_cli_router",
    "terminals_router",
    "context_router",
]
