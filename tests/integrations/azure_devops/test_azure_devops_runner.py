"""
Unit & Integration Tests for BatchTicketRunner & Fault Isolation
=================================================================

Tier 3 & 4 tests validating single ticket execution, worktree/branch isolation,
and AC 2.2 bulletproof per-ticket fault isolation.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, List
from unittest.mock import AsyncMock, patch

import pytest

from apps.backend.integrations.azure_devops.models import (
    AzureDevOpsWorkItem,
    TicketExecutionResult,
)
from apps.backend.integrations.azure_devops.runner import BatchTicketRunner


@pytest.fixture
def sample_work_items() -> List[AzureDevOpsWorkItem]:
    """Sample work items representing Bugs and Tasks."""
    item1 = AzureDevOpsWorkItem(
        id=101,
        title="Fix authentication crash on empty token",
        description="<p>Authentication layer raises unhandled exception.</p>",
        state="Active",
        work_item_type="Bug",
        priority=1,
        url="https://dev.azure.com/my-org/my-project/_workitems/edit/101",
        tags=["auth", "urgent"],
        raw_fields={"System.Id": 101},
    )
    item2 = AzureDevOpsWorkItem(
        id=102,
        title="Implement WIQL query builder",
        description="<p>Build query builder with type and state filters.</p>",
        state="Active",
        work_item_type="Task",
        priority=2,
        url="https://dev.azure.com/my-org/my-project/_workitems/edit/102",
        tags=["backend"],
        raw_fields={"System.Id": 102},
    )
    item3 = AzureDevOpsWorkItem(
        id=103,
        title="Support Azure DevOps Two-Way Sync",
        description="<p>Sync status and post execution comments.</p>",
        state="New",
        work_item_type="User Story",
        priority=2,
        url="https://dev.azure.com/my-org/my-project/_workitems/edit/103",
        tags=["integration"],
        raw_fields={"System.Id": 103},
    )
    return [item1, item2, item3]


class TestBatchTicketRunnerSingleExecution:
    """Tests for single ticket execution."""

    @pytest.mark.asyncio
    async def test_single_ticket_execution_success(
        self,
        tmp_path: Path,
        sample_work_items: List[AzureDevOpsWorkItem],
    ) -> None:
        item = sample_work_items[0]
        runner = BatchTicketRunner(
            project_dir=tmp_path,
            use_worktree=False,
            specs_dir=tmp_path / "specs",
        )

        result = await runner.run_ticket(item)

        assert isinstance(result, TicketExecutionResult)
        assert result.work_item_id == 101
        assert result.success is True
        assert result.final_state == "Resolved"
        assert result.error_message is None
        assert result.diff_summary is not None
        assert result.test_results is not None
        assert result.test_results.get("passed", 0) > 0

        # Verify artifacts created on disk
        spec_dir = tmp_path / "specs" / result.spec_id
        assert spec_dir.exists()
        assert (spec_dir / "spec.md").exists()
        assert (spec_dir / "requirements.json").exists()
        assert (spec_dir / "task_metadata.json").exists()
        assert (spec_dir / "implementation_plan.json").exists()
        assert (spec_dir / ".azure_devops_task.json").exists()

        tracker = json.loads((spec_dir / ".azure_devops_task.json").read_text(encoding="utf-8"))
        assert tracker["work_item_id"] == 101
        assert tracker["success"] is True

    @pytest.mark.asyncio
    async def test_single_ticket_orchestrator_failure_handled(
        self,
        tmp_path: Path,
        sample_work_items: List[AzureDevOpsWorkItem],
    ) -> None:
        """Verify that an orchestrator error inside run_ticket is captured gracefully."""
        item = sample_work_items[0]

        async def failing_orchestrator(work_item: Any, spec_dir: Path) -> None:
            raise RuntimeError("Agent coder loop exceeded maximum retry attempts")

        runner = BatchTicketRunner(
            project_dir=tmp_path,
            use_worktree=False,
            orchestrator=failing_orchestrator,
            specs_dir=tmp_path / "specs",
        )

        result = await runner.run_ticket(item)

        assert result.success is False
        assert result.final_state == "Failed"
        assert "exceeded maximum retry attempts" in (result.error_message or "")


class TestBatchTicketRunnerFaultIsolation:
    """
    CRITICAL FAULT ISOLATION TESTS (AC 2.2)
    Verifies that processing of subsequent tickets proceeds even when a ticket fails catastrophically.
    """

    @pytest.mark.asyncio
    async def test_batch_execution_with_catastrophic_ticket_failure_isolation(
        self,
        tmp_path: Path,
        sample_work_items: List[AzureDevOpsWorkItem],
    ) -> None:
        """
        Three tickets: Ticket 101, Ticket 102, Ticket 103.
        Ticket 101 succeeds.
        Ticket 102 throws an unhandled catastrophic exception during execution.
        Ticket 103 succeeds.
        Proves: AC 2.2 fault isolation ensures Ticket 103 is executed successfully despite Ticket 102 failure.
        """
        runner = BatchTicketRunner(
            project_dir=tmp_path,
            use_worktree=False,
            specs_dir=tmp_path / "specs",
        )

        # Retain original run_ticket for items 101 and 103, but force crash on 102
        original_run_ticket = runner.run_ticket

        async def mock_run_ticket_with_isolated_crash(work_item: AzureDevOpsWorkItem) -> TicketExecutionResult:
            if work_item.id == 102:
                # Simulate unhandled catastrophic exception (e.g., out-of-memory, corrupted ast, syntax crash)
                raise ValueError("Catastrophic parsing failure on ticket 102: unexpected EOF in work item")
            return await original_run_ticket(work_item)

        runner.run_ticket = mock_run_ticket_with_isolated_crash  # type: ignore

        # Execute batch
        results = await runner.run_batch(sample_work_items)

        # Assertions
        assert len(results) == 3, "Batch runner must process all 3 tickets without aborting"

        # Ticket 1 (101) - Success
        assert results[0].work_item_id == 101
        assert results[0].success is True
        assert results[0].final_state == "Resolved"
        assert results[0].error_message is None

        # Ticket 2 (102) - Failed with recorded error, but did NOT crash batch
        assert results[1].work_item_id == 102
        assert results[1].success is False
        assert results[1].final_state == "Failed"
        assert "Catastrophic parsing failure on ticket 102" in (results[1].error_message or "")

        # Ticket 3 (103) - Success (PROVING FAULT ISOLATION)
        assert results[2].work_item_id == 103
        assert results[2].success is True
        assert results[2].final_state == "Resolved"
        assert results[2].error_message is None

    @pytest.mark.asyncio
    async def test_run_all_alias(
        self,
        tmp_path: Path,
        sample_work_items: List[AzureDevOpsWorkItem],
    ) -> None:
        """Verify that run_all is a fully functioning alias of run_batch."""
        runner = BatchTicketRunner(
            project_dir=tmp_path,
            use_worktree=False,
            specs_dir=tmp_path / "specs",
        )

        results = await runner.run_all(sample_work_items[:2])
        assert len(results) == 2
        assert results[0].success is True
        assert results[1].success is True

    @pytest.mark.asyncio
    async def test_empty_batch(self, tmp_path: Path) -> None:
        """Verify empty batch handling."""
        runner = BatchTicketRunner(project_dir=tmp_path)
        results = await runner.run_batch([])
        assert results == []

    @pytest.mark.asyncio
    async def test_worktree_fallback_when_git_unavailable(
        self,
        tmp_path: Path,
        sample_work_items: List[AzureDevOpsWorkItem],
    ) -> None:
        """Verify runner falls back gracefully when worktree creation cannot be satisfied."""
        runner = BatchTicketRunner(
            project_dir=tmp_path,
            use_worktree=True,  # enabled, but tmp_path is not a git repo
            specs_dir=tmp_path / "specs",
        )

        # Should execute cleanly via fallback without raising
        result = await runner.run_ticket(sample_work_items[0])
        assert result.success is True
        assert result.work_item_id == 101
