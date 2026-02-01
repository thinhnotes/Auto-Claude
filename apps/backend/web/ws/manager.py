"""
WebSocket Connection Manager
============================

Manages WebSocket connections, subscriptions, and event broadcasting.
"""

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from .protocol import (
    Channel,
    ErrorCode,
    MessageType,
    Subscription,
    create_ack,
    create_error,
    create_event,
    validate_channel,
)

logger = logging.getLogger("auto-claude-api")


@dataclass
class ConnectionState:
    """State associated with a WebSocket connection."""
    
    websocket: WebSocket
    subscriptions: set[Subscription] = field(default_factory=set)
    client_id: str | None = None
    connected_at: str | None = None


class ConnectionManager:
    """Manage WebSocket connections and subscriptions."""
    
    def __init__(self):
        self.connections: dict[WebSocket, ConnectionState] = {}
        self._lock = asyncio.Lock()
    
    async def connect(self, websocket: WebSocket) -> ConnectionState:
        """Accept and register a new WebSocket connection."""
        await websocket.accept()
        
        async with self._lock:
            state = ConnectionState(websocket=websocket)
            self.connections[websocket] = state
            logger.info(f"WebSocket connected. Total connections: {len(self.connections)}")
            return state
    
    async def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection."""
        async with self._lock:
            if websocket in self.connections:
                state = self.connections[websocket]
                logger.info(
                    f"WebSocket disconnected (had {len(state.subscriptions)} subscriptions). "
                    f"Remaining connections: {len(self.connections) - 1}"
                )
                del self.connections[websocket]
    
    async def subscribe(
        self,
        websocket: WebSocket,
        channel: str,
        scope: dict[str, str | None] | None = None,
    ) -> tuple[bool, str | None]:
        """
        Subscribe a connection to a channel.
        
        Returns:
            (success, error_message)
        """
        if not validate_channel(channel):
            return False, f"Unknown channel: {channel}"
        
        scope = scope or {}
        subscription = Subscription(
            channel=channel,
            project_id=scope.get("projectId"),
            task_id=scope.get("taskId"),
            spec_id=scope.get("specId"),
        )
        
        async with self._lock:
            if websocket not in self.connections:
                return False, "Connection not found"
            
            state = self.connections[websocket]
            state.subscriptions.add(subscription)
            logger.info(
                f"Subscribed to {channel} with scope {scope}. "
                f"Total subscriptions for this connection: {len(state.subscriptions)}"
            )
        
        return True, None
    
    async def unsubscribe(
        self,
        websocket: WebSocket,
        channel: str,
        scope: dict[str, str | None] | None = None,
    ):
        """Unsubscribe a connection from a channel."""
        scope = scope or {}
        subscription = Subscription(
            channel=channel,
            project_id=scope.get("projectId"),
            task_id=scope.get("taskId"),
            spec_id=scope.get("specId"),
        )
        
        async with self._lock:
            if websocket in self.connections:
                state = self.connections[websocket]
                state.subscriptions.discard(subscription)
                logger.info(
                    f"Unsubscribed from {channel} with scope {scope}. "
                    f"Remaining subscriptions: {len(state.subscriptions)}"
                )
    
    async def publish(
        self,
        channel: str,
        scope: dict[str, Any],
        data: dict[str, Any],
        cursor: str | None = None,
    ):
        """
        Publish an event to all matching subscribers.
        
        Args:
            channel: The channel name (e.g., "task.logs")
            scope: Event scope with optional filters (projectId, taskId, specId)
            data: Event payload
            cursor: Optional cursor for incremental updates
        """
        message = create_event(channel, scope, data, cursor)
        
        # Collect matching connections (outside lock to minimize lock time)
        targets: list[WebSocket] = []
        
        async with self._lock:
            for websocket, state in self.connections.items():
                for subscription in state.subscriptions:
                    if subscription.matches(channel, scope):
                        targets.append(websocket)
                        break  # Only add connection once
        
        if not targets:
            logger.debug(f"No subscribers for {channel} with scope {scope}")
            return
        
        # Send to all targets (outside lock to avoid blocking)
        logger.info(f"Publishing {channel} event to {len(targets)} subscriber(s)")
        
        failed: list[WebSocket] = []
        for websocket in targets:
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to WebSocket: {e}")
                failed.append(websocket)
        
        # Clean up failed connections
        if failed:
            async with self._lock:
                for websocket in failed:
                    if websocket in self.connections:
                        del self.connections[websocket]
            logger.info(f"Removed {len(failed)} dead connection(s)")
    
    async def broadcast(self, message: dict[str, Any]):
        """Broadcast a message to all connected clients (legacy support)."""
        async with self._lock:
            connections = list(self.connections.keys())
        
        failed: list[WebSocket] = []
        for websocket in connections:
            try:
                await websocket.send_json(message)
            except Exception:
                failed.append(websocket)
        
        # Clean up failed connections
        if failed:
            async with self._lock:
                for websocket in failed:
                    if websocket in self.connections:
                        del self.connections[websocket]


# Global manager instance
_manager: ConnectionManager | None = None


def get_manager() -> ConnectionManager:
    """Get the global ConnectionManager instance."""
    global _manager
    if _manager is None:
        _manager = ConnectionManager()
    return _manager


async def publish_event(
    channel: str,
    scope: dict[str, Any],
    data: dict[str, Any],
    cursor: str | None = None,
):
    """
    Publish an event to all matching subscribers.
    
    This is a convenience function that can be called from anywhere
    in the application to emit WebSocket events.
    
    Args:
        channel: Channel name (e.g., Channel.TASK_LOGS)
        scope: Event scope (projectId, taskId, specId)
        data: Event payload
        cursor: Optional cursor for incremental updates
    """
    manager = get_manager()
    await manager.publish(channel, scope, data, cursor)
