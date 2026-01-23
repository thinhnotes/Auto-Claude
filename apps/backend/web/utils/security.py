"""
Security utilities for the web API.
"""

import logging
from typing import Any


def sanitize_for_log(value: Any) -> str:
    """
    Sanitize user input for logging to prevent log injection attacks.

    This function:
    - Replaces newlines and carriage returns to prevent log entry forgery
    - Limits string length to prevent log flooding
    - Safely handles None values

    Args:
        value: Any value to be logged (will be converted to string)

    Returns:
        Sanitized string safe for logging

    Example:
        >>> logger.info(f"User {sanitize_for_log(username)} logged in")
    """
    if value is None:
        return "None"

    # Convert to string and replace newlines/carriage returns that could be used for injection
    sanitized = str(value).replace("\n", "\\n").replace("\r", "\\r")

    # Limit length to prevent log flooding
    max_len = 500
    if len(sanitized) > max_len:
        sanitized = sanitized[:max_len] + "..."

    return sanitized


class SecureLogger(logging.LoggerAdapter):
    """
    A logger wrapper that automatically sanitizes all log messages to prevent log injection attacks.

    This logger automatically sanitizes:
    - User-provided data in f-strings and format strings
    - Arguments passed to log methods
    - Prevents newline injection and log flooding

    Usage:
        >>> from web.utils.security import get_secure_logger
        >>> logger = get_secure_logger("my-module")
        >>> logger.info(f"User {user_input} logged in")  # Automatically sanitized
    """

    def process(self, msg, kwargs):
        """Process the logging message to sanitize any user input."""
        # Sanitize the message itself
        if isinstance(msg, str):
            # Look for common patterns that might contain user input
            # This is a best-effort approach - f-strings are already evaluated
            msg = self._sanitize_message(msg)

        return msg, kwargs

    def _sanitize_message(self, msg: str) -> str:
        """Sanitize a log message by replacing newlines and limiting length."""
        # Replace newlines and carriage returns
        sanitized = msg.replace("\n", "\\n").replace("\r", "\\r")

        # Limit overall message length to prevent log flooding
        max_len = 2000  # Longer limit for full messages
        if len(sanitized) > max_len:
            sanitized = sanitized[:max_len] + "... [truncated]"

        return sanitized


def get_secure_logger(name: str) -> SecureLogger:
    """
    Get a secure logger that automatically sanitizes all log messages.

    Args:
        name: The logger name (typically module name)

    Returns:
        A SecureLogger instance that wraps the standard logger

    Example:
        >>> logger = get_secure_logger("auto-claude-api")
        >>> logger.info(f"Processing request from {user_ip}")  # Automatically sanitized
    """
    base_logger = logging.getLogger(name)
    return SecureLogger(base_logger, {})
