"""
WebSocket Handlers - Ollama Operations

Provides WebSocket handlers for Ollama LLM management.
"""
from typing import Any
import logging

logger = logging.getLogger(__name__)


async def handle_ollama_status(params: dict[str, Any]) -> dict[str, Any]:
    """Check Ollama server status.

    Args:
        params: Dict containing:
            - baseUrl: Optional base URL for Ollama server

    Returns:
        Dict with success status and server status or error
    """
    base_url = params.get("baseUrl")

    try:
        from web.routers.ollama import check_ollama_status
        return await check_ollama_status(base_url)
    except Exception as e:
        logger.error(f"Error checking Ollama status: {e}")
        return {"success": False, "error": str(e)}


async def handle_ollama_check_installed(params: dict[str, Any]) -> dict[str, Any]:
    """Check if Ollama is installed.

    Args:
        params: Dict (no parameters required)

    Returns:
        Dict with success status and installation status or error
    """
    try:
        from web.routers.ollama import check_ollama_installed
        return await check_ollama_installed()
    except Exception as e:
        logger.error(f"Error checking Ollama installation: {e}")
        return {"success": False, "error": str(e)}


async def handle_ollama_list_models(params: dict[str, Any]) -> dict[str, Any]:
    """List available Ollama models.

    Args:
        params: Dict containing:
            - baseUrl: Optional base URL for Ollama server

    Returns:
        Dict with success status and model list or error
    """
    base_url = params.get("baseUrl")

    try:
        from web.routers.ollama import list_ollama_models
        return await list_ollama_models(base_url)
    except Exception as e:
        logger.error(f"Error listing Ollama models: {e}")
        return {"success": False, "error": str(e)}


async def handle_ollama_list_embedding_models(params: dict[str, Any]) -> dict[str, Any]:
    """List available Ollama embedding models.

    Args:
        params: Dict containing:
            - baseUrl: Optional base URL for Ollama server

    Returns:
        Dict with success status and embedding model list or error
    """
    base_url = params.get("baseUrl")

    try:
        from web.routers.ollama import list_ollama_embedding_models
        return await list_ollama_embedding_models(base_url)
    except Exception as e:
        logger.error(f"Error listing Ollama embedding models: {e}")
        return {"success": False, "error": str(e)}


async def handle_ollama_pull(params: dict[str, Any]) -> dict[str, Any]:
    """Pull an Ollama model.

    Args:
        params: Dict containing:
            - modelName: Model name to pull
            - baseUrl: Optional base URL for Ollama server

    Returns:
        Dict with success status or error
    """
    model_name = params.get("modelName")
    base_url = params.get("baseUrl")

    if not model_name:
        return {"success": False, "error": "Missing modelName"}

    try:
        from web.routers.ollama import pull_ollama_model
        from pydantic import BaseModel

        class PullModelRequest(BaseModel):
            model: str
            base_url: str | None = None

        request = PullModelRequest(model=model_name, base_url=base_url)
        return await pull_ollama_model(request)
    except Exception as e:
        logger.error(f"Error pulling Ollama model {model_name}: {e}")
        return {"success": False, "error": str(e)}
