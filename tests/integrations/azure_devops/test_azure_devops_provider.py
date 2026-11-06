"""
Tests for AzureDevOpsProvider & Factory Integration
===================================================

Verifies protocol compliance with GitProvider, factory registration,
and bidirectional mapping of AzureDevOpsWorkItem to IssueData.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

# Ensure repository root, backend directory, and runners/github directory are in sys.path
_repo_root = Path(__file__).resolve().parents[3]
_backend_dir = _repo_root / "apps" / "backend"
_github_dir = _backend_dir / "runners" / "github"

if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))
if str(_github_dir) not in sys.path:
    sys.path.insert(0, str(_github_dir))

from providers import (
    AzureDevOpsProvider,
    GitHubProvider,
    GitProvider,
    IssueFilters,
    ProviderType,
    get_provider,
    is_provider_available,
    list_available_providers,
)

try:
    from apps.backend.integrations.azure_devops.models import AzureDevOpsWorkItem
except ImportError:
    from integrations.azure_devops.models import AzureDevOpsWorkItem


@pytest.fixture
def mock_client():
    client = MagicMock()
    client.get_work_item = AsyncMock()
    client.query_work_items = AsyncMock()
    client.get_work_items_batch = AsyncMock()
    client.update_work_item_state = AsyncMock()
    client.add_work_item_comment = AsyncMock()
    client.api_get = AsyncMock()
    client.api_post = AsyncMock()
    return client


def test_protocol_compliance():
    provider = AzureDevOpsProvider(_repo="my-org/my-proj")
    assert isinstance(provider, GitProvider)
    assert provider.provider_type == ProviderType.AZURE_DEVOPS
    assert provider.repo == "my-org/my-proj"


def test_factory_get_provider(mock_client):
    provider = get_provider("azure_devops", "my-org/my-proj", _client=mock_client)
    assert isinstance(provider, AzureDevOpsProvider)
    assert provider.provider_type == ProviderType.AZURE_DEVOPS
    assert is_provider_available("azure_devops") is True
    assert ProviderType.AZURE_DEVOPS in list_available_providers()


@pytest.mark.asyncio
async def test_fetch_issue_mapping(mock_client):
    mock_item = AzureDevOpsWorkItem(
        id=1042,
        title="Fix authentication redirect bug",
        description="User is redirected to 404 after login",
        state="Active",
        work_item_type="Bug",
        priority=1,
        url="https://dev.azure.com/my-org/my-proj/_workitems/edit/1042",
        tags=["auth", "security"],
        raw_fields={
            "System.Id": 1042,
            "System.Title": "Fix authentication redirect bug",
            "System.Description": "User is redirected to 404 after login",
            "System.State": "Active",
            "System.WorkItemType": "Bug",
            "System.CreatedBy": {"displayName": "Alice Admin", "uniqueName": "alice@org.com"},
            "System.AssignedTo": {"displayName": "Bob Dev", "uniqueName": "bob@org.com"},
            "System.CreatedDate": "2026-11-01T00:00:00Z",
            "System.ChangedDate": "2026-11-01T01:00:00Z",
            "System.IterationPath": "MyProject\\Sprint 1",
        },
    )
    mock_client.get_work_item.return_value = mock_item

    provider = AzureDevOpsProvider(_repo="my-org/my-proj", _client=mock_client)
    issue = await provider.fetch_issue(1042)

    assert issue.number == 1042
    assert issue.title == "Fix authentication redirect bug"
    assert issue.body == "User is redirected to 404 after login"
    assert issue.author == "alice@org.com"
    assert issue.state == "open"  # normalized
    assert "Bug" in issue.labels
    assert "auth" in issue.labels
    assert issue.assignees == ["bob@org.com"]
    assert issue.milestone == "MyProject\\Sprint 1"
    assert issue.provider == ProviderType.AZURE_DEVOPS


@pytest.mark.asyncio
async def test_fetch_issues_filtering(mock_client):
    mock_item1 = AzureDevOpsWorkItem(
        id=101,
        title="Bug 1",
        description="Desc 1",
        state="Active",
        work_item_type="Bug",
        priority=1,
        url="http://item/101",
        tags=["frontend"],
        raw_fields={"System.CreatedBy": "dev1@org.com", "System.State": "Active", "System.WorkItemType": "Bug"},
    )
    mock_item2 = AzureDevOpsWorkItem(
        id=102,
        title="Task 2",
        description="Desc 2",
        state="Closed",
        work_item_type="Task",
        priority=2,
        url="http://item/102",
        tags=["backend"],
        raw_fields={"System.CreatedBy": "dev2@org.com", "System.State": "Closed", "System.WorkItemType": "Task"},
    )
    mock_client.query_work_items.return_value = [101, 102]
    mock_client.get_work_items_batch.return_value = [mock_item1, mock_item2]

    provider = AzureDevOpsProvider(_repo="my-org/my-proj", _client=mock_client)
    issues_open = await provider.fetch_issues(IssueFilters(state="open"))
    assert len(issues_open) == 1
    assert issues_open[0].number == 101


@pytest.mark.asyncio
async def test_close_issue(mock_client):
    mock_client.update_work_item_state.return_value = MagicMock()
    mock_client.add_work_item_comment.return_value = {"id": 99}

    provider = AzureDevOpsProvider(_repo="my-org/my-proj", _client=mock_client)
    success = await provider.close_issue(1042, comment="Resolved by bot")

    assert success is True
    mock_client.add_work_item_comment.assert_called_once_with(1042, "Resolved by bot")
    mock_client.update_work_item_state.assert_called_once_with(1042, "Closed")


def test_reset_client_and_update_config(mock_client):
    provider = AzureDevOpsProvider(_repo="my-org/my-proj", _client=mock_client)
    assert provider.client is mock_client

    provider.update_config(
        organization_url="https://dev.azure.com/updated-org",
        project="updated-proj",
        personal_access_token="updated-pat",
    )
    assert provider.organization_url == "https://dev.azure.com/updated-org"
    assert provider.project == "updated-proj"
    assert provider.personal_access_token == "updated-pat"
    assert provider._client is None


@pytest.mark.asyncio
async def test_validate_and_test_connection(mock_client):
    mock_client.validate_connection = AsyncMock(
        return_value={"valid": True, "project_name": "my-proj"}
    )
    provider = AzureDevOpsProvider(_repo="my-org/my-proj", _client=mock_client)

    result_val = await provider.validate_connection()
    assert result_val["valid"] is True
    assert result_val["project_name"] == "my-proj"

    result_test = await provider.test_connection()
    assert result_test["valid"] is True
    assert result_test["project_name"] == "my-proj"
    assert mock_client.validate_connection.call_count == 2


@pytest.mark.asyncio
async def test_fetch_issues_refresh_resets_client(mock_client):
    mock_client.reset = MagicMock()
    mock_client.query_work_items.return_value = []
    provider = AzureDevOpsProvider(_repo="my-org/my-proj", _client=mock_client)

    # Call with refresh=True
    await provider.fetch_issues(refresh=True)
    # Verifies reset was invoked on the client
    assert mock_client.reset.called
    assert mock_client.query_work_items.called


def test_reset_client_clears_config_and_reinitializes():
    provider = AzureDevOpsProvider(
        organization_url="https://dev.azure.com/initial-org",
        project="initial-proj",
        personal_access_token="initial-token",
    )
    assert provider._config is not None
    assert provider._config.organization_url == "https://dev.azure.com/initial-org"

    # Reset client
    provider.reset_client()
    assert provider._client is None
    assert provider._config is None

    # Change token attribute and access client again
    provider.personal_access_token = "new-fresh-token"
    c2 = provider.client
    assert provider._config.personal_access_token == "new-fresh-token"


def test_project_dir_loads_state_file(tmp_path):
    state_dir = tmp_path / ".auto-claude" / "azure-devops"
    state_dir.mkdir(parents=True)
    state_file = state_dir / "state.json"
    state_file.write_text(
        '{"config": {"organizationUrl": "https://dev.azure.com/from-file", "project": "file-proj", "personalAccessToken": "file-pat-123"}}'
    )

    provider = AzureDevOpsProvider(_project_dir=str(tmp_path))
    client = provider.client
    assert provider._config.organization_url == "https://dev.azure.com/from-file"
    assert provider._config.project == "file-proj"
    assert provider._config.personal_access_token == "file-pat-123"


def test_project_dir_loads_missing_project_from_state_file(tmp_path):
    """When token and org_url are provided but project is missing, load project from state.json."""
    state_dir = tmp_path / ".auto-claude" / "azure-devops"
    state_dir.mkdir(parents=True)
    state_file = state_dir / "state.json"
    state_file.write_text(
        '{"config": {"organizationUrl": "https://dev.azure.com/fallback-org", "project": "state-json-project", "personalAccessToken": "state-json-pat"}}'
    )

    provider = AzureDevOpsProvider(
        organization_url="https://dev.azure.com/explicit-org",
        personal_access_token="explicit-pat",
        _project_dir=str(tmp_path),
    )
    client = provider.client
    assert provider._config.organization_url == "https://dev.azure.com/explicit-org"
    assert provider._config.personal_access_token == "explicit-pat"
    assert provider._config.project == "state-json-project"



