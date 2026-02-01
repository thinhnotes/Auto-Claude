"""WebSocket module for real-time communication."""

from .manager import ConnectionManager, get_manager, publish_event
from .protocol import (
    Channel,
    ErrorCode,
    MessageType,
    Subscription,
    create_ack,
    create_error,
    create_event,
    create_message,
    create_request,
    create_response,
    validate_channel,
)

__all__ = [
    "ConnectionManager",
    "get_manager",
    "publish_event",
    "Channel",
    "ErrorCode",
    "MessageType",
    "Subscription",
    "create_ack",
    "create_error",
    "create_event",
    "create_message",
    "create_request",
    "create_response",
    "validate_channel",
]
