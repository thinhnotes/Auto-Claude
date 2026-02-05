"""
WebSocket Handlers - Profiles
=============================

Request handlers for API profile operations.
"""

import sys
import time
import uuid
from pathlib import Path
from typing import Any

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from web.routers.profiles import load_profiles, save_profiles


async def handle_get_profiles(params: dict[str, Any]) -> dict[str, Any]:
    """Get all API profiles."""
    data = load_profiles()
    return {"success": True, "data": data}


async def handle_create_profile(params: dict[str, Any]) -> dict[str, Any]:
    """Create a new API profile."""
    data = load_profiles()
    
    now = int(time.time() * 1000)
    new_profile = {
        "id": str(uuid.uuid4()),
        "name": params.get("name", "New Profile"),
        "baseUrl": params.get("baseUrl", ""),
        "apiKey": params.get("apiKey", ""),
        "models": params.get("models"),
        "createdAt": now,
        "updatedAt": now,
    }
    
    data["profiles"].append(new_profile)
    
    # If this is the first profile, make it active
    if len(data["profiles"]) == 1:
        data["activeProfileId"] = new_profile["id"]
    
    save_profiles(data)
    return {"success": True, "data": new_profile}


async def handle_update_profile(params: dict[str, Any]) -> dict[str, Any]:
    """Update an existing API profile."""
    profile_id = params.get("profileId")
    if not profile_id:
        return {"success": False, "error": "Missing profileId"}
    
    data = load_profiles()
    
    for i, p in enumerate(data["profiles"]):
        if p.get("id") == profile_id:
            now = int(time.time() * 1000)
            updated_profile = {
                **p,
                "name": params.get("name", p.get("name")),
                "baseUrl": params.get("baseUrl", p.get("baseUrl")),
                "apiKey": params.get("apiKey", p.get("apiKey")),
                "models": params.get("models", p.get("models")),
                "updatedAt": now,
            }
            data["profiles"][i] = updated_profile
            save_profiles(data)
            return {"success": True, "data": updated_profile}
    
    return {"success": False, "error": "Profile not found"}


async def handle_delete_profile(params: dict[str, Any]) -> dict[str, Any]:
    """Delete an API profile."""
    profile_id = params.get("profileId")
    if not profile_id:
        return {"success": False, "error": "Missing profileId"}
    
    data = load_profiles()
    
    original_count = len(data["profiles"])
    data["profiles"] = [p for p in data["profiles"] if p.get("id") != profile_id]
    
    if len(data["profiles"]) == original_count:
        return {"success": False, "error": "Profile not found"}
    
    if data.get("activeProfileId") == profile_id:
        data["activeProfileId"] = None
    
    save_profiles(data)
    return {"success": True}


async def handle_activate_profile(params: dict[str, Any]) -> dict[str, Any]:
    """Set a profile as active."""
    profile_id = params.get("profileId")
    
    data = load_profiles()
    
    if profile_id is not None:
        found = any(p.get("id") == profile_id for p in data["profiles"])
        if not found:
            return {"success": False, "error": "Profile not found"}
    
    data["activeProfileId"] = profile_id
    save_profiles(data)
    
    return {"success": True}
