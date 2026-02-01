"""
WebSocket Handler Template
==========================

Copy this template when creating new WebSocket handlers.

Usage:
1. Copy this file to apps/backend/web/ws/handlers/your_module.py
2. Replace TEMPLATE with your module name (e.g., projects, tasks, etc.)
3. Implement handler functions
4. Register in main.py
5. Update frontend web-adapter.ts
"""

import sys
from pathlib import Path
from typing import Any

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

# Import from existing routers (reuse logic)
# from ...routers.TEMPLATE import load_data, save_data, ...


async def handle_get_TEMPLATE(params: dict[str, Any]) -> dict[str, Any]:
    """
    Get TEMPLATE data.
    
    Args:
        params: Request parameters (may be empty)
        
    Returns:
        {"success": True, "data": [...]}
    """
    try:
        # TODO: Implement get logic
        # Example:
        # data = load_data()
        # return {"success": True, "data": data}
        
        return {"success": True, "data": []}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_create_TEMPLATE(params: dict[str, Any]) -> dict[str, Any]:
    """
    Create new TEMPLATE.
    
    Args:
        params: Request parameters
            - name: str (required)
            - other: str (optional)
        
    Returns:
        {"success": True, "data": {...}}
    """
    try:
        # Validate required parameters
        name = params.get("name")
        if not name:
            return {"success": False, "error": "Missing name parameter"}
        
        # TODO: Implement create logic
        # Example:
        # new_item = create_item(name)
        # return {"success": True, "data": new_item}
        
        return {"success": True, "data": {"name": name}}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_update_TEMPLATE(params: dict[str, Any]) -> dict[str, Any]:
    """
    Update existing TEMPLATE.
    
    Args:
        params: Request parameters
            - id: str (required)
            - updates: dict (required)
        
    Returns:
        {"success": True, "data": {...}}
    """
    try:
        # Validate required parameters
        item_id = params.get("id")
        if not item_id:
            return {"success": False, "error": "Missing id parameter"}
        
        updates = params.get("updates", {})
        
        # TODO: Implement update logic
        # Example:
        # updated_item = update_item(item_id, updates)
        # if not updated_item:
        #     return {"success": False, "error": "Item not found"}
        # return {"success": True, "data": updated_item}
        
        return {"success": True, "data": {"id": item_id, **updates}}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_delete_TEMPLATE(params: dict[str, Any]) -> dict[str, Any]:
    """
    Delete TEMPLATE.
    
    Args:
        params: Request parameters
            - id: str (required)
        
    Returns:
        {"success": True}
    """
    try:
        # Validate required parameters
        item_id = params.get("id")
        if not item_id:
            return {"success": False, "error": "Missing id parameter"}
        
        # TODO: Implement delete logic
        # Example:
        # success = delete_item(item_id)
        # if not success:
        #     return {"success": False, "error": "Item not found"}
        
        return {"success": True}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# Registration in main.py
# =============================================================================
# 
# 1. Import handlers:
#    from .ws.handlers import TEMPLATE as TEMPLATE_handlers
# 
# 2. Register in register_ws_handlers():
#    dispatcher.register("TEMPLATE.get", TEMPLATE_handlers.handle_get_TEMPLATE)
#    dispatcher.register("TEMPLATE.create", TEMPLATE_handlers.handle_create_TEMPLATE)
#    dispatcher.register("TEMPLATE.update", TEMPLATE_handlers.handle_update_TEMPLATE)
#    dispatcher.register("TEMPLATE.delete", TEMPLATE_handlers.handle_delete_TEMPLATE)
# 
# 3. Add to handlers/__init__.py:
#    from . import TEMPLATE
#    __all__ = ["settings", "profiles", "TEMPLATE"]
# 
# =============================================================================
# Frontend implementation in web-adapter.ts
# =============================================================================
# 
# getTEMPLATE: async () => {
#   const ws = getWSClient();
#   const data = await ws.request('TEMPLATE.get', {});
#   return { success: true, data };
# },
# 
# createTEMPLATE: async (name: string, other?: string) => {
#   const ws = getWSClient();
#   const data = await ws.request('TEMPLATE.create', { name, other });
#   return { success: true, data };
# },
# 
# updateTEMPLATE: async (id: string, updates: Record<string, unknown>) => {
#   const ws = getWSClient();
#   const data = await ws.request('TEMPLATE.update', { id, updates });
#   return { success: true, data };
# },
# 
# deleteTEMPLATE: async (id: string) => {
#   const ws = getWSClient();
#   await ws.request('TEMPLATE.delete', { id });
#   return { success: true };
# },
# 
# =============================================================================
