"""
WebSocket Handlers - Context & Memory
====================================

Request handlers for context and memory operations.
"""

import sys
from pathlib import Path
from typing import Any

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

# Import from HTTP router to reuse logic
from web.routers.context import (
    get_project_context as _get_project_context,
    refresh_project_index as _refresh_project_index,
    search_memories as _search_memories,
    get_memories as _get_memories,
)


async def handle_get_context(params: dict[str, Any]) -> dict[str, Any]:
    """
    Get project context including memory status.
    
    Params:
        - projectId: Project ID
    
    Returns:
        {"success": True, "data": {...context data...}}
    """
    project_id = params.get("projectId")
    
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    try:
        # Call the existing HTTP router function
        result = await _get_project_context(project_id)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_refresh_context(params: dict[str, Any]) -> dict[str, Any]:
    """
    Refresh project index/context.
    
    Params:
        - projectId: Project ID
    
    Returns:
        {"success": True, "data": {...}}
    """
    project_id = params.get("projectId")
    
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    try:
        result = await _refresh_project_index(project_id)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_search_memories(params: dict[str, Any]) -> dict[str, Any]:
    """
    Search memories for a project.
    
    Params:
        - projectId: Project ID
        - query: Search query string
    
    Returns:
        {"success": True, "data": [...memories...]}
    """
    project_id = params.get("projectId")
    query = params.get("query", "")
    
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    try:
        # Import the request model
        from pydantic import BaseModel
        
        class SearchRequest(BaseModel):
            query: str
        
        search_req = SearchRequest(query=query)
        result = await _search_memories(project_id, search_req)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_get_recent_memories(params: dict[str, Any]) -> dict[str, Any]:
    """
    Get recent memories for a project.
    
    Params:
        - projectId: Project ID
        - limit: Number of memories to return (optional, default 10)
    
    Returns:
        {"success": True, "data": [...memories...]}
    """
    project_id = params.get("projectId")
    limit = params.get("limit", 10)
    
    if not project_id:
        return {"success": False, "error": "Missing projectId parameter"}
    
    try:
        result = await _get_memories(project_id, limit)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}
