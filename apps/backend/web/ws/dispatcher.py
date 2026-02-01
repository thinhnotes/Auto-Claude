"""
WebSocket Request Dispatcher
============================

Handles request-response pattern over WebSockets.
Routes incoming requests to appropriate handlers.
"""

import logging
from typing import Any, Callable, Awaitable

from .protocol import create_response, ErrorCode

logger = logging.getLogger("auto-claude-api")

# Type alias for request handlers
RequestHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class RequestDispatcher:
    """Dispatch WebSocket requests to handlers."""
    
    def __init__(self):
        self.handlers: dict[str, RequestHandler] = {}
    
    def register(self, method: str, handler: RequestHandler):
        """Register a handler for a specific method."""
        self.handlers[method] = handler
        logger.debug(f"Registered handler for method: {method}")
    
    async def dispatch(self, request_id: str, method: str, params: dict[str, Any]) -> dict[str, Any]:
        """
        Dispatch a request to the appropriate handler.
        
        Returns a response message (dict).
        """
        handler = self.handlers.get(method)
        
        if not handler:
            logger.warning(f"Unknown method: {method}")
            return create_response(
                request_id,
                error=f"Unknown method: {method}"
            )
        
        try:
            logger.info(f"Handling request: {method}")
            result = await handler(params)
            
            # Handlers should return { "success": bool, "data"?: any, "error"?: str }
            if not result.get("success"):
                return create_response(
                    request_id,
                    error=result.get("error", "Unknown error")
                )
            
            return create_response(
                request_id,
                data=result.get("data")
            )
        
        except Exception as e:
            logger.error(f"Error handling {method}: {e}", exc_info=True)
            return create_response(
                request_id,
                error=str(e)
            )


# Global dispatcher instance
_dispatcher: RequestDispatcher | None = None


def get_dispatcher() -> RequestDispatcher:
    """Get the global RequestDispatcher instance."""
    global _dispatcher
    if _dispatcher is None:
        _dispatcher = RequestDispatcher()
    return _dispatcher
