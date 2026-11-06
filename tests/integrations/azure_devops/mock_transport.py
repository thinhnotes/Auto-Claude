"""
Mock Azure DevOps REST API Transport & In-Memory State
======================================================

Provides offline simulation of the Azure DevOps REST API (v7.1) for testing
without live network requests or actual Azure DevOps Personal Access Tokens.

Features:
  - Dual sync/async support via httpx.MockTransport subclassing
  - RFC 6902 JSON Patch state updates
  - WIQL query evaluation and filtering
  - Authentication validation (401 TF400813, 203 HTML sign-in redirect)
  - Project/Org validation (404 TF200016)
  - Work item CRUD & comment tracking (404 TF401232)
"""

from __future__ import annotations

import base64
import json
import re
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlparse

import httpx
import pytest

_repo_root = Path(__file__).resolve().parents[3]
_backend_dir = _repo_root / "apps" / "backend"
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

try:
    from apps.backend.integrations.azure_devops.config import AzureDevOpsConfig
    from apps.backend.integrations.azure_devops.client import AzureDevOpsClient
except ImportError:
    from integrations.azure_devops.config import AzureDevOpsConfig
    from integrations.azure_devops.client import AzureDevOpsClient


# Known Error Codes matching real Azure DevOps API
ERR_TF400813 = "TF400813"  # Unauthorized
ERR_TF200016 = "TF200016"  # Project or Organization does not exist
ERR_TF401232 = "TF401232"  # Work item does not exist
ERR_VS402337 = "VS402337"  # WIQL syntax error


class MockAzureDevOpsState:
    """
    In-memory storage simulating Azure DevOps organizations, projects,
    work items, comments, and valid PAT credentials.
    """

    def __init__(self) -> None:
        self.organizations: Set[str] = set()
        self.projects: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.valid_pats: Set[str] = set()
        self.work_items: Dict[int, Dict[str, Any]] = {}
        self.comments: Dict[int, List[Dict[str, Any]]] = {}
        self._next_work_item_id: int = 1
        self._next_comment_id: int = 1
        self.reset()

    def reset(self) -> None:
        """Reset state to default baseline."""
        self.organizations = {"my-org", "test-org"}
        self.projects = {
            "my-org": {
                "my-project": {
                    "id": "b1a2c3d4-e5f6-7890-abcd-ef1234567890",
                    "name": "my-project",
                    "description": "Mock primary project",
                    "state": "wellFormed",
                    "visibility": "private",
                }
            },
            "test-org": {
                "test-project": {
                    "id": "c2b3d4e5-f6a7-8901-bcde-fa2345678901",
                    "name": "test-project",
                    "description": "Mock secondary project",
                    "state": "wellFormed",
                    "visibility": "private",
                }
            },
        }
        self.valid_pats = {"valid_test_pat", "secret_pat_123", "default_pat"}
        self.work_items.clear()
        self.comments.clear()
        self._next_work_item_id = 1
        self._next_comment_id = 1
        self.seed_default()

    def seed_default(self) -> None:
        """Seed pre-configured work items covering Bugs, Tasks, and User Stories."""
        # Item 101: Active Bug with ReproSteps & Tags
        self.add_work_item(
            {
                "System.Id": 101,
                "System.TeamProject": "my-project",
                "System.WorkItemType": "Bug",
                "System.State": "Active",
                "System.Title": "Authentication crash on empty token",
                "System.Description": "<div>The authentication layer raises unhandled exception.</div>",
                "Microsoft.VSTS.TCM.ReproSteps": "<div>1. Launch with empty PAT<br>2. Observe crash</div>",
                "Microsoft.VSTS.Common.Priority": 1,
                "System.Tags": "backend; auth; urgent",
                "System.AssignedTo": {"displayName": "Auto Claude", "uniqueName": "auto-claude@bot.local"},
            },
            item_id=101,
        )

        # Item 102: Active Task
        self.add_work_item(
            {
                "System.Id": 102,
                "System.TeamProject": "my-project",
                "System.WorkItemType": "Task",
                "System.State": "Active",
                "System.Title": "Implement WIQL query builder",
                "System.Description": "Build query builder with type and state filters.",
                "Microsoft.VSTS.Common.Priority": 2,
                "System.Tags": "backend; wiql",
                "System.AssignedTo": {"displayName": "Auto Claude", "uniqueName": "auto-claude@bot.local"},
            },
            item_id=102,
        )

        # Item 103: New User Story
        self.add_work_item(
            {
                "System.Id": 103,
                "System.TeamProject": "my-project",
                "System.WorkItemType": "User Story",
                "System.State": "New",
                "System.Title": "Support Azure DevOps Two-Way Sync",
                "System.Description": "As an engineer, I want status synced back to Azure DevOps.",
                "Microsoft.VSTS.Common.Priority": 2,
                "System.Tags": "integration; sync",
            },
            item_id=103,
        )

        # Item 104: Resolved Bug
        self.add_work_item(
            {
                "System.Id": 104,
                "System.TeamProject": "my-project",
                "System.WorkItemType": "Bug",
                "System.State": "Resolved",
                "System.Title": "Resolved memory leak in worker",
                "System.Description": "Memory leak fixed in event loop.",
                "Microsoft.VSTS.Common.Priority": 3,
                "System.Tags": "performance",
            },
            item_id=104,
        )

        # Item 105: Closed Task (should be filtered out by default WIQL)
        self.add_work_item(
            {
                "System.Id": 105,
                "System.TeamProject": "my-project",
                "System.WorkItemType": "Task",
                "System.State": "Closed",
                "System.Title": "Closed cleanup ticket",
                "System.Description": "Old task already closed.",
                "Microsoft.VSTS.Common.Priority": 4,
            },
            item_id=105,
        )

    def add_work_item(
        self,
        fields: Dict[str, Any],
        project: str = "my-project",
        org: str = "my-org",
        item_id: Optional[int] = None,
    ) -> int:
        """Add a work item to the in-memory store."""
        wid = item_id if item_id is not None else self._next_work_item_id
        if item_id is not None and item_id >= self._next_work_item_id:
            self._next_work_item_id = item_id + 1
        elif item_id is None:
            self._next_work_item_id += 1

        fields_copy = dict(fields)
        fields_copy["System.Id"] = wid
        fields_copy.setdefault("System.TeamProject", project)
        fields_copy.setdefault("System.State", "New")
        fields_copy.setdefault("System.WorkItemType", "Task")
        fields_copy.setdefault("System.Title", f"Work Item #{wid}")
        fields_copy.setdefault("Microsoft.VSTS.Common.Priority", 3)
        fields_copy.setdefault("System.CreatedDate", datetime.now(timezone.utc).isoformat())
        fields_copy.setdefault("System.ChangedDate", datetime.now(timezone.utc).isoformat())

        self.work_items[wid] = {
            "id": wid,
            "rev": 1,
            "fields": fields_copy,
            "url": f"https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{wid}",
        }
        return wid

    def get_work_item(self, work_item_id: int) -> Optional[Dict[str, Any]]:
        """Get a copy of a work item by ID."""
        item = self.work_items.get(work_item_id)
        return deepcopy(item) if item else None

    def update_work_item(self, work_item_id: int, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update fields of an existing work item and increment its rev."""
        item = self.work_items.get(work_item_id)
        if not item:
            return None
        item["fields"].update(updates)
        item["rev"] += 1
        item["fields"]["System.ChangedDate"] = datetime.now(timezone.utc).isoformat()
        return deepcopy(item)

    def add_comment(self, work_item_id: int, text: str) -> Dict[str, Any]:
        """Record a comment associated with a work item."""
        cid = self._next_comment_id
        self._next_comment_id += 1
        now_str = datetime.now(timezone.utc).isoformat()
        comment = {
            "id": cid,
            "workItemId": work_item_id,
            "version": 1,
            "text": text,
            "createdBy": {
                "displayName": "Auto Claude",
                "uniqueName": "auto-claude@bot.local",
            },
            "createdDate": now_str,
            "url": f"https://dev.azure.com/my-org/my-project/_apis/wit/workitems/{work_item_id}/comments/{cid}",
        }
        self.comments.setdefault(work_item_id, []).append(comment)
        return comment

    def get_comments(self, work_item_id: int) -> List[Dict[str, Any]]:
        """Get all comments for a work item."""
        return deepcopy(self.comments.get(work_item_id, []))


class MockAzureDevOpsTransport(httpx.MockTransport):
    """
    Simulates Azure DevOps REST API over httpx without network calls.
    Supports both synchronous and asynchronous httpx clients.
    """

    def __init__(self, state: Optional[MockAzureDevOpsState] = None) -> None:
        self.state = state or MockAzureDevOpsState()
        super().__init__(self.handle_request)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        """Route and execute request against in-memory state."""
        url_str = str(request.url)
        parsed = urlparse(url_str)
        host = parsed.netloc.split(":")[0].lower()
        path = parsed.path
        method = request.method.upper()

        # --------------------------------------------------------------------
        # 1. Authentication Check
        # --------------------------------------------------------------------
        auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
        if not auth_header:
            return httpx.Response(
                401,
                json={
                    "$id": "1",
                    "innerException": None,
                    "message": "TF400813: The user '' is not authorized to access this resource.",
                    "typeName": "Microsoft.TeamFoundation.Framework.Server.UnauthorizedRequestException, Microsoft.TeamFoundation.Framework.Server",
                    "typeKey": "UnauthorizedRequestException",
                    "errorCode": ERR_TF400813,
                    "eventId": 3000,
                },
                headers={"WWW-Authenticate": 'Basic realm="https://dev.azure.com"'},
            )

        if not auth_header.startswith("Basic "):
            return httpx.Response(401, json={"message": "Invalid authentication scheme", "errorCode": ERR_TF400813})

        b64_part = auth_header.split(" ", 1)[1].strip()
        try:
            decoded = base64.b64decode(b64_part).decode("utf-8")
        except Exception:
            return httpx.Response(401, json={"message": "Invalid base64 encoding", "errorCode": ERR_TF400813})

        # Azure DevOps returns HTTP 203 HTML sign-in redirect when colon prefix is missing
        if ":" not in decoded:
            return httpx.Response(
                203,
                headers={"Content-Type": "text/html; charset=utf-8"},
                text="<html><head><title>Sign In</title></head><body>Redirecting to sign-in page...</body></html>",
            )

        user, pat = decoded.split(":", 1)
        if pat not in self.state.valid_pats:
            return httpx.Response(
                401,
                json={
                    "$id": "1",
                    "message": f"TF400813: The user '{user}' is not authorized to access this resource.",
                    "typeName": "Microsoft.TeamFoundation.Framework.Server.UnauthorizedRequestException",
                    "typeKey": "UnauthorizedRequestException",
                    "errorCode": ERR_TF400813,
                },
            )

        # --------------------------------------------------------------------
        # 2. Extract Organization, Project, and Endpoint Path
        # --------------------------------------------------------------------
        org: Optional[str] = None
        project: Optional[str] = None
        endpoint: str = ""

        if host.endswith(".visualstudio.com"):
            org = host.split(".visualstudio.com")[0]
            m1 = re.match(r"^/_apis/projects(?:/([^/]+))?", path)
            if m1:
                project = m1.group(1)
                endpoint = "projects"
            else:
                m2 = re.match(r"^/([^/]+)/_apis/(.*)", path)
                if m2:
                    project = m2.group(1)
                    endpoint = m2.group(2)
        elif host == "dev.azure.com":
            m1 = re.match(r"^/([^/]+)/_apis/projects(?:/([^/]+))?", path)
            if m1:
                org = m1.group(1)
                project = m1.group(2)
                endpoint = "projects"
            else:
                m2 = re.match(r"^/([^/]+)/([^/]+)/_apis/(.*)", path)
                if m2:
                    org = m2.group(1)
                    project = m2.group(2)
                    endpoint = m2.group(3)
                else:
                    m3 = re.match(r"^/([^/]+)/_apis/(.*)", path)
                    if m3:
                        org = m3.group(1)
                        endpoint = m3.group(2)

        # --------------------------------------------------------------------
        # 3. Organization & Project Existence Validation
        # --------------------------------------------------------------------
        if org and org not in self.state.organizations:
            return httpx.Response(
                404,
                json={
                    "$id": "1",
                    "message": f"TF200016: The following organization does not exist: {org}.",
                    "typeName": "Microsoft.TeamFoundation.Framework.Server.HostDoesNotExistException",
                    "typeKey": "HostDoesNotExistException",
                    "errorCode": ERR_TF200016,
                },
            )

        if project and org and project not in self.state.projects.get(org, {}):
            return httpx.Response(
                404,
                json={
                    "$id": "1",
                    "message": f"TF200016: The following project does not exist: {project}.",
                    "typeName": "Microsoft.TeamFoundation.Core.WebApi.ProjectDoesNotExistException",
                    "typeKey": "ProjectDoesNotExistException",
                    "errorCode": ERR_TF200016,
                },
            )

        # --------------------------------------------------------------------
        # 4. Route Execution
        # --------------------------------------------------------------------

        # A. Project Validation (GET /_apis/projects/{project})
        if endpoint == "projects" or endpoint.startswith("projects/"):
            proj_name = project or "my-project"
            proj_info = self.state.projects.get(org or "my-org", {}).get(proj_name, {})
            return httpx.Response(
                200,
                json={
                    "id": proj_info.get("id", "b1a2c3d4-e5f6-7890-abcd-ef1234567890"),
                    "name": proj_name,
                    "description": proj_info.get("description", "Mock Azure DevOps Project"),
                    "url": f"https://dev.azure.com/{org}/{proj_name}",
                    "state": proj_info.get("state", "wellFormed"),
                    "visibility": proj_info.get("visibility", "private"),
                },
            )

        # B. WIQL Query (POST /wit/wiql)
        if endpoint == "wit/wiql" and method == "POST":
            try:
                body = json.loads(request.content.decode("utf-8"))
                query = body.get("query", "")
            except Exception:
                query = ""

            if not query.strip().upper().startswith("SELECT") or "INVALID_SYNTAX" in query:
                return httpx.Response(
                    400,
                    json={
                        "$id": "1",
                        "message": "VS402337: WIQL query syntax error or unclosed string literal.",
                        "typeName": "Microsoft.TeamFoundation.WorkItemTracking.Server.WiqlSyntaxException",
                        "typeKey": "WiqlSyntaxException",
                        "errorCode": ERR_VS402337,
                    },
                )

            # Parse WIQL type and state filters
            type_in_match = re.search(r"\[System\.WorkItemType\]\s+IN\s*\(([^)]+)\)", query, re.IGNORECASE)
            type_eq_match = re.search(r"\[System\.WorkItemType\]\s*=\s*['\"]([^'\"]+)['\"]", query, re.IGNORECASE)
            allowed_types: Optional[Set[str]] = None
            if type_in_match:
                allowed_types = {t.strip().strip("'\"") for t in type_in_match.group(1).split(",")}
            elif type_eq_match:
                allowed_types = {type_eq_match.group(1).strip()}

            state_not_in_match = re.search(r"\[System\.State\]\s+NOT\s+IN\s*\(([^)]+)\)", query, re.IGNORECASE)
            state_in_match = re.search(r"\[System\.State\]\s+IN\s*\(([^)]+)\)", query, re.IGNORECASE)
            state_eq_match = re.search(r"\[System\.State\]\s*=\s*['\"]([^'\"]+)['\"]", query, re.IGNORECASE)
            excluded_states: Set[str] = set()
            required_states: Optional[Set[str]] = None
            if state_not_in_match:
                excluded_states = {s.strip().strip("'\"") for s in state_not_in_match.group(1).split(",")}
            elif state_in_match:
                required_states = {s.strip().strip("'\"") for s in state_in_match.group(1).split(",")}
            elif state_eq_match:
                required_states = {state_eq_match.group(1).strip()}

            matched_ids: List[int] = []
            for item_id, item in self.state.work_items.items():
                fields = item.get("fields", {})
                wtype = fields.get("System.WorkItemType")
                wstate = fields.get("System.State")
                wproj = fields.get("System.TeamProject")

                if project and wproj and wproj.lower() != project.lower():
                    continue
                if allowed_types and wtype not in allowed_types:
                    continue
                if required_states and wstate not in required_states:
                    continue
                if wstate in excluded_states:
                    continue
                matched_ids.append(item_id)

            matched_ids.sort()
            return httpx.Response(
                200,
                json={
                    "queryType": "flat",
                    "queryResultType": "workItem",
                    "asOf": datetime.now(timezone.utc).isoformat(),
                    "columns": [{"referenceName": "System.Id", "name": "ID"}],
                    "workItems": [
                        {
                            "id": wid,
                            "url": f"https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{wid}",
                        }
                        for wid in matched_ids
                    ],
                },
            )

        # C. Batch Work Items Fetch (POST /wit/workitemsbatch)
        if endpoint == "wit/workitemsbatch" and method == "POST":
            body = json.loads(request.content.decode("utf-8"))
            requested_ids = body.get("ids", [])
            found_items = [
                deepcopy(self.state.work_items[wid])
                for wid in requested_ids
                if wid in self.state.work_items
            ]
            return httpx.Response(200, json={"count": len(found_items), "value": found_items})

        # D. Work Item Comments (POST/GET /wit/workitems/{id}/comments)
        m_comment = re.match(r"^wit/workitems/(\d+)/comments", endpoint)
        if m_comment:
            wid = int(m_comment.group(1))
            if wid not in self.state.work_items:
                return httpx.Response(
                    404,
                    json={
                        "$id": "1",
                        "message": f"TF401232: Work item {wid} does not exist, or you do not have permissions to read it.",
                        "typeName": "Microsoft.TeamFoundation.WorkItemTracking.Server.WorkItemNotFoundException",
                        "typeKey": "WorkItemNotFoundException",
                        "errorCode": ERR_TF401232,
                    },
                )
            if method == "POST":
                body = json.loads(request.content.decode("utf-8"))
                comment_text = body.get("text", "")
                created_comment = self.state.add_comment(wid, comment_text)
                return httpx.Response(200, json=created_comment)
            elif method == "GET":
                comments = self.state.get_comments(wid)
                return httpx.Response(200, json={"count": len(comments), "comments": comments})

        # E. Single Work Item GET & PATCH (GET/PATCH /wit/workitems/{id})
        m_wi = re.match(r"^wit/workitems/(\d+)$", endpoint)
        if m_wi:
            wid = int(m_wi.group(1))
            if wid not in self.state.work_items:
                return httpx.Response(
                    404,
                    json={
                        "$id": "1",
                        "message": f"TF401232: Work item {wid} does not exist, or you do not have permissions to read it.",
                        "typeName": "Microsoft.TeamFoundation.WorkItemTracking.Server.WorkItemNotFoundException",
                        "typeKey": "WorkItemNotFoundException",
                        "errorCode": ERR_TF401232,
                    },
                )

            if method == "GET":
                return httpx.Response(200, json=deepcopy(self.state.work_items[wid]))

            if method == "PATCH":
                operations = json.loads(request.content.decode("utf-8"))
                item = self.state.work_items[wid]
                for op in operations:
                    op_type = op.get("op", "add")
                    path_str = op.get("path", "")
                    value = op.get("value")
                    if path_str.startswith("/fields/"):
                        field_name = path_str[len("/fields/"):]
                        item["fields"][field_name] = value

                item["rev"] += 1
                item["fields"]["System.ChangedDate"] = datetime.now(timezone.utc).isoformat()
                return httpx.Response(200, json=deepcopy(item))

        # Unhandled Endpoint
        return httpx.Response(404, json={"message": f"Mock endpoint not found: {endpoint}"})


# ============================================================================
# Pytest Fixtures
# ============================================================================

@pytest.fixture
def mock_ado_state() -> MockAzureDevOpsState:
    """Fixture providing a fresh in-memory state for each test."""
    return MockAzureDevOpsState()


@pytest.fixture
def mock_ado_transport(mock_ado_state: MockAzureDevOpsState) -> MockAzureDevOpsTransport:
    """Fixture providing the offline MockAzureDevOpsTransport."""
    return MockAzureDevOpsTransport(state=mock_ado_state)


@pytest.fixture
def ado_config() -> AzureDevOpsConfig:
    """Standard valid AzureDevOpsConfig pointing to mock instance."""
    return AzureDevOpsConfig(
        organization_url="https://dev.azure.com/my-org",
        project="my-project",
        personal_access_token="valid_test_pat",
        api_version="7.1",
    )


@pytest.fixture
def ado_client(ado_config: AzureDevOpsConfig, mock_ado_transport: MockAzureDevOpsTransport) -> AzureDevOpsClient:
    """AzureDevOpsClient wired to offline mock transport."""
    return AzureDevOpsClient(config=ado_config, transport=mock_ado_transport)
