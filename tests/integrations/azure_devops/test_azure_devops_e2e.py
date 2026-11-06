"""
Full Lifecycle End-to-End Tests for Azure DevOps Integration
============================================================

Tier 4 automated end-to-end integration tests verifying the full lifecycle:
1. REST API authentication & project validation
2. WIQL work item querying & batch fetching
3. Spec directory & schema generation (spec.md, requirements.json, task_metadata.json)
4. Phased execution with git worktree/branch isolation and fault isolation
5. Two-way feedback synchronization (JSON patch state update & execution summary comments)
6. 100% offline verification with zero external network connectivity
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, List

import pytest

from apps.backend.integrations.azure_devops.client import AzureDevOpsClient
from apps.backend.integrations.azure_devops.config import AzureDevOpsConfig
from apps.backend.integrations.azure_devops.models import (
    AzureDevOpsWorkItem,
    TicketExecutionResult,
)
from apps.backend.integrations.azure_devops.runner import BatchTicketRunner
from apps.backend.integrations.azure_devops.updater import AzureDevOpsUpdater
from .mock_transport import (
    MockAzureDevOpsState,
    MockAzureDevOpsTransport,
    ado_client,
    ado_config,
    mock_ado_state,
    mock_ado_transport,
)


class TestAzureDevOpsE2EFullLifecycle:
    """End-to-End tests simulating production workflow offline."""

    @pytest.mark.asyncio
    async def test_full_lifecycle_query_ingest_execute_sync_e2e(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
        tmp_path: Path,
    ) -> None:
        """
        Full lifecycle test:
        - Query work items assigned to bot
        - Batch fetch details with HTML description parsing
        - Execute batch via BatchTicketRunner
        - Synchronize status (Resolved) and post summary comments back to Azure DevOps
        - Verify mock state updates and filesystem artifacts
        """
        # 1. Connection Validation
        conn = await ado_client.validate_connection()
        assert conn["valid"] is True
        assert conn["project_name"] == "my-project"

        # 2. Query Work Items via WIQL
        work_item_ids = await ado_client.query_work_items(assigned_to_me=True)
        assert 101 in work_item_ids
        assert 102 in work_item_ids

        # 3. Batch Ingest Work Items
        work_items = await ado_client.get_work_items_batch(work_item_ids)
        assert len(work_items) >= 2
        item_101 = next(item for item in work_items if item.id == 101)
        assert item_101.work_item_type == "Bug"
        assert item_101.priority == 1
        # Description should contain Markdown converted content
        assert "unhandled" in item_101.description

        # 4. Autonomous Batch Ticket Execution
        specs_dir = tmp_path / "specs"
        runner = BatchTicketRunner(
            project_dir=tmp_path,
            client=ado_client,
            use_worktree=False,
            specs_dir=specs_dir,
        )

        results = await runner.run_batch(work_items)
        assert len(results) == len(work_items)
        for res in results:
            assert res.success is True
            assert res.final_state == "Resolved"
            assert res.test_results is not None
            assert res.test_results.get("passed", 0) > 0

        # 5. Two-Way Feedback Synchronization
        updater = AzureDevOpsUpdater(client=ado_client)
        for res in results:
            # Update state on Azure DevOps
            updated_item = await updater.update_state(
                work_item_id=res.work_item_id,
                new_state="Resolved",
                comment=f"Auto Claude completed implementation for spec {res.spec_id}",
            )
            assert updated_item.state == "Resolved"

            # Post rich execution summary comment
            comment_resp = await updater.post_execution_summary(
                work_item_id=res.work_item_id,
                result=res,
            )
            assert comment_resp is not None

        # 6. Verify Mock Remote State
        for res in results:
            wid = res.work_item_id
            remote_item = mock_ado_state.work_items[wid]
            assert remote_item["fields"]["System.State"] == "Resolved"

            # Check comments posted
            assert wid in mock_ado_state.comments
            posted_comments = mock_ado_state.comments[wid]
            assert len(posted_comments) >= 1
            last_comment = posted_comments[-1]["text"]
            assert "Auto Claude Execution Summary" in last_comment
            assert res.spec_id in last_comment
            assert "Test Verification Results" in last_comment

        # 7. Verify Local Spec Artifacts
        for res in results:
            spec_folder = specs_dir / res.spec_id
            assert spec_folder.exists()
            assert (spec_folder / "spec.md").exists()
            assert (spec_folder / "requirements.json").exists()
            assert (spec_folder / "task_metadata.json").exists()
            assert (spec_folder / "implementation_plan.json").exists()
            assert (spec_folder / ".azure_devops_task.json").exists()

            req_data = json.loads((spec_folder / "requirements.json").read_text(encoding="utf-8"))
            assert req_data["source"] == "azure_devops"
            assert req_data["work_item_id"] == res.work_item_id

    @pytest.mark.asyncio
    async def test_e2e_batch_with_fault_isolation_and_error_reporting(
        self,
        ado_client: AzureDevOpsClient,
        mock_ado_state: MockAzureDevOpsState,
        tmp_path: Path,
    ) -> None:
        """
        E2E test verifying AC 2.2 fault isolation and error synchronization:
        - 3 tickets: 101 (Bug), 102 (Task), 103 (User Story).
        - Ticket 102 triggers an unhandled execution error.
        - Tickets 101 and 103 succeed and are synced to Resolved.
        - Ticket 102 reports failure comment without halting the workflow.
        """
        work_items = await ado_client.get_work_items_batch([101, 102, 103])
        assert len(work_items) == 3

        specs_dir = tmp_path / "specs"
        runner = BatchTicketRunner(
            project_dir=tmp_path,
            client=ado_client,
            use_worktree=False,
            specs_dir=specs_dir,
        )

        orig_run_ticket = runner.run_ticket

        async def injected_run_ticket(item: AzureDevOpsWorkItem) -> TicketExecutionResult:
            if item.id == 102:
                raise RuntimeError("Dependency resolution failed during test phase for ticket 102")
            return await orig_run_ticket(item)

        runner.run_ticket = injected_run_ticket  # type: ignore

        # Run batch
        results = await runner.run_batch(work_items)
        assert len(results) == 3

        updater = AzureDevOpsUpdater(client=ado_client)

        for res in results:
            if res.success:
                await updater.update_state(res.work_item_id, "Resolved")
            else:
                # Mark as blocked or report failure
                await updater.task_stuck(res.work_item_id, reason=res.error_message or "Unknown failure")
            await updater.post_execution_summary(res.work_item_id, res)

        # Verify Ticket 101 (Success)
        assert results[0].work_item_id == 101
        assert results[0].success is True
        assert mock_ado_state.work_items[101]["fields"]["System.State"] == "Resolved"

        # Verify Ticket 102 (Isolated Failure)
        assert results[1].work_item_id == 102
        assert results[1].success is False
        assert "Dependency resolution failed" in (results[1].error_message or "")
        # Failure summary comment was posted
        comments_102 = mock_ado_state.comments[102]
        assert any("FAILED" in c["text"] for c in comments_102)

        # Verify Ticket 103 (Success)
        assert results[2].work_item_id == 103
        assert results[2].success is True
        assert mock_ado_state.work_items[103]["fields"]["System.State"] == "Resolved"
