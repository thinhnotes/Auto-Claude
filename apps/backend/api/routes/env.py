"""
Environment Routes
===================

REST endpoints for per-project environment configuration (.env files).
Mirrors the data contract from the Electron IPC handlers (env-handlers.ts).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..shared import _AUTO_CLAUDE_DIRS, _find_project, parse_env_file, update_env_file

router = APIRouter(prefix="/api/projects", tags=["environment"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Keys whose values contain sensitive tokens and should be masked in responses
_SENSITIVE_KEYS = frozenset(
    {
        "CLAUDE_CODE_OAUTH_TOKEN",
        "GITHUB_TOKEN",
        "OPENAI_API_KEY",
        "GITLAB_TOKEN",
        "LINEAR_API_KEY",
    }
)


def _env_path(project: dict[str, Any]) -> Path:
    """Resolve the .env file path for a project."""
    project_path = project["path"]
    auto_build = project.get("autoBuildPath", "")
    if auto_build:
        return Path(project_path) / auto_build / ".env"
    # Fallback: check known auto-claude directories
    for dirname in _AUTO_CLAUDE_DIRS:
        candidate = Path(project_path) / dirname
        if candidate.is_dir():
            return candidate / ".env"
    # Default to .auto-claude
    return Path(project_path) / ".auto-claude" / ".env"


def _mask_value(key: str, value: str) -> str:
    """Mask sensitive token values — show only the last 4 characters."""
    env_key = _CONFIG_TO_ENV.get(key, "")
    if env_key in _SENSITIVE_KEYS and len(value) > 4:
        return "*" * (len(value) - 4) + value[-4:]
    return value


def _env_to_config(env_vars: dict[str, str], *, mask: bool = False) -> dict[str, Any]:
    """Map .env variables to a ProjectEnvConfig-style dict."""
    config: dict[str, Any] = {}
    for env_key, config_key in _ENV_TO_CONFIG.items():
        if env_key in env_vars:
            value = env_vars[env_key]
            if mask and env_key in _SENSITIVE_KEYS and len(value) > 4:
                value = "*" * (len(value) - 4) + value[-4:]
            config[config_key] = value

    # Boolean fields
    for env_key, config_key in _ENV_TO_CONFIG_BOOL.items():
        if env_key in env_vars:
            config[config_key] = env_vars[env_key].lower() == "true"

    return config


# String field mappings: ENV_KEY -> configKey
_ENV_TO_CONFIG: dict[str, str] = {
    "CLAUDE_CODE_OAUTH_TOKEN": "claudeOAuthToken",
    "AUTO_BUILD_MODEL": "autoBuildModel",
    "LINEAR_API_KEY": "linearApiKey",
    "LINEAR_TEAM_ID": "linearTeamId",
    "LINEAR_PROJECT_ID": "linearProjectId",
    "GITHUB_TOKEN": "githubToken",
    "GITHUB_REPO": "githubRepo",
    "DEFAULT_BRANCH": "defaultBranch",
    "OPENAI_API_KEY": "openaiApiKey",
    "GITLAB_TOKEN": "gitlabToken",
    "GITLAB_INSTANCE_URL": "gitlabInstanceUrl",
    "GITLAB_PROJECT": "gitlabProject",
}

# Reverse mapping: configKey -> ENV_KEY
_CONFIG_TO_ENV: dict[str, str] = {v: k for k, v in _ENV_TO_CONFIG.items()}

# Boolean field mappings
_ENV_TO_CONFIG_BOOL: dict[str, str] = {
    "LINEAR_REALTIME_SYNC": "linearRealtimeSync",
    "GITHUB_AUTO_SYNC": "githubAutoSync",
    "GRAPHITI_ENABLED": "graphitiEnabled",
    "GITLAB_ENABLED": "gitlabEnabled",
    "GITLAB_AUTO_SYNC": "gitlabAutoSync",
    "ENABLE_FANCY_UI": "enableFancyUi",
}

_CONFIG_BOOL_TO_ENV: dict[str, str] = {v: k for k, v in _ENV_TO_CONFIG_BOOL.items()}


def _config_to_env_lines(config: dict[str, Any]) -> dict[str, str]:
    """Map a ProjectEnvConfig-style dict back to env key-value pairs."""
    env_vars: dict[str, str] = {}
    for config_key, env_key in _CONFIG_TO_ENV.items():
        if config_key in config and config[config_key] is not None:
            env_vars[env_key] = str(config[config_key])
    for config_key, env_key in _CONFIG_BOOL_TO_ENV.items():
        if config_key in config and config[config_key] is not None:
            env_vars[env_key] = "true" if config[config_key] else "false"
    return env_vars


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class EnvConfigUpdate(BaseModel):
    """Partial env config update -- all fields optional."""

    model_config = {"extra": "allow"}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/{project_id}/env")
async def get_env(project_id: str) -> dict[str, Any]:
    """Read a project's environment configuration from its .env file.

    Sensitive token values are masked (only last 4 characters shown).
    """
    project = _find_project(project_id)
    env_file = _env_path(project)

    if not env_file.exists():
        default_cfg = {"autoBuildModel": "gemma-4", "graphitiEnabled": False}
        return {"success": True, "data": default_cfg, "config": default_cfg}

    try:
        env_vars = parse_env_file(env_file)
        config = _env_to_config(env_vars, mask=True)
        return {"success": True, "data": config, "config": config}
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read .env: {exc}")


@router.put("/{project_id}/env")
async def update_env(project_id: str, body: EnvConfigUpdate) -> dict[str, Any]:
    """Save a project's environment configuration to its .env file.

    Preserves comments and formatting of untouched lines.
    """
    project = _find_project(project_id)
    env_file = _env_path(project)

    # Convert config keys back to env variable names
    new_vars = _config_to_env_lines(body.model_dump(exclude_unset=True))

    # Update env file preserving existing comments and formatting
    update_env_file(env_file, new_vars)

    # Read back the full config for the response (masked)
    env_vars = parse_env_file(env_file)
    config = _env_to_config(env_vars, mask=True)
    return {"success": True, "data": config}
