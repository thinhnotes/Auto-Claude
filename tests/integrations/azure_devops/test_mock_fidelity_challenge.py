"""
Empirical Challenge Harness for MockAzureDevOpsTransport & MockAzureDevOpsState
==============================================================================

Empirical stress tests verifying:
1. Strict offline execution (zero socket / network calls)
2. Status codes: 401, 203, 404, 400 with exact Azure DevOps error codes
3. RFC 6902 JSON patch compliance (state, history, multi-op, revision increments)
4. Batch response schema matching Azure DevOps REST API v7.0/v7.1
5. WIQL filtering edge cases and URL routing variations
"""

from __future__ import annotations

import base64
import json
import socket
import sys
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

_repo_root = Path(__file__).resolve().parents[3]
_backend_dir = _repo_root / "apps" / "backend"
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from apps.backend.integrations.azure_devops.config import AzureDevOpsConfig
from apps.backend.integrations.azure_devops.client import (
    AzureDevOpsClient,
    AzureDevOpsAuthError,
    AzureDevOpsNotFoundError,
    AzureDevOpsQueryError,
    ERR_TF400813,
    ERR_TF200016,
    ERR_TF401232,
    ERR_HTML_REDIRECT,
    ERR_WIQL_SYNTAX,
)
from tests.integrations.azure_devops.mock_transport import (
    MockAzureDevOpsState,
    MockAzureDevOpsTransport,
)


@pytest.fixture
def mock_state() -> MockAzureDevOpsState:
    state = MockAzureDevOpsState()
    return state


@pytest.fixture
def mock_transport(mock_state: MockAzureDevOpsState) -> MockAzureDevOpsTransport:
    return MockAzureDevOpsTransport(state=mock_state)


@pytest.fixture
def standard_config() -> AzureDevOpsConfig:
    return AzureDevOpsConfig(
        organization_url="https://dev.azure.com/my-org",
        project="my-project",
        personal_access_token="valid_test_pat",
        api_version="7.1",
    )


# ============================================================================
# 1. OFFLINE EXECUTION VERIFICATION
# ============================================================================

class TestOfflineExecution:
    """Ensure NO real network sockets or internet calls can be made."""

    @pytest.mark.asyncio
    async def test_offline_zero_sockets_used(
        self,
        standard_config: AzureDevOpsConfig,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """
        Force-disable socket.socket. Any attempt to touch a network socket
        raises an immediate RuntimeError.
        """
        def forbidden_socket(*args, **kwargs):
            raise RuntimeError("CRITICAL: Network socket creation attempted in offline mode!")

        with patch("socket.socket", side_effect=forbidden_socket):
            client = AzureDevOpsClient(config=standard_config, transport=mock_transport)

            # 1. validate_connection
            conn = await client.validate_connection()
            assert conn["valid"] is True

            # 2. query_work_items
            ids = await client.query_work_items(assigned_to_me=False)
            assert len(ids) >= 1

            # 3. get_work_item
            wi = await client.get_work_item(ids[0])
            assert wi.id == ids[0]

            # 4. get_work_items_batch
            batch = await client.get_work_items_batch(ids[:2])
            assert len(batch) == min(2, len(ids))

            # 5. update_work_item_state
            updated = await client.update_work_item_state(
                work_item_id=101,
                new_state="Resolved",
                comment="Offline test comment",
            )
            assert updated.state == "Resolved"

            # 6. add_work_item_comment
            comment = await client.add_work_item_comment(
                work_item_id=101,
                comment_text="Verified offline execution",
            )
            assert comment["workItemId"] == 101

            await client.close()

    def test_sync_mock_transport_offline(
        self,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """Verify synchronous httpx.Client works offline through mock transport."""
        def forbidden_socket(*args, **kwargs):
            raise RuntimeError("CRITICAL: Network socket creation attempted in sync offline mode!")

        with patch("socket.socket", side_effect=forbidden_socket):
            with httpx.Client(transport=mock_transport) as client:
                raw_b64 = base64.b64encode(b":valid_test_pat").decode("ascii")
                headers = {"Authorization": f"Basic {raw_b64}"}
                resp = client.get("https://dev.azure.com/my-org/_apis/projects/my-project", headers=headers)
                assert resp.status_code == 200
                data = resp.json()
                assert data["name"] == "my-project"


# ============================================================================
# 2. STATUS CODES EMPIRICAL VERIFICATION
# ============================================================================

class TestStatusCodesFidelity:
    """Verify HTTP status codes match Azure DevOps specification."""

    @pytest.mark.asyncio
    async def test_401_on_bad_pat(
        self,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """Bad PAT results in HTTP 401 with TF400813."""
        config = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="my-project",
            personal_access_token="completely_invalid_pat",
        )
        client = AzureDevOpsClient(config=config, transport=mock_transport)

        with pytest.raises(AzureDevOpsAuthError) as exc_info:
            await client.validate_connection()

        assert exc_info.value.status_code == 401
        assert exc_info.value.error_code == ERR_TF400813
        assert "TF400813" in str(exc_info.value)
        await client.close()

    @pytest.mark.asyncio
    async def test_401_on_missing_auth_header(
        self,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """Direct request with missing Authorization header gets 401 and WWW-Authenticate."""
        async with httpx.AsyncClient(transport=mock_transport) as direct_client:
            resp = await direct_client.get("https://dev.azure.com/my-org/_apis/projects/my-project")
            assert resp.status_code == 401
            assert "WWW-Authenticate" in resp.headers
            body = resp.json()
            assert body.get("errorCode") == ERR_TF400813

    @pytest.mark.asyncio
    async def test_203_on_missing_colon_prefix(
        self,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """
        Missing colon prefix in PAT triggers HTTP 203 HTML sign-in redirect,
        which AzureDevOpsClient translates to AzureDevOpsAuthError with ERR_HTML_REDIRECT.
        """
        raw_b64 = base64.b64encode(b"valid_test_pat").decode("ascii")  # Missing ':'
        headers = {"Authorization": f"Basic {raw_b64}"}

        async with httpx.AsyncClient(transport=mock_transport) as direct_client:
            resp = await direct_client.get(
                "https://dev.azure.com/my-org/_apis/projects/my-project",
                headers=headers,
            )
            assert resp.status_code == 203
            assert "text/html" in resp.headers["content-type"]
            assert "Redirecting" in resp.text

    @pytest.mark.asyncio
    async def test_404_on_nonexistent_project(
        self,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """Nonexistent project triggers 404 with TF200016."""
        config = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="this_project_does_not_exist",
            personal_access_token="valid_test_pat",
        )
        client = AzureDevOpsClient(config=config, transport=mock_transport)

        with pytest.raises(AzureDevOpsNotFoundError) as exc_info:
            await client.validate_connection()

        assert exc_info.value.status_code == 404
        assert exc_info.value.error_code == ERR_TF200016
        await client.close()

    @pytest.mark.asyncio
    async def test_404_on_nonexistent_organization(
        self,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """Nonexistent organization triggers 404 with TF200016."""
        config = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/ghost-org-does-not-exist",
            project="my-project",
            personal_access_token="valid_test_pat",
        )
        client = AzureDevOpsClient(config=config, transport=mock_transport)

        with pytest.raises(AzureDevOpsNotFoundError) as exc_info:
            await client.validate_connection()

        assert exc_info.value.status_code == 404
        assert exc_info.value.error_code == ERR_TF200016
        await client.close()

    @pytest.mark.asyncio
    async def test_404_on_nonexistent_work_item(
        self,
        standard_config: AzureDevOpsConfig,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """Fetching or patching nonexistent work item returns 404 with TF401232."""
        client = AzureDevOpsClient(config=standard_config, transport=mock_transport)

        # 1. GET nonexistent work item
        with pytest.raises(AzureDevOpsNotFoundError) as exc_get:
            await client.get_work_item(888888)
        assert exc_get.value.status_code == 404
        assert exc_get.value.error_code == ERR_TF401232

        # 2. PATCH nonexistent work item
        with pytest.raises(AzureDevOpsNotFoundError) as exc_patch:
            await client.update_work_item_state(888888, "Resolved")
        assert exc_patch.value.status_code == 404
        assert exc_patch.value.error_code == ERR_TF401232

        # 3. POST comment on nonexistent work item
        with pytest.raises(AzureDevOpsNotFoundError) as exc_comment:
            await client.add_work_item_comment(888888, "Missing item")
        assert exc_comment.value.status_code == 404
        assert exc_comment.value.error_code == ERR_TF401232

        await client.close()

    @pytest.mark.asyncio
    async def test_400_on_syntax_error(
        self,
        standard_config: AzureDevOpsConfig,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """Malformed WIQL query triggers HTTP 400 and AzureDevOpsQueryError."""
        client = AzureDevOpsClient(config=standard_config, transport=mock_transport)

        # Malformed queries
        invalid_queries = [
            "NOT_A_SELECT query",
            "SELECT System.Id FROM WorkItems WHERE INVALID_SYNTAX",
            "",
        ]

        for bad_q in invalid_queries:
            with pytest.raises(AzureDevOpsQueryError) as exc_info:
                await client.query_work_items(wiql=bad_q)
            assert exc_info.value.status_code == 400
            assert exc_info.value.error_code == ERR_WIQL_SYNTAX

        await client.close()


# ============================================================================
# 3. RFC 6902 JSON PATCH COMPLIANCE
# ============================================================================

class TestRFC6902PatchCompliance:
    """Verify JSON patch state updates comply with RFC 6902."""

    @pytest.mark.asyncio
    async def test_patch_path_fields_system_state(
        self,
        standard_config: AzureDevOpsConfig,
        mock_transport: MockAzureDevOpsTransport,
        mock_state: MockAzureDevOpsState,
    ) -> None:
        """Path /fields/System.State correctly modifies state and increments revision."""
        client = AzureDevOpsClient(config=standard_config, transport=mock_transport)

        item = mock_state.get_work_item(102)
        initial_rev = item["rev"]
        assert item["fields"]["System.State"] == "Active"

        updated = await client.update_work_item_state(
            work_item_id=102,
            new_state="Done",
            comment="Completed via Auto Claude",
        )

        assert updated.state == "Done"
        persisted = mock_state.get_work_item(102)
        assert persisted["fields"]["System.State"] == "Done"
        assert persisted["fields"]["System.History"] == "Completed via Auto Claude"
        assert persisted["rev"] == initial_rev + 1
        assert "System.ChangedDate" in persisted["fields"]

        await client.close()

    @pytest.mark.asyncio
    async def test_patch_multi_field_rfc6902_operations(
        self,
        mock_transport: MockAzureDevOpsTransport,
        mock_state: MockAzureDevOpsState,
    ) -> None:
        """Direct RFC 6902 patch supporting multiple simultaneous add/replace operations."""
        raw_b64 = base64.b64encode(b":valid_test_pat").decode("ascii")
        headers = {
            "Authorization": f"Basic {raw_b64}",
            "Content-Type": "application/json-patch+json",
        }

        patch_ops = [
            {"op": "replace", "path": "/fields/System.State", "value": "In Review"},
            {"op": "add", "path": "/fields/System.Title", "value": "RFC 6902 Updated Title"},
            {"op": "add", "path": "/fields/System.History", "value": "Multi-op audit comment"},
        ]

        async with httpx.AsyncClient(transport=mock_transport) as direct_client:
            resp = await direct_client.patch(
                "https://dev.azure.com/my-org/my-project/_apis/wit/workitems/103",
                headers=headers,
                json=patch_ops,
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["fields"]["System.State"] == "In Review"
            assert data["fields"]["System.Title"] == "RFC 6902 Updated Title"
            assert data["fields"]["System.History"] == "Multi-op audit comment"
            assert data["rev"] == 2


# ============================================================================
# 4. BATCH RESPONSES SCHEMA COMPLIANCE (v7.0/v7.1)
# ============================================================================

class TestBatchResponsesSchemaFidelity:
    """Verify batch response matches Azure DevOps REST API v7.0/v7.1 schema."""

    @pytest.mark.asyncio
    async def test_batch_response_envelope_and_item_schema(
        self,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """
        Verify top-level envelope {'count': N, 'value': [...]} and
        individual work item fields conform to Azure DevOps REST API v7.0/v7.1.
        """
        raw_b64 = base64.b64encode(b":valid_test_pat").decode("ascii")
        headers = {
            "Authorization": f"Basic {raw_b64}",
            "Content-Type": "application/json",
        }

        body = {
            "ids": [101, 102, 103],
            "$expand": "all",
        }

        async with httpx.AsyncClient(transport=mock_transport) as direct_client:
            resp = await direct_client.post(
                "https://dev.azure.com/my-org/my-project/_apis/wit/workitemsbatch?api-version=7.1",
                headers=headers,
                json=body,
            )
            assert resp.status_code == 200
            data = resp.json()

            # Envelope schema check
            assert "count" in data
            assert "value" in data
            assert isinstance(data["count"], int)
            assert isinstance(data["value"], list)
            assert data["count"] == 3
            assert len(data["value"]) == 3

            # Work item schema check
            for item in data["value"]:
                assert "id" in item
                assert isinstance(item["id"], int)
                assert "rev" in item
                assert isinstance(item["rev"], int)
                assert "fields" in item
                assert isinstance(item["fields"], dict)
                assert "url" in item
                assert item["url"].startswith("https://dev.azure.com/my-org/my-project/_apis/wit/workitems/")

                fields = item["fields"]
                assert "System.Id" in fields
                assert "System.TeamProject" in fields
                assert "System.WorkItemType" in fields
                assert "System.State" in fields
                assert "System.Title" in fields
                assert "System.CreatedDate" in fields
                assert "System.ChangedDate" in fields

    @pytest.mark.asyncio
    async def test_batch_missing_work_items_omitted_not_failed(
        self,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """
        In Azure DevOps REST API, work items that do not exist are omitted
        from the 'value' array; count reflects found items.
        """
        raw_b64 = base64.b64encode(b":valid_test_pat").decode("ascii")
        headers = {"Authorization": f"Basic {raw_b64}"}

        body = {"ids": [101, 999999, 102]}

        async with httpx.AsyncClient(transport=mock_transport) as direct_client:
            resp = await direct_client.post(
                "https://dev.azure.com/my-org/my-project/_apis/wit/workitemsbatch",
                headers=headers,
                json=body,
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["count"] == 2
            ids = [it["id"] for it in data["value"]]
            assert ids == [101, 102]
            assert 999999 not in ids


# ============================================================================
# 5. WIQL & URL ROUTING FIDELITY TESTS
# ============================================================================

class TestWIQLAndRoutingFidelity:
    """Stress tests for URL routing and WIQL filter evaluation."""

    @pytest.mark.asyncio
    async def test_legacy_visualstudio_com_routing(
        self,
        mock_transport: MockAzureDevOpsTransport,
    ) -> None:
        """Verify routing for https://my-org.visualstudio.com legacy URLs."""
        raw_b64 = base64.b64encode(b":valid_test_pat").decode("ascii")
        headers = {"Authorization": f"Basic {raw_b64}"}

        async with httpx.AsyncClient(transport=mock_transport) as direct_client:
            # 1. Project info
            resp1 = await direct_client.get(
                "https://my-org.visualstudio.com/_apis/projects/my-project",
                headers=headers,
            )
            assert resp1.status_code == 200
            assert resp1.json()["name"] == "my-project"

            # 2. Work item info
            resp2 = await direct_client.get(
                "https://my-org.visualstudio.com/my-project/_apis/wit/workitems/101",
                headers=headers,
            )
            assert resp2.status_code == 200
            assert resp2.json()["id"] == 101

    @pytest.mark.asyncio
    async def test_wiql_project_scoping(
        self,
        mock_transport: MockAzureDevOpsTransport,
        mock_state: MockAzureDevOpsState,
    ) -> None:
        """WIQL query on 'my-project' does not return items belonging to 'other-project'."""
        mock_state.add_work_item(
            {"System.Title": "Item in test project", "System.WorkItemType": "Task"},
            project="test-project",
            org="test-org",
            item_id=777,
        )

        config = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="my-project",
            personal_access_token="valid_test_pat",
        )
        client = AzureDevOpsClient(config=config, transport=mock_transport)

        ids = await client.query_work_items(assigned_to_me=False)
        assert 777 not in ids
        await client.close()
