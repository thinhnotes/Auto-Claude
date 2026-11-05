"""
API Authentication
===================

Shared-secret token authentication for the Auto Claude web API.

A random token is generated at startup and printed to stdout so the
Next.js frontend can pick it up. Alternatively, the token can be set
via the ``AUTO_CLAUDE_API_TOKEN`` environment variable.

All HTTP routes (except ``/api/health``) and all Socket.IO ``on_connect``
handlers must validate the token.
"""

from __future__ import annotations

import logging

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .shared import API_TOKEN

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    """FastAPI dependency that validates the Bearer token.

    Returns the validated token string on success.
    Raises HTTP 401 if the token is missing or incorrect.
    """
    if credentials is None or credentials.credentials != API_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


def validate_socketio_token(environ: dict, auth: dict | None = None) -> bool:
    """Validate the Bearer token from a Socket.IO connection handshake.

    The client should pass the token in the ``auth`` dict, as a query
    parameter ``token``, or in the ``Authorization`` header.

    Returns ``True`` if valid, ``False`` otherwise.
    """
    if isinstance(auth, dict) and auth.get("token") == API_TOKEN:
        return True

    # Check query string first (Socket.IO commonly uses query params)
    query_string: str = environ.get("QUERY_STRING", "")
    for part in query_string.split("&"):
        if part.startswith("token="):
            if part[6:] == API_TOKEN:
                return True

    # Check Authorization header
    auth_header: str = environ.get("HTTP_AUTHORIZATION", "")
    if auth_header.startswith("Bearer "):
        if auth_header[7:] == API_TOKEN:
            return True

    return False
