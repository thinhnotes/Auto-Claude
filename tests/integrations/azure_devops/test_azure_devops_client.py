"""
Unit Tests for Azure DevOps REST API Client
===========================================

Tier 1 & 2 automated tests validating configuration, authentication,
WIQL query handling, batch work item ingestion, JSON patch state updates,
and error handling. Runs 100% offline using MockAzureDevOpsTransport.
"""

from __future__ import annotations

import base64
import os
import sys
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

# Ensure repository root and backend directory are in sys.path
_repo_root = Path(__file__).resolve().parents[3]
_backend_dir = _repo_root / "apps" / "backend"
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

try:
    from apps.backend.integrations.azure_devops.config import (
        AzureDevOpsConfig,
        normalize_azure_devops_url,
    )
    from apps.backend.integrations.azure_devops.client import (
        AzureDevOpsClient,
        AzureDevOpsAuthError,
        AzureDevOpsNotFoundError,
        AzureDevOpsQueryError,
    )
    from apps.backend.integrations.azure_devops.models import (
        AzureDevOpsWorkItem,
        TicketExecutionResult,
    )
except ImportError:
    from integrations.azure_devops.config import (
        AzureDevOpsConfig,
        normalize_azure_devops_url,
    )
    from integrations.azure_devops.client import (
        AzureDevOpsClient,
        AzureDevOpsAuthError,
        AzureDevOpsNotFoundError,
        AzureDevOpsQueryError,
    )
    from integrations.azure_devops.models import (
        AzureDevOpsWorkItem,
        TicketExecutionResult,
    )

from .mock_transport import (
    MockAzureDevOpsState,
    MockAzureDevOpsTransport,
    ERR_TF400813,
    ERR_TF200016,
    ERR_TF401232,
    ado_client,
    ado_config,
    mock_ado_state,
    mock_ado_transport,
)


# ============================================================================
# 1. Configuration & URL Normalization Tests (F1.1)
# ============================================================================

class TestAzureDevOpsConfig:
    """Tests for configuration dataclass and URL normalization."""

    def test_config_from_env_and_defaults(self) -> None:
        """Environment variables are correctly read into AzureDevOpsConfig."""
        env_vars = {
            "AZURE_DEVOPS_PAT": "pat_env_test_123",
            "AZURE_DEVOPS_ORG": "https://dev.azure.com/my-org",
            "AZURE_DEVOPS_PROJECT": "my-project",
        }
        with patch.dict(os.environ, env_vars, clear=False):
            config = AzureDevOpsConfig.from_env()
            assert config.is_valid() is True
            assert config.organization_url == "https://dev.azure.com/my-org"
            assert config.project == "my-project"
            assert config.personal_access_token == "pat_env_test_123"
            assert config.project_base_url == "https://dev.azure.com/my-org/my-project/_apis"
            assert config.org_base_url == "https://dev.azure.com/my-org/_apis"
            assert config.get_mapped_state("completed") == "Resolved"

    def test_url_normalizer_variations(self) -> None:
        """URL normalizer handles modern, legacy, trailing slashes, and embedded projects."""
        # 1. Modern dev.azure.com trailing slash
        url, proj = normalize_azure_devops_url("https://dev.azure.com/my-org/")
        assert url == "https://dev.azure.com/my-org"
        assert proj is None

        # 2. Modern with project embedded
        url, proj = normalize_azure_devops_url("https://dev.azure.com/my-org/my-proj")
        assert url == "https://dev.azure.com/my-org"
        assert proj == "my-proj"

        # 3. Legacy visualstudio.com
        url, proj = normalize_azure_devops_url("https://my-org.visualstudio.com/")
        assert url == "https://my-org.visualstudio.com"
        assert proj is None

        # 4. Legacy with project embedded
        url, proj = normalize_azure_devops_url("https://my-org.visualstudio.com/legacy-proj")
        assert url == "https://my-org.visualstudio.com"
        assert proj == "legacy-proj"

        # 5. Plain organization name
        url, proj = normalize_azure_devops_url("plain-org")
        assert url == "https://dev.azure.com/plain-org"
        assert proj is None

        # 6. Empty URL
        url, proj = normalize_azure_devops_url("")
        assert url == ""
        assert proj is None


# ============================================================================
# 2. Authentication & Connection Validation Tests (F1.1)
# ============================================================================

class TestAzureDevOpsClientAuthentication:
    """Tests for credentials validation and project connection checks."""

    @pytest.mark.asyncio
    async def test_validate_connection_success(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Valid PAT and project return success with project metadata."""
        result = await ado_client.validate_connection()
        assert result["valid"] is True
        assert result["project_name"] == "my-project"
        assert result["state"] == "wellFormed"
        assert "project_id" in result
        await ado_client.close()

    @pytest.mark.asyncio
    async def test_validate_connection_401_invalid_pat(
        self, mock_ado_transport: MockAzureDevOpsTransport
    ) -> None:
        """Invalid PAT raises AzureDevOpsAuthError with HTTP 401 and TF400813."""
        config = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="my-project",
            personal_access_token="invalid_expired_token",
        )
        client = AzureDevOpsClient(config=config, transport=mock_ado_transport)

        with pytest.raises(AzureDevOpsAuthError) as exc_info:
            await client.validate_connection()

        assert exc_info.value.status_code == 401
        assert exc_info.value.error_code == ERR_TF400813
        assert "TF400813" in str(exc_info.value)
        await client.close()

    @pytest.mark.asyncio
    async def test_validate_connection_401_missing_auth(
        self, mock_ado_transport: MockAzureDevOpsTransport
    ) -> None:
        """Missing credentials configuration raises AzureDevOpsAuthError before call."""
        config = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="my-project",
            personal_access_token="",  # Empty PAT
        )
        client = AzureDevOpsClient(config=config, transport=mock_ado_transport)

        with pytest.raises(AzureDevOpsAuthError) as exc_info:
            await client.validate_connection()

        assert exc_info.value.status_code == 400
        await client.close()

    @pytest.mark.asyncio
    async def test_validate_connection_203_missing_colon_prefix(
        self, mock_ado_transport: MockAzureDevOpsTransport
    ) -> None:
        """
        Missing colon prefix in Basic Auth triggers HTTP 203 Non-Authoritative Information
        which AzureDevOpsClient maps to AzureDevOpsAuthError (HTML_REDIRECT).
        """
        raw_b64 = base64.b64encode(b"valid_test_pat").decode("ascii")
        headers = {"Authorization": f"Basic {raw_b64}"}

        async with httpx.AsyncClient(transport=mock_ado_transport) as direct_client:
            resp = await direct_client.get(
                "https://dev.azure.com/my-org/_apis/projects/my-project",
                headers=headers,
            )
            assert resp.status_code == 203
            assert "text/html" in resp.headers.get("content-type", "")
            assert "Sign In" in resp.text

    @pytest.mark.asyncio
    async def test_validate_connection_404_nonexistent_project(
        self, mock_ado_transport: MockAzureDevOpsTransport
    ) -> None:
        """Non-existent project raises AzureDevOpsNotFoundError with HTTP 404 and TF200016."""
        config = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="nonexistent_project_xyz",
            personal_access_token="valid_test_pat",
        )
        client = AzureDevOpsClient(config=config, transport=mock_ado_transport)

        with pytest.raises(AzureDevOpsNotFoundError) as exc_info:
            await client.validate_connection()

        assert exc_info.value.status_code == 404
        assert exc_info.value.error_code == ERR_TF200016
        await client.close()

    @pytest.mark.asyncio
    async def test_validate_connection_404_nonexistent_org(
        self, mock_ado_transport: MockAzureDevOpsTransport
    ) -> None:
        """Non-existent organization raises AzureDevOpsNotFoundError with HTTP 404."""
        config = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/unknown-org-123",
            project="my-project",
            personal_access_token="valid_test_pat",
        )
        client = AzureDevOpsClient(config=config, transport=mock_ado_transport)

        with pytest.raises(AzureDevOpsNotFoundError) as exc_info:
            await client.validate_connection()

        assert exc_info.value.status_code == 404
        assert exc_info.value.error_code == ERR_TF200016
        await client.close()

    def test_client_basic_auth_header(self, ado_client: AzureDevOpsClient) -> None:
        """Header contains properly base64-encoded Basic :<PAT>."""
        auth_val = ado_client._headers["Authorization"]
        assert auth_val.startswith("Basic ")
        encoded = auth_val.split(" ", 1)[1]
        decoded = base64.b64decode(encoded).decode("utf-8")
        assert decoded == ":valid_test_pat"


# ============================================================================
# 3. WIQL Query Tests (F1.2)
# ============================================================================

class TestAzureDevOpsClientWIQL:
    """Tests for Work Item Query Language execution and filtering."""

    @pytest.mark.asyncio
    async def test_query_work_items_default(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Default WIQL query retrieves active/new Bugs, Tasks, and User Stories."""
        ids = await ado_client.query_work_items(assigned_to_me=False)
        assert 101 in ids
        assert 102 in ids
        assert 103 in ids
        assert 104 in ids
        assert 105 not in ids  # Closed item excluded
        await ado_client.close()

    @pytest.mark.asyncio
    async def test_query_work_items_filter_by_type(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Query restricted to Bug type only returns bug IDs."""
        ids = await ado_client.query_work_items(
            work_item_types=["Bug"],
            assigned_to_me=False,
        )
        assert 101 in ids
        assert 104 in ids
        assert 102 not in ids  # Task excluded
        assert 103 not in ids  # User Story excluded
        await ado_client.close()

    @pytest.mark.asyncio
    async def test_query_work_items_custom_wiql(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Custom WIQL query is evaluated properly by mock transport."""
        custom_query = (
            "SELECT [System.Id] FROM WorkItems "
            "WHERE [System.WorkItemType] = 'User Story' "
            "AND [System.State] = 'New'"
        )
        ids = await ado_client.query_work_items(wiql=custom_query)
        assert ids == [103]
        await ado_client.close()

    @pytest.mark.asyncio
    async def test_query_work_items_syntax_error_400(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Malformed WIQL query triggers HTTP 400 and raises AzureDevOpsQueryError."""
        invalid_query = "INVALID_SYNTAX SELECT FROM"
        with pytest.raises(AzureDevOpsQueryError) as exc_info:
            await ado_client.query_work_items(wiql=invalid_query)

        assert exc_info.value.status_code == 400
        await ado_client.close()


# ============================================================================
# 4. Work Item Batch Retrieval Tests (F1.3)
# ============================================================================

class TestAzureDevOpsClientBatchRetrieval:
    """Tests for batch work item ingestion and chunking <= 200 items."""

    @pytest.mark.asyncio
    async def test_get_work_items_batch_success(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Batch fetch returns complete AzureDevOpsWorkItem objects with full fields."""
        items = await ado_client.get_work_items_batch([101, 102])
        assert len(items) == 2

        # Verify Item 101 (Bug)
        item101 = next(item for item in items if item.id == 101)
        assert item101.title == "Authentication crash on empty token"
        assert item101.work_item_type == "Bug"
        assert item101.state == "Active"
        assert item101.priority == 1
        assert "backend" in item101.tags
        assert "auth" in item101.tags
        assert "Steps to Reproduce" in item101.description

        # Verify Item 102 (Task)
        item102 = next(item for item in items if item.id == 102)
        assert item102.title == "Implement WIQL query builder"
        assert item102.work_item_type == "Task"
        assert item102.priority == 2

        await ado_client.close()

    @pytest.mark.asyncio
    async def test_get_work_items_batch_empty(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Passing empty ID list returns empty list immediately."""
        items = await ado_client.get_work_items_batch([])
        assert items == []
        await ado_client.close()

    @pytest.mark.asyncio
    async def test_get_work_items_batch_chunking(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
    ) -> None:
        """
        Requesting > 200 items automatically chunks requests into batches <= 200
        and aggregates all results.
        """
        # Create 220 work items in state
        ids_to_fetch = []
        for i in range(200, 420):
            mock_ado_state.add_work_item(
                {"System.Title": f"Batch item {i}", "System.WorkItemType": "Task"},
                item_id=i,
            )
            ids_to_fetch.append(i)

        items = await ado_client.get_work_items_batch(ids_to_fetch)
        assert len(items) == 220
        item_ids = {item.id for item in items}
        assert set(ids_to_fetch).issubset(item_ids)
        await ado_client.close()

    @pytest.mark.asyncio
    async def test_get_work_items_batch_repro_steps_fallback(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
    ) -> None:
        """Bug item with only ReproSteps correctly populates description."""
        wid = mock_ado_state.add_work_item({
            "System.Title": "Bug with only repro steps",
            "System.WorkItemType": "Bug",
            "System.Description": None,
            "Microsoft.VSTS.TCM.ReproSteps": "Direct repro steps text",
        })

        items = await ado_client.get_work_items_batch([wid])
        assert len(items) == 1
        assert items[0].description == "Direct repro steps text"
        await ado_client.close()


# ============================================================================
# 5. Single Work Item Retrieval Tests (F1.3)
# ============================================================================

class TestAzureDevOpsClientSingleRetrieval:
    """Tests for single work item fetching."""

    @pytest.mark.asyncio
    async def test_get_work_item_success(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Single work item fetch retrieves item by ID."""
        item = await ado_client.get_work_item(101)
        assert isinstance(item, AzureDevOpsWorkItem)
        assert item.id == 101
        assert item.title == "Authentication crash on empty token"
        await ado_client.close()

    @pytest.mark.asyncio
    async def test_get_work_item_not_found_404(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Non-existent work item raises AzureDevOpsNotFoundError with HTTP 404 and TF401232."""
        with pytest.raises(AzureDevOpsNotFoundError) as exc_info:
            await ado_client.get_work_item(99999)

        assert exc_info.value.status_code == 404
        assert exc_info.value.error_code == ERR_TF401232
        await ado_client.close()


# ============================================================================
# 6. Work Item State Patch & Comment Tests (F3.1, F3.2)
# ============================================================================

class TestAzureDevOpsClientUpdates:
    """Tests for JSON Patch state updates and comment posting."""

    @pytest.mark.asyncio
    async def test_update_work_item_state_resolved(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
    ) -> None:
        """Updating state to 'Resolved' applies JSON Patch and increments revision."""
        initial_item = mock_ado_state.get_work_item(101)
        assert initial_item["fields"]["System.State"] == "Active"
        assert initial_item["rev"] == 1

        updated = await ado_client.update_work_item_state(
            work_item_id=101,
            new_state="Resolved",
            comment="Resolved automatically by Auto Claude test runner",
        )

        assert updated.state == "Resolved"
        persisted = mock_ado_state.get_work_item(101)
        assert persisted["fields"]["System.State"] == "Resolved"
        assert persisted["rev"] == 2
        assert persisted["fields"]["System.History"] == "Resolved automatically by Auto Claude test runner"
        await ado_client.close()

    @pytest.mark.asyncio
    async def test_update_work_item_state_not_found_404(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Patching state on non-existent work item raises AzureDevOpsNotFoundError."""
        with pytest.raises(AzureDevOpsNotFoundError) as exc_info:
            await ado_client.update_work_item_state(
                work_item_id=99999,
                new_state="Resolved",
            )
        assert exc_info.value.status_code == 404
        assert exc_info.value.error_code == ERR_TF401232
        await ado_client.close()

    @pytest.mark.asyncio
    async def test_add_work_item_comment(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
    ) -> None:
        """Adding a comment posts to Azure DevOps comments API and records entry."""
        comment_body = "### Auto Claude Execution Summary\n- All unit tests passed (exit code 0)."
        response_data = await ado_client.add_work_item_comment(
            work_item_id=101,
            comment_text=comment_body,
        )

        assert response_data["text"] == comment_body
        assert response_data["workItemId"] == 101

        comments = mock_ado_state.get_comments(101)
        assert len(comments) == 1
        assert comments[0]["text"] == comment_body
        await ado_client.close()

    @pytest.mark.asyncio
    async def test_add_work_item_comment_not_found_404(
        self, ado_client: AzureDevOpsClient
    ) -> None:
        """Posting a comment on non-existent item raises AzureDevOpsNotFoundError."""
        with pytest.raises(AzureDevOpsNotFoundError) as exc_info:
            await ado_client.add_work_item_comment(
                work_item_id=99999,
                comment_text="Test comment",
            )
        assert exc_info.value.status_code == 404
        assert exc_info.value.error_code == ERR_TF401232
        await ado_client.close()


# ============================================================================
# 7. Model Serialization & Parsing Tests
# ============================================================================

class TestAzureDevOpsModels:
    """Tests for AzureDevOpsWorkItem and TicketExecutionResult serialization."""

    def test_work_item_model_parsing_and_dict(self) -> None:
        """Work item correctly parses API dictionary and serializes to dict."""
        raw_api_data = {
            "id": 555,
            "url": "https://dev.azure.com/my-org/my-proj/_apis/wit/workitems/555",
            "fields": {
                "System.Id": 555,
                "System.Title": "Model test title",
                "System.Description": "Main description text",
                "Microsoft.VSTS.TCM.ReproSteps": "Repro steps text",
                "System.State": "Active",
                "System.WorkItemType": "Bug",
                "Microsoft.VSTS.Common.Priority": "2",
                "System.Tags": "tag1; tag2; tag3",
            },
        }

        wi = AzureDevOpsWorkItem.from_api_response(raw_api_data)
        assert wi.id == 555
        assert wi.title == "Model test title"
        assert "Main description text" in wi.description
        assert "Repro steps text" in wi.description
        assert wi.state == "Active"
        assert wi.work_item_type == "Bug"
        assert wi.priority == 2
        assert wi.tags == ["tag1", "tag2", "tag3"]

        d = wi.to_dict()
        assert d["id"] == 555
        assert d["priority"] == 2
        assert d["tags"] == ["tag1", "tag2", "tag3"]

    def test_ticket_execution_result_serialization(self) -> None:
        """TicketExecutionResult serializes and deserializes cleanly."""
        res = TicketExecutionResult(
            work_item_id=101,
            success=True,
            spec_id="spec-001",
            final_state="Resolved",
            error_message=None,
            test_results={"passed": 12, "failed": 0},
            diff_summary="+ 15 lines",
        )
        data = res.to_dict()
        assert data["work_item_id"] == 101
        assert data["success"] is True

        reconstructed = TicketExecutionResult.from_dict(data)
        assert reconstructed.work_item_id == 101
        assert reconstructed.success is True
        assert reconstructed.test_results == {"passed": 12, "failed": 0}
