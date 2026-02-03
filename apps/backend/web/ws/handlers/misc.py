"""
WebSocket Handlers - Miscellaneous
==================================

Request handlers for misc operations (tabs, health, folders, etc.).
"""

import sys
from pathlib import Path
from typing import Any

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))


# In-memory tab state (same as in main.py)
_tab_state: dict = {}


async def handle_get_tabs(params: dict[str, Any]) -> dict[str, Any]:
    """Get the current tab state."""
    global _tab_state
    return {"success": True, "data": _tab_state}


async def handle_save_tabs(params: dict[str, Any]) -> dict[str, Any]:
    """Save the tab state."""
    global _tab_state
    tab_state = params.get("tabState", {})
    _tab_state = tab_state
    return {"success": True}


async def handle_health_check(params: dict[str, Any]) -> dict[str, Any]:
    """Health check endpoint."""
    return {"success": True, "data": {
        "status": "healthy",
        "service": "auto-claude-api"
    }}


async def handle_browse_folders(params: dict[str, Any]) -> dict[str, Any]:
    """Browse folders on the server."""
    path = params.get("path", "")
    
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
                entries.append({
                    "name": entry.name,
                    "path": str(entry),
                    "isDirectory": True
                })
        
        return {
            "success": True,
            "data": {
                "currentPath": str(base_path),
                "parentPath": str(base_path.parent) if base_path.parent != base_path else None,
                "entries": entries,
            }
        }
    except PermissionError:
        return {"success": False, "error": "Permission denied"}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_test_connection(params: dict[str, Any]) -> dict[str, Any]:
    """Test connection to an external API endpoint."""
    import httpx
    
    base_url = params.get("baseUrl", "")
    api_key = params.get("apiKey", "")
    
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
            # Try multiple endpoint patterns
            base = base_url.rstrip("/")
            endpoints_to_try = [
                ("/v1/models", {"x-api-key": api_key}),
                ("/v1/models", {"Authorization": f"Bearer {api_key}"}),
                ("/models", {"Authorization": f"Bearer {api_key}"}),
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
