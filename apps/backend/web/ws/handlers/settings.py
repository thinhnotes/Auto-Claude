"""
WebSocket Handlers - Settings
=============================

Request handlers for settings operations.
"""

import sys
from pathlib import Path
from typing import Any

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from ...routers.settings import SettingsModel, get_settings_file, load_settings, save_settings, BACKEND_DIR


async def handle_get_settings(params: dict[str, Any]) -> dict[str, Any]:
    """Get current application settings."""
    settings = load_settings()
    settings_dict = settings.model_dump()
    
    # Ensure autoBuildPath is always set in web mode
    if not settings_dict.get("autoBuildPath"):
        settings_dict["autoBuildPath"] = BACKEND_DIR
    
    # Ensure onboardingCompleted is True in web mode (skip wizard)
    if not settings_dict.get("onboardingCompleted"):
        settings_dict["onboardingCompleted"] = True
    
    return {"success": True, "data": settings_dict}


async def handle_update_settings(params: dict[str, Any]) -> dict[str, Any]:
    """Update application settings."""
    settings = SettingsModel(**params)
    save_settings(settings)
    return {"success": True, "data": settings.model_dump()}


async def handle_patch_settings(params: dict[str, Any]) -> dict[str, Any]:
    """Partially update application settings."""
    current = load_settings()
    current_dict = current.model_dump()
    
    updates = params.get("updates", {})
    for key, value in updates.items():
        # Only update known settings, ignore unknown ones for compatibility
        if key in current_dict:
            current_dict[key] = value
    
    updated = SettingsModel(**current_dict)
    save_settings(updated)
    
    return {"success": True, "data": updated.model_dump()}
