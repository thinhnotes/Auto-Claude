"""
Adversarial & Boundary Stress-Testing for Azure DevOps Integration (Milestone 1)
==============================================================================

Stress tests covering:
  1. Weird and malformed URLs (missing schemes, ports, encoded characters, trailing slashes)
  2. PAT edge cases (empty, whitespace, unicode, newlines, expired 401, nonexistent org/project 404)
  3. WIQL queries (empty results, syntax errors, quotes/special chars in project name, missing fields)
  4. Batch retrieval boundary conditions (exactly 0, 1, 200, 201, 450 IDs)
  5. AzureDevOpsProvider protocol integration with live AzureDevOpsClient and MockAzureDevOpsTransport
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path
from typing import List
from unittest.mock import MagicMock

import httpx
import pytest

_repo_root = Path(__file__).resolve().parents[3]
_backend_dir = _repo_root / "apps" / "backend"
_github_dir = _backend_dir / "runners" / "github"

if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))
if str(_github_dir) not in sys.path:
    sys.path.insert(0, str(_github_dir))

from apps.backend.integrations.azure_devops.client import (
    AzureDevOpsAuthError,
    AzureDevOpsClient,
    AzureDevOpsError,
    AzureDevOpsNotFoundError,
    AzureDevOpsQueryError,
)
from apps.backend.integrations.azure_devops.config import (
    AzureDevOpsConfig,
    normalize_azure_devops_url,
)
from apps.backend.integrations.azure_devops.models import AzureDevOpsWorkItem
from providers import (
    AzureDevOpsProvider,
    IssueFilters,
    ProviderType,
)
from tests.integrations.azure_devops.mock_transport import (
    MockAzureDevOpsState,
    MockAzureDevOpsTransport,
    ado_client,
    ado_config,
    mock_ado_state,
    mock_ado_transport,
)


# ============================================================================
# 1. URL Normalization & Malformed URLs
# ============================================================================

class TestURLNormalizationAdversarial:
    """Stress-test URL parsing and normalization with edge-case and malformed inputs."""

    def test_url_empty_and_whitespace(self):
        assert normalize_azure_devops_url("") == ("", None)
        assert normalize_azure_devops_url("   ") == ("", None)
        assert normalize_azure_devops_url("\t\n") == ("", None)

    def test_url_plain_organization(self):
        org, proj = normalize_azure_devops_url("my-org")
        assert org == "https://dev.azure.com/my-org"
        assert proj is None

    def test_url_plain_org_and_project(self):
        org, proj = normalize_azure_devops_url("my-org/my-project")
        assert org == "https://dev.azure.com/my-org"
        assert proj == "my-project"

    def test_url_missing_scheme_with_domain(self):
        """Domain without scheme: e.g. dev.azure.com/my-org or my-org.visualstudio.com."""
        org, proj = normalize_azure_devops_url("dev.azure.com/my-org")
        # Documents current behavior: dev.azure.com is treated as org name
        assert org == "https://dev.azure.com/dev.azure.com"
        assert proj == "my-org"

        org_vs, proj_vs = normalize_azure_devops_url("my-org.visualstudio.com")
        assert org_vs == "https://dev.azure.com/my-org.visualstudio.com"

    def test_url_multiple_trailing_slashes(self):
        org, proj = normalize_azure_devops_url("https://dev.azure.com/my-org////")
        assert org == "https://dev.azure.com/my-org"
        assert proj is None

        org2, proj2 = normalize_azure_devops_url("https://dev.azure.com/my-org/my-proj////")
        assert org2 == "https://dev.azure.com/my-org"
        assert proj2 == "my-proj"

    def test_url_leading_trailing_whitespace(self):
        org, proj = normalize_azure_devops_url("  https://dev.azure.com/my-org/my-proj  \n")
        assert org == "https://dev.azure.com/my-org"
        assert proj == "my-proj"

    def test_url_with_port(self):
        """Azure DevOps with port (e.g. dev.azure.com:443 or local TFS/Azure DevOps Server :8080)."""
        org, proj = normalize_azure_devops_url("https://dev.azure.com:443/my-org")
        # Hits fallback cleaned URL
        assert org == "https://dev.azure.com:443/my-org"

        org_tfs, proj_tfs = normalize_azure_devops_url("http://tfs.corp.local:8080/tfs/DefaultCollection")
        assert org_tfs == "http://tfs.corp.local:8080/tfs/DefaultCollection"

    def test_url_encoded_characters(self):
        """URL with URL-encoded space or special characters."""
        org, proj = normalize_azure_devops_url("https://dev.azure.com/my%20org/my%20project")
        assert org == "https://dev.azure.com/my%20org"
        assert proj == "my%20project"

    def test_url_visualstudio_variations(self):
        org, proj = normalize_azure_devops_url("https://my-org.visualstudio.com/")
        assert org == "https://my-org.visualstudio.com"
        assert proj is None

        org2, proj2 = normalize_azure_devops_url("http://my-org.visualstudio.com/my-proj///")
        assert org2 == "https://my-org.visualstudio.com"
        assert proj2 == "my-proj"

    def test_config_project_base_url_generation(self):
        cfg = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org/",
            project="/my-project/",
            personal_access_token="tok",
        )
        assert cfg.organization_url == "https://dev.azure.com/my-org"
        assert cfg.project_base_url == "https://dev.azure.com/my-org/my-project/_apis"
        assert cfg.org_base_url == "https://dev.azure.com/my-org/_apis"


# ============================================================================
# 2. Authentication & PAT Edge Cases
# ============================================================================

class TestAuthenticationAdversarial:
    """Stress-test authentication, empty/whitespace/unicode tokens, and HTTP status codes."""

    @pytest.mark.asyncio
    async def test_auth_empty_pat(self, mock_ado_transport):
        cfg = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="my-project",
            personal_access_token="",
        )
        assert cfg.is_valid() is False
        client = AzureDevOpsClient(config=cfg, transport=mock_ado_transport)
        with pytest.raises(AzureDevOpsAuthError) as exc_info:
            await client.validate_connection()
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_auth_whitespace_pat(self, mock_ado_transport):
        cfg = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="my-project",
            personal_access_token="   ",
        )
        # Whitespace token is non-empty string, but invalid on server
        client = AzureDevOpsClient(config=cfg, transport=mock_ado_transport)
        with pytest.raises(AzureDevOpsAuthError) as exc_info:
            await client.validate_connection()
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_auth_unicode_pat_encoding(self, mock_ado_transport):
        """Unicode characters in PAT should encode to valid Base64 without crashing."""
        cfg = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="my-project",
            personal_access_token="🔑_unicode_pat_日本語_✓",
        )
        client = AzureDevOpsClient(config=cfg, transport=mock_ado_transport)
        # Should have valid Basic header
        header = client._headers["Authorization"]
        assert header.startswith("Basic ")
        decoded = base64.b64decode(header.split(" ")[1]).decode("utf-8")
        assert decoded == ":🔑_unicode_pat_日本語_✓"

        # Server rejects invalid PAT with 401
        with pytest.raises(AzureDevOpsAuthError) as exc_info:
            await client.validate_connection()
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_auth_newlines_in_pat(self, mock_ado_transport):
        """Newlines in PAT string should be safely base64-encoded into HTTP header."""
        cfg = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="my-project",
            personal_access_token="pat_line1\npat_line2",
        )
        client = AzureDevOpsClient(config=cfg, transport=mock_ado_transport)
        header = client._headers["Authorization"]
        decoded = base64.b64decode(header.split(" ")[1]).decode("utf-8")
        assert decoded == ":pat_line1\npat_line2"

    @pytest.mark.asyncio
    async def test_auth_expired_pat_401(self, mock_ado_transport):
        cfg = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="my-project",
            personal_access_token="expired_token_abc",
        )
        client = AzureDevOpsClient(config=cfg, transport=mock_ado_transport)
        with pytest.raises(AzureDevOpsAuthError) as exc_info:
            await client.validate_connection()
        assert exc_info.value.status_code == 401
        assert exc_info.value.error_code == "TF400813"

    @pytest.mark.asyncio
    async def test_auth_invalid_project_404(self, mock_ado_transport):
        cfg = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="definitely-nonexistent-project-xyz",
            personal_access_token="valid_test_pat",
        )
        client = AzureDevOpsClient(config=cfg, transport=mock_ado_transport)
        with pytest.raises(AzureDevOpsNotFoundError) as exc_info:
            await client.validate_connection()
        assert exc_info.value.status_code == 404
        assert exc_info.value.error_code == "TF200016"

    @pytest.mark.asyncio
    async def test_auth_invalid_org_404(self, mock_ado_transport):
        cfg = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/definitely-nonexistent-org-xyz",
            project="my-project",
            personal_access_token="valid_test_pat",
        )
        client = AzureDevOpsClient(config=cfg, transport=mock_ado_transport)
        with pytest.raises(AzureDevOpsNotFoundError) as exc_info:
            await client.validate_connection()
        assert exc_info.value.status_code == 404
        assert exc_info.value.error_code == "TF200016"

    @pytest.mark.asyncio
    async def test_auth_html_sign_in_page_detection(self):
        """Simulate custom server returning HTML sign-in redirect with 200 OK."""
        def html_transport(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                headers={"Content-Type": "text/html"},
                text="<html><head><title>Sign In</title></head><body>Please login with Microsoft Account</body></html>",
            )

        cfg = AzureDevOpsConfig(
            organization_url="https://dev.azure.com/my-org",
            project="my-project",
            personal_access_token="bad_pat",
        )
        client = AzureDevOpsClient(config=cfg, transport=httpx.MockTransport(html_transport))
        with pytest.raises(AzureDevOpsAuthError) as exc_info:
            await client.validate_connection()
        assert exc_info.value.error_code == "HTML_REDIRECT"


# ============================================================================
# 3. WIQL Queries & Unexpected Characters
# ============================================================================

class TestWIQLAdversarial:
    """Stress-test WIQL queries, empty results, unexpected characters, and missing fields."""

    @pytest.mark.asyncio
    async def test_wiql_empty_result(self, ado_client, mock_ado_state):
        # Query for non-existent work item type
        ids = await ado_client.query_work_items(work_item_types=["Epic", "Feature"])
        assert ids == []
        assert isinstance(ids, list)

    @pytest.mark.asyncio
    async def test_wiql_custom_query_syntax_error(self, ado_client):
        # WIQL not starting with SELECT or containing syntax error
        with pytest.raises(AzureDevOpsQueryError) as exc_info:
            await ado_client.query_work_items(wiql="INVALID_SYNTAX SELECT FROM WHERE")
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_wiql_quotes_in_custom_query(self, ado_client, mock_ado_state):
        # WIQL with quotes and type/state conditions
        custom_wiql = (
            "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'my-project' "
            "AND [System.WorkItemType] = 'Bug' AND [System.State] = 'Active'"
        )
        ids = await ado_client.query_work_items(wiql=custom_wiql)
        assert ids == [101]

    @pytest.mark.asyncio
    async def test_work_item_missing_optional_fields(self):
        """Work items in Azure DevOps often lack Description, ReproSteps, or Priority."""
        minimal_payload = {
            "id": 999,
            "rev": 1,
            "url": "https://dev.azure.com/my-org/my-proj/_apis/wit/workitems/999",
            "fields": {
                "System.Id": 999,
                "System.Title": "Bare minimum work item",
                "System.State": "New",
                "System.WorkItemType": "Task",
                # System.Description omitted
                # ReproSteps omitted
                # Microsoft.VSTS.Common.Priority omitted
                # System.Tags omitted
            },
        }

        wi = AzureDevOpsWorkItem.from_api_response(minimal_payload)
        assert wi.id == 999
        assert wi.title == "Bare minimum work item"
        assert wi.description == ""
        assert wi.state == "New"
        assert wi.work_item_type == "Task"
        assert wi.priority == 3  # Default fallback priority
        assert wi.tags == []
        assert wi.url == "https://dev.azure.com/my-org/my-proj/_apis/wit/workitems/999"


# ============================================================================
# 4. Batch Retrieval Boundaries (0, 1, 200, 201, 450 items)
# ============================================================================

class TestBatchRetrievalBoundaries:
    """Stress-test batch retrieval with boundaries: 0, 1, 200, 201, 450 items."""

    @pytest.mark.asyncio
    async def test_batch_0_ids(self, ado_client):
        """Exactly 0 items: must return [] immediately without network calls."""
        res = await ado_client.get_work_items_batch([])
        assert res == []

    @pytest.mark.asyncio
    async def test_batch_1_id(self, ado_client, mock_ado_state):
        """Exactly 1 item."""
        res = await ado_client.get_work_items_batch([101])
        assert len(res) == 1
        assert res[0].id == 101
        assert res[0].title == "Authentication crash on empty token"

    @pytest.mark.asyncio
    async def test_batch_200_ids(self, ado_client, mock_ado_state, mock_ado_transport):
        """Exactly 200 items (Azure DevOps single batch limit)."""
        # Seed 200 work items (IDs 1000..1199)
        request_count = 0
        original_handle = mock_ado_transport.handle_request

        def spy_handle(request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            if "wit/workitemsbatch" in str(request.url):
                request_count += 1
            return original_handle(request)

        mock_ado_transport.handler = spy_handle

        ids = []
        for i in range(1000, 1200):
            mock_ado_state.add_work_item(
                {"System.Title": f"Batch item {i}", "System.WorkItemType": "Task"},
                item_id=i,
            )
            ids.append(i)

        res = await ado_client.get_work_items_batch(ids)
        assert len(res) == 200
        # Exactly 1 batch request sent
        assert request_count == 1

    @pytest.mark.asyncio
    async def test_batch_201_ids(self, ado_client, mock_ado_state, mock_ado_transport):
        """Exactly 201 items (boundary + 1): must split into [200, 1] requests."""
        batch_sizes: List[int] = []
        original_handle = mock_ado_transport.handle_request

        def spy_handle(request: httpx.Request) -> httpx.Response:
            if "wit/workitemsbatch" in str(request.url):
                import json
                body = json.loads(request.content.decode("utf-8"))
                batch_sizes.append(len(body.get("ids", [])))
            return original_handle(request)

        mock_ado_transport.handler = spy_handle

        ids = []
        for i in range(2000, 2201):
            mock_ado_state.add_work_item(
                {"System.Title": f"Batch item {i}", "System.WorkItemType": "Bug"},
                item_id=i,
            )
            ids.append(i)

        assert len(ids) == 201
        res = await ado_client.get_work_items_batch(ids)
        assert len(res) == 201
        # Verifies chunking into exactly 2 requests of sizes 200 and 1
        assert batch_sizes == [200, 1]

    @pytest.mark.asyncio
    async def test_batch_450_ids(self, ado_client, mock_ado_state, mock_ado_transport):
        """Exactly 450 items: must split into [200, 200, 50] requests."""
        batch_sizes: List[int] = []
        original_handle = mock_ado_transport.handle_request

        def spy_handle(request: httpx.Request) -> httpx.Response:
            if "wit/workitemsbatch" in str(request.url):
                import json
                body = json.loads(request.content.decode("utf-8"))
                batch_sizes.append(len(body.get("ids", [])))
            return original_handle(request)

        mock_ado_transport.handler = spy_handle

        ids = []
        for i in range(3000, 3450):
            mock_ado_state.add_work_item(
                {"System.Title": f"Batch item {i}", "System.WorkItemType": "User Story"},
                item_id=i,
            )
            ids.append(i)

        assert len(ids) == 450
        res = await ado_client.get_work_items_batch(ids)
        assert len(res) == 450
        # Verifies chunking into exactly 3 requests of sizes 200, 200, and 50
        assert batch_sizes == [200, 200, 50]

    @pytest.mark.asyncio
    async def test_batch_with_nonexistent_and_duplicate_ids(self, ado_client, mock_ado_state):
        """Batch containing non-existent and duplicate IDs."""
        # IDs 101, 102 exist; 99999 does not exist
        res = await ado_client.get_work_items_batch([101, 99999, 102, 101])
        retrieved_ids = [item.id for item in res]
        # In Azure DevOps, non-existent IDs are omitted; duplicates are returned per occurrence
        assert 101 in retrieved_ids
        assert 102 in retrieved_ids
        assert 99999 not in retrieved_ids


# ============================================================================
# 5. AzureDevOpsProvider Integration Stress
# ============================================================================

class TestAzureDevOpsProviderAdversarial:
    """Stress-test AzureDevOpsProvider with live AzureDevOpsClient and MockAzureDevOpsTransport."""

    @pytest.mark.asyncio
    async def test_provider_full_workflow_with_mock_transport(self, ado_config, mock_ado_transport, mock_ado_state):
        """Run full provider workflow using real AzureDevOpsClient backed by mock transport."""
        client = AzureDevOpsClient(config=ado_config, transport=mock_ado_transport)
        provider = AzureDevOpsProvider(_repo="my-org/my-project", _client=client)

        assert provider.provider_type == ProviderType.AZURE_DEVOPS
        assert provider.repo == "my-org/my-project"

        # 1. Fetch single issue
        issue = await provider.fetch_issue(101)
        assert issue.number == 101
        assert issue.title == "Authentication crash on empty token"
        assert issue.state == "open"
        assert "Bug" in issue.labels
        assert issue.assignees == ["auto-claude@bot.local"]

        # 2. Add comment
        comment_id = await provider.add_comment(101, "Investigating crash...")
        assert comment_id > 0
        comments = mock_ado_state.get_comments(101)
        assert any(c["text"] == "Investigating crash..." for c in comments)

        # 3. Close issue
        closed = await provider.close_issue(101, comment="Fixed in commit 123")
        assert closed is True
        item = mock_ado_state.get_work_item(101)
        assert item["fields"]["System.State"] == "Closed"

        # 4. Fetch issues with filter
        open_issues = await provider.fetch_issues(IssueFilters(state="open"))
        assert all(i.state == "open" for i in open_issues)
        assert not any(i.number == 101 for i in open_issues)  # 101 is closed now

    @pytest.mark.asyncio
    async def test_provider_nonexistent_issue_raises(self, ado_config, mock_ado_transport):
        client = AzureDevOpsClient(config=ado_config, transport=mock_ado_transport)
        provider = AzureDevOpsProvider(_repo="my-org/my-project", _client=client)

        with pytest.raises(AzureDevOpsNotFoundError):
            await provider.fetch_issue(999999)
