"""
Azure DevOps REST API Client
============================

Async client for communicating with Azure DevOps REST API (v7.1).
Supports WIQL queries, batch work item fetching, authentication validation,
and offline simulation via pluggable transports.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Dict, List, Optional

import httpx

from .config import DEFAULT_WORK_ITEM_TYPES, AzureDevOpsConfig
from .models import AzureDevOpsWorkItem

logger = logging.getLogger(__name__)

# Known Azure DevOps Error Codes
ERR_TF400813 = "TF400813"  # Unauthorized
ERR_TF200016 = "TF200016"  # Project or Organization does not exist
ERR_TF401232 = "TF401232"  # Work item does not exist
ERR_HTML_REDIRECT = "HTML_REDIRECT"  # 203 or login page redirect
ERR_WIQL_SYNTAX = "WIQL_SYNTAX_ERROR"


# ============================================================================
# EXCEPTIONS
# ============================================================================

class AzureDevOpsError(Exception):
    """Base exception for all Azure DevOps integration errors."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        error_code: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code


class AzureDevOpsAuthError(AzureDevOpsError):
    """Raised on authentication failures (401, TF400813, 203 redirect)."""


class AzureDevOpsNotFoundError(AzureDevOpsError):
    """Raised when organization, project, or work item is not found (404, TF200016, TF401232)."""


class AzureDevOpsQueryError(AzureDevOpsError):
    """Raised when WIQL query is malformed or invalid (400 Bad Request)."""


class AzureDevOpsRateLimitError(AzureDevOpsError):
    """Raised when Azure DevOps throttles requests (429 Too Many Requests)."""


# ============================================================================
# CLIENT
# ============================================================================

class AzureDevOpsClient:
    """
    Async HTTP client for Azure DevOps REST API.

    Attributes:
        config: AzureDevOpsConfig containing connection parameters.
    """

    MAX_BATCH_SIZE = 200  # Azure DevOps hard limit for workitemsbatch

    def __init__(
        self,
        config: AzureDevOpsConfig,
        transport: Optional[httpx.AsyncBaseTransport] = None,
        timeout: float = 30.0,
    ) -> None:
        """
        Initialize Azure DevOps Client.

        Args:
            config: Configuration with PAT, organization URL, project.
            transport: Optional custom transport (e.g. MockAzureDevOpsTransport).
            timeout: HTTP timeout in seconds (default: 30.0).
        """
        self.config = config
        self._transport = transport
        self._timeout = timeout

        # Encode HTTP Basic Auth: empty username + :PAT
        token_bytes = f":{self.config.personal_access_token}".encode("utf-8")
        auth_header = base64.b64encode(token_bytes).decode("ascii")

        self._headers = {
            "Authorization": f"Basic {auth_header}",
            "Accept": "application/json",
            "User-Agent": "AutoClaude-AzureDevOps/1.0",
        }

        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or initialize the underlying httpx AsyncClient."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers=self._headers,
                transport=self._transport,
                timeout=self._timeout,
                follow_redirects=True,
            )
        return self._client

    async def close(self) -> None:
        """Close the underlying HTTP client session."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> "AzureDevOpsClient":
        await self._get_client()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        await self.close()

    def _check_html_redirect(self, response: httpx.Response) -> None:
        """
        Detect Azure DevOps 203 Non-Authoritative Information or HTML redirect.

        When a PAT is malformed or unauthorized, Azure DevOps returns HTTP 203
        or redirects to an HTML sign-in page.
        """
        if response.status_code == 203:
            raise AzureDevOpsAuthError(
                "Azure DevOps returned HTTP 203 Non-Authoritative Information. "
                "Invalid Personal Access Token (PAT).",
                status_code=203,
                error_code=ERR_HTML_REDIRECT,
            )

        content_type = response.headers.get("content-type", "").lower()
        if "text/html" in content_type:
            text = response.text.lower()
            if "<html" in text or "signin" in text or "login" in text:
                raise AzureDevOpsAuthError(
                    "Azure DevOps returned an HTML login redirect instead of JSON. "
                    "Invalid or expired Personal Access Token (PAT).",
                    status_code=response.status_code,
                    error_code=ERR_HTML_REDIRECT,
                )

    def _handle_error_response(self, response: httpx.Response, action_desc: str) -> None:
        """
        Parse and raise structured exceptions for HTTP errors.
        """
        self._check_html_redirect(response)

        status = response.status_code
        if status < 400:
            return

        error_message = f"{action_desc} failed with HTTP {status}"
        error_code = None

        try:
            body = response.json()
            if isinstance(body, dict):
                msg = body.get("message") or body.get("value")
                if msg:
                    error_message = f"{action_desc}: {msg}"
                error_code = body.get("errorCode") or body.get("typeKey")
        except Exception:
            text = response.text
            if text:
                error_message = f"{action_desc}: {text[:300]}"

        # Check for known error signatures
        if status == 401:
            code = ERR_TF400813 if (error_code == ERR_TF400813 or "TF400813" in error_message) else "401"
            raise AzureDevOpsAuthError(error_message, status_code=status, error_code=code)

        if status == 404:
            if error_code == ERR_TF401232 or "TF401232" in error_message:
                code = ERR_TF401232
            elif error_code == ERR_TF200016 or "TF200016" in error_message:
                code = ERR_TF200016
            else:
                code = error_code or "404"
            raise AzureDevOpsNotFoundError(error_message, status_code=status, error_code=code)

        if status == 400:
            raise AzureDevOpsQueryError(error_message, status_code=status, error_code=ERR_WIQL_SYNTAX)

        if status == 429:
            raise AzureDevOpsRateLimitError(error_message, status_code=status, error_code="429")

        raise AzureDevOpsError(error_message, status_code=status, error_code=error_code)

    # ------------------------------------------------------------------------
    # Core API Methods
    # ------------------------------------------------------------------------

    async def validate_connection(self) -> Dict[str, Any]:
        """
        Validate organization URL, project name, and PAT authenticity.

        Calls GET {organization_url}/_apis/projects/{project}?api-version={api_version}.

        Returns:
            Dict containing validation results and project metadata:
            {
                "valid": True,
                "project_id": "...",
                "project_name": "...",
                "organization_url": "..."
            }

        Raises:
            AzureDevOpsAuthError: On 401 Unauthorized or 203 HTML redirect.
            AzureDevOpsNotFoundError: On 404 Project/Org Not Found (TF200016).
            AzureDevOpsError: On any other API communication failure.
        """
        if not self.config.is_valid():
            raise AzureDevOpsAuthError(
                "Incomplete configuration: organization_url, project, and personal_access_token are required.",
                status_code=400,
            )

        client = await self._get_client()
        url = f"{self.config.org_base_url}/projects/{self.config.project}"
        params = {"api-version": self.config.api_version}

        try:
            response = await client.get(url, params=params)
            self._handle_error_response(response, f"Validating connection to project '{self.config.project}'")

            data = response.json()
            return {
                "valid": True,
                "project_id": data.get("id"),
                "project_name": data.get("name"),
                "description": data.get("description", ""),
                "state": data.get("state", "wellFormed"),
                "organization_url": self.config.organization_url,
            }
        except httpx.RequestError as exc:
            raise AzureDevOpsError(f"Network error connecting to Azure DevOps: {exc}") from exc

    async def query_work_items(
        self,
        wiql: Optional[str] = None,
        work_item_types: Optional[List[str]] = None,
        assigned_to_me: bool = True,
    ) -> List[int]:
        """
        Execute a WIQL query to retrieve matching work item IDs.

        Args:
            wiql: Optional raw WIQL query string. If None, constructs a query.
            work_item_types: List of work item types (defaults to Bug, Task, User Story).
            assigned_to_me: If True, restricts query to items assigned to current user (@me).

        Returns:
            List of work item IDs (integers).

        Raises:
            AzureDevOpsQueryError: On WIQL syntax errors (HTTP 400).
            AzureDevOpsAuthError: On authentication failures.
            AzureDevOpsError: On communication failures.
        """
        client = await self._get_client()
        url = f"{self.config.project_base_url}/wit/wiql"
        params = {"api-version": self.config.api_version}

        if wiql is None:
            types = work_item_types or DEFAULT_WORK_ITEM_TYPES
            types_clause = ", ".join(f"'{t}'" for t in types)

            conditions = [
                f"[System.TeamProject] = '{self.config.project}'",
                f"[System.WorkItemType] IN ({types_clause})",
                "[System.State] NOT IN ('Closed', 'Done', 'Removed')",
            ]

            if assigned_to_me:
                conditions.append("[System.AssignedTo] = @me")

            where_clause = " AND ".join(conditions)
            query = f"SELECT [System.Id] FROM WorkItems WHERE {where_clause} ORDER BY [System.Id] ASC"
        else:
            query = wiql

        payload = {"query": query}

        try:
            response = await client.post(url, json=payload, params=params)
            self._handle_error_response(response, "Executing WIQL work item query")

            data = response.json()
            work_items_data = data.get("workItems", [])
            return [int(item["id"]) for item in work_items_data if "id" in item]
        except httpx.RequestError as exc:
            raise AzureDevOpsError(f"Network error during WIQL query: {exc}") from exc

    async def get_work_item(self, work_item_id: int) -> AzureDevOpsWorkItem:
        """
        Fetch details for a single work item.

        Args:
            work_item_id: The Azure DevOps work item ID.

        Returns:
            AzureDevOpsWorkItem instance.

        Raises:
            AzureDevOpsNotFoundError: If work item does not exist (HTTP 404).
            AzureDevOpsAuthError: On authentication failure.
            AzureDevOpsError: On communication failure.
        """
        client = await self._get_client()
        url = f"{self.config.project_base_url}/wit/workitems/{work_item_id}"
        params = {
            "$expand": "all",
            "api-version": self.config.api_version,
        }

        try:
            response = await client.get(url, params=params)
            self._handle_error_response(response, f"Fetching work item #{work_item_id}")

            data = response.json()
            return AzureDevOpsWorkItem.from_api_response(data)
        except httpx.RequestError as exc:
            raise AzureDevOpsError(f"Network error fetching work item #{work_item_id}: {exc}") from exc

    async def get_work_items_batch(self, work_item_ids: List[int]) -> List[AzureDevOpsWorkItem]:
        """
        Fetch work items in batch using POST _apis/wit/workitemsbatch.

        Azure DevOps limits workitemsbatch requests to <= 200 items per request.
        This method automatically chunks work_item_ids into slices <= 200 and aggregates.

        Args:
            work_item_ids: List of work item IDs to fetch.

        Returns:
            List of AzureDevOpsWorkItem instances.
        """
        if not work_item_ids:
            return []

        client = await self._get_client()
        url = f"{self.config.project_base_url}/wit/workitemsbatch"
        params = {"api-version": self.config.api_version}

        results: List[AzureDevOpsWorkItem] = []

        # Chunk into slices <= MAX_BATCH_SIZE (200)
        chunks = [
            work_item_ids[i:i + self.MAX_BATCH_SIZE]
            for i in range(0, len(work_item_ids), self.MAX_BATCH_SIZE)
        ]

        for chunk in chunks:
            payload = {
                "ids": chunk,
                "$expand": "all",
            }
            try:
                response = await client.post(url, json=payload, params=params)
                self._handle_error_response(response, f"Fetching batch of {len(chunk)} work items")

                data = response.json()
                items = data.get("value", [])
                for item_dict in items:
                    results.append(AzureDevOpsWorkItem.from_api_response(item_dict))
            except httpx.RequestError as exc:
                raise AzureDevOpsError(f"Network error during batch work item fetch: {exc}") from exc

        return results

    async def update_work_item_state(
        self,
        work_item_id: int,
        new_state: str,
        comment: Optional[str] = None,
    ) -> AzureDevOpsWorkItem:
        """
        Update the state of a work item using JSON Patch.

        Args:
            work_item_id: The ID of the work item.
            new_state: The new state (e.g. 'Resolved', 'Active', 'Done').
            comment: Optional history comment explaining the update.

        Returns:
            Updated AzureDevOpsWorkItem instance.
        """
        client = await self._get_client()
        url = f"{self.config.project_base_url}/wit/workitems/{work_item_id}"
        params = {"api-version": self.config.api_version}

        patch_operations = [
            {
                "op": "add",
                "path": "/fields/System.State",
                "value": new_state,
            }
        ]

        if comment:
            patch_operations.append({
                "op": "add",
                "path": "/fields/System.History",
                "value": comment,
            })

        headers = {"Content-Type": "application/json-patch+json"}

        try:
            response = await client.patch(url, json=patch_operations, headers=headers, params=params)
            self._handle_error_response(response, f"Updating state of work item #{work_item_id} to '{new_state}'")

            data = response.json()
            return AzureDevOpsWorkItem.from_api_response(data)
        except httpx.RequestError as exc:
            raise AzureDevOpsError(f"Network error updating work item #{work_item_id}: {exc}") from exc

    async def add_work_item_comment(self, work_item_id: int, comment_text: str) -> Dict[str, Any]:
        """
        Add a comment to an existing work item.

        Args:
            work_item_id: The ID of the work item.
            comment_text: Markdown or plain text comment content.

        Returns:
            Dict containing comment metadata from the response.
        """
        client = await self._get_client()
        url = f"{self.config.project_base_url}/wit/workitems/{work_item_id}/comments"
        params = {"api-version": "7.1-preview.3"}

        payload = {"text": comment_text}

        try:
            response = await client.post(url, json=payload, params=params)
            self._handle_error_response(response, f"Adding comment to work item #{work_item_id}")

            return response.json()
        except httpx.RequestError as exc:
            raise AzureDevOpsError(f"Network error posting comment to work item #{work_item_id}: {exc}") from exc
