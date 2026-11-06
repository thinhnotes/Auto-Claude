"""
Unit Tests for Azure DevOps Two-Way Status & Feedback Updater
=============================================================

Tier 1 & 3 tests validating state updates via RFC 6902 JSON Patch,
execution summary comment formatting & posting, and lifecycle event hooks.
Runs 100% offline using MockAzureDevOpsTransport.
"""

from __future__ import annotations

import pytest

from apps.backend.integrations.azure_devops.client import AzureDevOpsClient
from apps.backend.integrations.azure_devops.config import AzureDevOpsConfig
from apps.backend.integrations.azure_devops.models import (
    AzureDevOpsWorkItem,
    TicketExecutionResult,
)
from apps.backend.integrations.azure_devops.updater import AzureDevOpsUpdater
from .mock_transport import (
    MockAzureDevOpsState,
    MockAzureDevOpsTransport,
    ado_client,
    ado_config,
    mock_ado_state,
    mock_ado_transport,
)


class TestAzureDevOpsUpdaterStateUpdates:
    """Tests for work item state updates via updater."""

    @pytest.mark.asyncio
    async def test_update_state_active_to_resolved(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
    ) -> None:
        updater = AzureDevOpsUpdater(client=ado_client)

        # Work item 101 starts as 'Active'
        assert mock_ado_state.work_items[101]["fields"]["System.State"] == "Active"

        updated = await updater.update_state(
            work_item_id=101,
            new_state="Resolved",
            comment="Automated test suite passed 100%.",
        )

        assert updated.state == "Resolved"
        assert mock_ado_state.work_items[101]["fields"]["System.State"] == "Resolved"

    @pytest.mark.asyncio
    async def test_update_state_to_done(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
    ) -> None:
        updater = AzureDevOpsUpdater(client=ado_client)

        updated = await updater.update_state(
            work_item_id=102,
            new_state="Done",
        )

        assert updated.state == "Done"
        assert mock_ado_state.work_items[102]["fields"]["System.State"] == "Done"


class TestAzureDevOpsUpdaterExecutionSummary:
    """Tests for execution summary comment formatting and posting."""

    @pytest.fixture
    def success_result(self) -> TicketExecutionResult:
        return TicketExecutionResult(
            work_item_id=101,
            success=True,
            spec_id="001-fix-auth",
            final_state="Resolved",
            test_results={
                "total": 12,
                "passed": 12,
                "failed": 0,
                "skipped": 0,
                "duration": 0.35,
            },
            diff_summary="+ 45 lines, - 2 lines across 2 files",
            error_message=None,
        )

    @pytest.fixture
    def failure_result(self) -> TicketExecutionResult:
        return TicketExecutionResult(
            work_item_id=102,
            success=False,
            spec_id="002-wiql-builder",
            final_state="Failed",
            test_results={
                "total": 5,
                "passed": 3,
                "failed": 2,
                "skipped": 0,
                "duration": 1.20,
            },
            diff_summary="+ 10 lines in query.py",
            error_message="AssertionError: Expected query to contain ORDER BY clause",
        )

    def test_format_execution_summary_success(
        self,
        ado_client: AzureDevOpsClient,
        success_result: TicketExecutionResult,
    ) -> None:
        updater = AzureDevOpsUpdater(client=ado_client)
        comment_md = updater.format_execution_summary(success_result)

        assert "## 🤖 Auto Claude Execution Summary" in comment_md
        assert "SUCCESS" in comment_md
        assert "`#101`" in comment_md
        assert "`001-fix-auth`" in comment_md
        assert "- **Total Tests**: 12" in comment_md
        assert "- **Passed**: 12" in comment_md
        assert "- **Failed**: 0" in comment_md
        assert "- **Pass Rate**: 100.0%" in comment_md
        assert "+ 45 lines, - 2 lines" in comment_md

    def test_format_execution_summary_failure(
        self,
        ado_client: AzureDevOpsClient,
        failure_result: TicketExecutionResult,
    ) -> None:
        updater = AzureDevOpsUpdater(client=ado_client)
        comment_md = updater.format_execution_summary(failure_result)

        assert "## 🤖 Auto Claude Execution Summary" in comment_md
        assert "FAILED" in comment_md
        assert "### ❌ Failure Details" in comment_md
        assert "AssertionError: Expected query to contain ORDER BY clause" in comment_md
        assert "- **Failed**: 2" in comment_md

    @pytest.mark.asyncio
    async def test_post_execution_summary_posts_to_api(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
        success_result: TicketExecutionResult,
    ) -> None:
        updater = AzureDevOpsUpdater(client=ado_client)

        resp = await updater.post_execution_summary(
            work_item_id=101,
            result=success_result,
        )

        assert resp is not None
        assert 101 in mock_ado_state.comments
        comments = mock_ado_state.comments[101]
        assert len(comments) == 1
        posted_text = comments[0]["text"]
        assert "Auto Claude Execution Summary" in posted_text
        assert "001-fix-auth" in posted_text


class TestAzureDevOpsUpdaterLifecycleHooks:
    """Tests for coder and QA lifecycle hooks."""

    @pytest.mark.asyncio
    async def test_task_started_hook(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
    ) -> None:
        updater = AzureDevOpsUpdater(client=ado_client)

        updated = await updater.task_started(work_item_id=103, spec_id="003-sync")

        assert updated.state == "Active"
        assert mock_ado_state.work_items[103]["fields"]["System.State"] == "Active"
        history = mock_ado_state.work_items[103]["fields"].get("System.History", "")
        assert "Auto Claude Execution Started" in history
        assert "003-sync" in history

    @pytest.mark.asyncio
    async def test_task_stuck_hook(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
    ) -> None:
        updater = AzureDevOpsUpdater(client=ado_client)

        updated = await updater.task_stuck(
            work_item_id=101,
            reason="Missing Azure DevOps organization permissions for work item update.",
        )

        assert updated.state == "Active"
        history = mock_ado_state.work_items[101]["fields"].get("System.History", "")
        assert "Auto Claude Execution Blocked" in history
        assert "Missing Azure DevOps organization permissions" in history

    @pytest.mark.asyncio
    async def test_qa_approved_hook(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
    ) -> None:
        updater = AzureDevOpsUpdater(client=ado_client)

        updated = await updater.qa_approved(
            work_item_id=101,
            summary="All 15 regression and edge case tests passed successfully.",
        )

        assert updated.state == "Resolved"
        assert mock_ado_state.work_items[101]["fields"]["System.State"] == "Resolved"
        history = mock_ado_state.work_items[101]["fields"].get("System.History", "")
        assert "Auto Claude QA Approved" in history
        assert "All 15 regression and edge case tests" in history

    @pytest.mark.asyncio
    async def test_qa_rejected_hook(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
    ) -> None:
        updater = AzureDevOpsUpdater(client=ado_client)

        updated = await updater.qa_rejected(
            work_item_id=101,
            reason="Uncaught IndexError when list of tickets is empty.",
        )

        assert updated.state == "Active"
        assert mock_ado_state.work_items[101]["fields"]["System.State"] == "Active"
        history = mock_ado_state.work_items[101]["fields"].get("System.History", "")
        assert "Auto Claude QA Verification Rejected" in history
        assert "Uncaught IndexError" in history
