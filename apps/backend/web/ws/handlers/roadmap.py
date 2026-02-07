"""
WebSocket Handlers - Roadmap Operations

Provides WebSocket handlers for roadmap generation and management.
"""
from typing import Any
import logging

logger = logging.getLogger(__name__)


async def handle_get_roadmap(params: dict[str, Any]) -> dict[str, Any]:
    """Get project roadmap.

    Args:
        params: Dict containing:
            - projectId: Project identifier

    Returns:
        Dict with success status and roadmap data or error
    """
    project_id = params.get("projectId")
    if not project_id:
        return {"success": False, "error": "Missing projectId"}

    try:
        from web.routers.roadmap import get_roadmap
        return await get_roadmap(project_id)
    except Exception as e:
        logger.error(f"Error getting roadmap for project {project_id}: {e}")
        return {"success": False, "error": str(e)}


async def handle_save_roadmap(params: dict[str, Any]) -> dict[str, Any]:
    """Save project roadmap.

    Args:
        params: Dict containing:
            - projectId: Project identifier
            - roadmap: Roadmap data dict

    Returns:
        Dict with success status or error
    """
    project_id = params.get("projectId")
    roadmap = params.get("roadmap")

    if not project_id or not roadmap:
        return {"success": False, "error": "Missing projectId or roadmap"}

    try:
        from web.routers.roadmap import save_roadmap
        from pydantic import BaseModel

        class RoadmapSaveRequest(BaseModel):
            roadmap: dict

        request = RoadmapSaveRequest(roadmap=roadmap)
        return await save_roadmap(project_id, request)
    except Exception as e:
        logger.error(f"Error saving roadmap for project {project_id}: {e}")
        return {"success": False, "error": str(e)}


async def handle_generate_roadmap(params: dict[str, Any]) -> dict[str, Any]:
    """Generate project roadmap using AI.

    Args:
        params: Dict containing:
            - projectId: Project identifier
            - enable_competitor_analysis: Optional bool
            - refresh_competitor_analysis: Optional bool

    Returns:
        Dict with success status or error
    """
    project_id = params.get("projectId")
    if not project_id:
        return {"success": False, "error": "Missing projectId"}

    try:
        from web.routers.roadmap import generate_roadmap
        from pydantic import BaseModel

        class RoadmapStartRequest(BaseModel):
            enable_competitor_analysis: bool = False
            refresh_competitor_analysis: bool = False

        request = RoadmapStartRequest(
            enable_competitor_analysis=params.get("enable_competitor_analysis", False),
            refresh_competitor_analysis=params.get("refresh_competitor_analysis", False),
        )
        return await generate_roadmap(project_id, request)
    except Exception as e:
        logger.error(f"Error generating roadmap for project {project_id}: {e}")
        return {"success": False, "error": str(e)}


async def handle_update_feature_status(params: dict[str, Any]) -> dict[str, Any]:
    """Update roadmap feature status.

    Args:
        params: Dict containing:
            - projectId: Project identifier
            - featureId: Feature identifier
            - status: New status

    Returns:
        Dict with success status or error
    """
    project_id = params.get("projectId")
    feature_id = params.get("featureId")
    status = params.get("status")

    if not all([project_id, feature_id, status]):
        return {"success": False, "error": "Missing required parameters"}

    try:
        from web.routers.roadmap import update_feature_status
        return await update_feature_status(project_id, feature_id, {"status": status})
    except Exception as e:
        logger.error(f"Error updating feature status for {feature_id}: {e}")
        return {"success": False, "error": str(e)}
