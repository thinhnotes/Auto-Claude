"""
Azure DevOps Router
===================

API endpoints for Azure DevOps integration.
"""

import base64
import sys
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from ..utils.security import get_secure_logger
from .projects import load_projects

router = APIRouter()
logger = get_secure_logger("auto-claude-api")


class AzureDevOpsConfig(BaseModel):
    """Azure DevOps configuration."""
    enabled: bool = False
    organizationUrl: str | None = None
    project: str | None = None
    team: str | None = None
    personalAccessToken: str | None = None


async def get_azure_devops_config(project_id: str) -> AzureDevOpsConfig | None:
    """Get Azure DevOps configuration from project .env file."""
    try:
        projects = load_projects()
        project = next((p for p in projects if p["id"] == project_id), None)
        
        if not project or not project.get("autoBuildPath"):
            return None

        env_path = Path(project["path"]) / project["autoBuildPath"] / ".env"
        
        if not env_path.exists():
            return AzureDevOpsConfig(enabled=False)

        env_content = env_path.read_text(encoding="utf-8")
        env_lines = env_content.split("\n")

        config = {
            "enabled": False,
            "organizationUrl": None,
            "project": None,
            "team": None,
            "personalAccessToken": None,
        }

        for line in env_lines:
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()

            if key == "AZURE_DEVOPS_ENABLED":
                config["enabled"] = value.lower() == "true"
            elif key == "AZURE_DEVOPS_ORGANIZATION_URL":
                config["organizationUrl"] = value
            elif key == "AZURE_DEVOPS_PROJECT":
                config["project"] = value
            elif key == "AZURE_DEVOPS_TEAM":
                config["team"] = value
            elif key == "AZURE_DEVOPS_PAT":
                config["personalAccessToken"] = value

        return AzureDevOpsConfig(**config)
    except Exception as e:
        logger.error(f"[AzureDevOps] Error getting config: {e}")
        return None


async def azure_devops_request(
    url: str,
    pat: str,
    method: str = "GET",
    body: dict | None = None
) -> dict[str, Any]:
    """Make authenticated Azure DevOps API request."""
    auth_header = f"Basic {base64.b64encode(f':{pat}'.encode()).decode()}"
    
    async with httpx.AsyncClient() as client:
        response = await client.request(
            method=method,
            url=url,
            headers={
                "Authorization": auth_header,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            json=body,
            timeout=30.0
        )
        
        if not response.is_success:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Azure DevOps API error: {response.text}"
            )
        
        return response.json()


@router.get("/projects/{project_id}/azure-devops/config")
async def get_config(project_id: str):
    """Get Azure DevOps configuration for a project."""
    config = await get_azure_devops_config(project_id)
    
    if config is None:
        return {"success": False, "error": "Project not found or no config available"}
    
    return {"success": True, "data": config.model_dump()}


@router.get("/projects/{project_id}/azure-devops/connection")
async def check_connection(project_id: str):
    """Check Azure DevOps connection status."""
    config = await get_azure_devops_config(project_id)
    
    if not config or not config.enabled:
        return {
            "success": True,
            "data": {
                "connected": False,
                "organizationUrl": None,
                "project": None,
                "error": "Azure DevOps integration not enabled"
            }
        }
    
    if not all([config.organizationUrl, config.project, config.personalAccessToken]):
        return {
            "success": True,
            "data": {
                "connected": False,
                "organizationUrl": config.organizationUrl,
                "project": config.project,
                "error": "Missing required configuration"
            }
        }
    
    try:
        # Test connection by fetching project info
        url = f"{config.organizationUrl}/{config.project}/_apis/projects/{config.project}?api-version=7.1"
        await azure_devops_request(url, config.personalAccessToken)
        
        return {
            "success": True,
            "data": {
                "connected": True,
                "organizationUrl": config.organizationUrl,
                "project": config.project
            }
        }
    except Exception as e:
        logger.error(f"[AzureDevOps] Connection check failed: {e}")
        return {
            "success": True,
            "data": {
                "connected": False,
                "organizationUrl": config.organizationUrl,
                "project": config.project,
                "error": str(e)
            }
        }


@router.get("/projects/{project_id}/azure-devops/iterations")
async def get_iterations(project_id: str):
    """Get iterations (sprints) for the project/team."""
    config = await get_azure_devops_config(project_id)
    
    if not config or not config.enabled or not config.organizationUrl or not config.project or not config.personalAccessToken:
        return {
            "success": False,
            "error": "Azure DevOps not configured"
        }
    
    try:
        # Use team settings API if team is configured
        if config.team:
            url = f"{config.organizationUrl}/{config.project}/{config.team}/_apis/work/teamsettings/iterations?api-version=7.1"
        else:
            # Fallback to project classification nodes
            url = f"{config.organizationUrl}/{config.project}/_apis/wit/classificationnodes/iterations?$depth=2&api-version=7.1"
        
        data = await azure_devops_request(url, config.personalAccessToken)
        
        iterations = []
        if config.team and "value" in data:
            # Team iterations format
            for item in data.get("value", []):
                iterations.append({
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "path": item.get("path"),
                    "startDate": item.get("attributes", {}).get("startDate"),
                    "finishDate": item.get("attributes", {}).get("finishDate"),
                    "timeFrame": item.get("attributes", {}).get("timeFrame")
                })
        else:
            # Project classification nodes format
            def extract_iterations(node, parent_path=""):
                items = []
                path = f"{parent_path}\\{node['name']}" if parent_path else node['name']
                
                if node.get("hasChildren"):
                    for child in node.get("children", []):
                        items.extend(extract_iterations(child, path))
                else:
                    items.append({
                        "id": node.get("id"),
                        "name": node.get("name"),
                        "path": path,
                        "startDate": node.get("attributes", {}).get("startDate"),
                        "finishDate": node.get("attributes", {}).get("finishDate")
                    })
                
                return items
            
            iterations = extract_iterations(data)
        
        return {
            "success": True,
            "iterations": iterations,
            "project": config.project,
            "team": config.team,
            "organizationUrl": config.organizationUrl
        }
    except Exception as e:
        logger.error(f"[AzureDevOps] Error getting iterations: {e}")
        return {"success": False, "error": str(e)}


@router.get("/projects/{project_id}/azure-devops/current-iteration")
async def get_current_iteration(project_id: str):
    """Get current iteration for the team."""
    config = await get_azure_devops_config(project_id)
    
    if not config or not config.enabled or not config.team:
        return {"success": False, "error": "Azure DevOps team not configured"}
    
    try:
        url = f"{config.organizationUrl}/{config.project}/{config.team}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1"
        data = await azure_devops_request(url, config.personalAccessToken)
        
        items = data.get("value", [])
        if not items:
            return {"success": False, "error": "No current iteration found"}
        
        item = items[0]
        iteration = {
            "id": item.get("id"),
            "name": item.get("name"),
            "path": item.get("path"),
            "startDate": item.get("attributes", {}).get("startDate"),
            "finishDate": item.get("attributes", {}).get("finishDate"),
            "timeFrame": item.get("attributes", {}).get("timeFrame")
        }
        
        return {"success": True, "data": iteration}
    except Exception as e:
        logger.error(f"[AzureDevOps] Error getting current iteration: {e}")
        return {"success": False, "error": str(e)}


@router.get("/projects/{project_id}/azure-devops/work-items")
async def get_work_items_for_iteration(
    project_id: str,
    iterationPath: str,
    areaPath: str | None = None
):
    """Get work items for a specific iteration."""
    config = await get_azure_devops_config(project_id)
    
    if not config or not config.enabled:
        return {"success": False, "error": "Azure DevOps not configured"}
    
    try:
        # Build WIQL query
        wiql_conditions = [
            f"[System.IterationPath] = '{iterationPath}'",
            "[System.WorkItemType] IN ('User Story', 'Bug', 'Task', 'Feature')",
            "[System.State] <> 'Removed'"
        ]
        
        if areaPath:
            wiql_conditions.append(f"[System.AreaPath] UNDER '{areaPath}'")
        
        wiql_query = f"SELECT [System.Id] FROM WorkItems WHERE {' AND '.join(wiql_conditions)} ORDER BY [System.ChangedDate] DESC"
        
        # Execute WIQL query
        wiql_url = f"{config.organizationUrl}/{config.project}/_apis/wit/wiql?api-version=7.1"
        wiql_result = await azure_devops_request(
            wiql_url,
            config.personalAccessToken,
            method="POST",
            body={"query": wiql_query}
        )
        
        work_item_refs = wiql_result.get("workItems", [])
        if not work_item_refs:
            return {"success": True, "workItems": []}
        
        # Fetch full work item details in batch
        ids = [str(ref["id"]) for ref in work_item_refs]
        ids_str = ",".join(ids)
        
        batch_url = f"{config.organizationUrl}/{config.project}/_apis/wit/workitems?ids={ids_str}&api-version=7.1"
        batch_result = await azure_devops_request(batch_url, config.personalAccessToken)
        
        work_items = []
        for item in batch_result.get("value", []):
            fields = item.get("fields", {})
            work_items.append({
                "id": item.get("id"),
                "title": fields.get("System.Title"),
                "state": fields.get("System.State"),
                "workItemType": fields.get("System.WorkItemType"),
                "assignedTo": fields.get("System.AssignedTo", {}).get("displayName") if isinstance(fields.get("System.AssignedTo"), dict) else None,
                "iterationPath": fields.get("System.IterationPath"),
                "areaPath": fields.get("System.AreaPath"),
                "priority": fields.get("Microsoft.VSTS.Common.Priority"),
                "createdDate": fields.get("System.CreatedDate"),
                "changedDate": fields.get("System.ChangedDate"),
                "url": item.get("url")
            })
        
        return {"success": True, "workItems": work_items}
    except Exception as e:
        logger.error(f"[AzureDevOps] Error getting work items: {e}")
        return {"success": False, "error": str(e)}


@router.get("/projects/{project_id}/azure-devops/work-items/{work_item_id}")
async def get_work_item(project_id: str, work_item_id: int):
    """Get a single work item by ID."""
    config = await get_azure_devops_config(project_id)
    
    if not config or not config.enabled:
        return {"success": False, "error": "Azure DevOps not configured"}
    
    try:
        url = f"{config.organizationUrl}/{config.project}/_apis/wit/workitems/{work_item_id}?api-version=7.1"
        item = await azure_devops_request(url, config.personalAccessToken)
        
        fields = item.get("fields", {})
        work_item = {
            "id": item.get("id"),
            "title": fields.get("System.Title"),
            "state": fields.get("System.State"),
            "workItemType": fields.get("System.WorkItemType"),
            "assignedTo": fields.get("System.AssignedTo", {}).get("displayName") if isinstance(fields.get("System.AssignedTo"), dict) else None,
            "iterationPath": fields.get("System.IterationPath"),
            "areaPath": fields.get("System.AreaPath"),
            "priority": fields.get("Microsoft.VSTS.Common.Priority"),
            "description": fields.get("System.Description"),
            "acceptanceCriteria": fields.get("Microsoft.VSTS.Common.AcceptanceCriteria"),
            "createdDate": fields.get("System.CreatedDate"),
            "changedDate": fields.get("System.ChangedDate"),
            "url": item.get("url")
        }
        
        return {"success": True, "data": work_item}
    except Exception as e:
        logger.error(f"[AzureDevOps] Error getting work item: {e}")
        return {"success": False, "error": str(e)}


@router.get("/projects/{project_id}/azure-devops/areas")
async def get_areas(project_id: str):
    """Get area paths for the project."""
    config = await get_azure_devops_config(project_id)
    
    if not config or not config.enabled:
        return {"success": False, "error": "Azure DevOps not configured"}
    
    try:
        url = f"{config.organizationUrl}/{config.project}/_apis/wit/classificationnodes/areas?$depth=10&api-version=7.1"
        data = await azure_devops_request(url, config.personalAccessToken)
        
        def extract_areas(node, parent_path=""):
            """Recursively extract area paths."""
            items = []
            path = f"{parent_path}\\{node['name']}" if parent_path else node['name']
            
            items.append({
                "id": node.get("id"),
                "name": node.get("name"),
                "path": path
            })
            
            if node.get("hasChildren"):
                for child in node.get("children", []):
                    items.extend(extract_areas(child, path))
            
            return items
        
        areas = extract_areas(data)
        
        return {"success": True, "areas": areas}
    except Exception as e:
        logger.error(f"[AzureDevOps] Error getting areas: {e}")
        return {"success": False, "error": str(e)}
