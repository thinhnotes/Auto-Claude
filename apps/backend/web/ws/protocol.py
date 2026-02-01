"""
WebSocket Protocol - Message formats and channel constants
==========================================================

Defines the message envelope format and supported channels for WebSocket communication.
"""

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any


class MessageType(str, Enum):
    """WebSocket message types."""
    
    HELLO = "hello"
    SUBSCRIBE = "subscribe"
    UNSUBSCRIBE = "unsubscribe"
    EVENT = "event"
    ACK = "ack"
    ERROR = "error"
    PING = "ping"
    PONG = "pong"
    REQUEST = "request"
    RESPONSE = "response"


class Channel(str, Enum):
    """Supported WebSocket channels."""
    
    TASK_STATUS = "task.status"
    TASK_PROGRESS = "task.progress"
    TASK_LOGS = "task.logs"
    ROADMAP_STATUS = "roadmap.status"
    PROJECT_UPDATED = "project.updated"


class ErrorCode(str, Enum):
    """WebSocket error codes."""
    
    UNKNOWN_CHANNEL = "unknown_channel"
    INVALID_SCOPE = "invalid_scope"
    INVALID_MESSAGE = "invalid_message"
    INTERNAL_ERROR = "internal_error"


@dataclass(frozen=True)
class Subscription:
    """Represents a client subscription to a channel with optional filters."""
    
    channel: str
    project_id: str | None = None
    task_id: str | None = None
    spec_id: str | None = None
    
    def matches(self, event_channel: str, event_scope: dict[str, str | None]) -> bool:
        """Check if this subscription matches an event."""
        if self.channel != event_channel:
            return False
        
        # All non-None filter fields must match exactly
        if self.project_id is not None and event_scope.get("project_id") != self.project_id:
            return False
        if self.task_id is not None and event_scope.get("task_id") != self.task_id:
            return False
        if self.spec_id is not None and event_scope.get("spec_id") != self.spec_id:
            return False
        
        return True


def create_message(
    msg_type: MessageType,
    msg_id: str | None = None,
    channel: str | None = None,
    scope: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
    cursor: str | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    retryable: bool | None = None,
    method: str | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a WebSocket message with the standard envelope format."""
    message: dict[str, Any] = {
        "v": 1,
        "type": msg_type.value,
        "ts": datetime.utcnow().isoformat() + "Z",
    }
    
    if msg_id:
        message["id"] = msg_id
    if channel:
        message["channel"] = channel
    if scope:
        message["scope"] = scope
    if data is not None:
        message["data"] = data
    if cursor:
        message["cursor"] = cursor
    if error_code:
        message["code"] = error_code
    if error_message:
        message["message"] = error_message
    if retryable is not None:
        message["retryable"] = retryable
    if method:
        message["method"] = method
    if params is not None:
        message["params"] = params
    
    return message


def create_ack(msg_id: str, channel: str | None = None) -> dict[str, Any]:
    """Create an acknowledgment message."""
    msg = create_message(MessageType.ACK, msg_id=msg_id)
    if channel:
        msg["channel"] = channel
    return msg


def create_error(
    code: ErrorCode | str,
    message: str,
    msg_id: str | None = None,
    retryable: bool = False,
) -> dict[str, Any]:
    """Create an error message."""
    return create_message(
        MessageType.ERROR,
        msg_id=msg_id,
        error_code=code if isinstance(code, str) else code.value,
        error_message=message,
        retryable=retryable,
    )


def create_event(
    channel: str,
    scope: dict[str, Any],
    data: dict[str, Any],
    cursor: str | None = None,
) -> dict[str, Any]:
    """Create an event message."""
    return create_message(
        MessageType.EVENT,
        channel=channel,
        scope=scope,
        data=data,
        cursor=cursor,
    )


def create_request(method: str, params: dict[str, Any] | None = None, msg_id: str | None = None) -> dict[str, Any]:
    """Create a request message."""
    return create_message(
        MessageType.REQUEST,
        msg_id=msg_id,
        method=method,
        params=params or {},
    )


def create_response(request_id: str, data: dict[str, Any] | None = None, error: str | None = None) -> dict[str, Any]:
    """Create a response message."""
    if error:
        return create_message(
            MessageType.RESPONSE,
            msg_id=request_id,
            error_code=ErrorCode.INTERNAL_ERROR.value,
            error_message=error,
        )
    return create_message(
        MessageType.RESPONSE,
        msg_id=request_id,
        data=data or {},
    )


def validate_channel(channel: str) -> bool:
    """Check if a channel name is valid."""
    try:
        Channel(channel)
        return True
    except ValueError:
        return False
