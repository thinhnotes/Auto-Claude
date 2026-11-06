"""
Azure DevOps Two-Way Status & Feedback Synchronization
======================================================

Provides two-way synchronization between Auto Claude task execution and Azure DevOps:
- State transitions via JSON Patch (Active -> In Progress -> Resolved / Done)
- Detailed execution summaries and test results posted as Work Item comments
- Autonomous coder and QA lifecycle hooks (started, stuck, qa_approved, qa_rejected)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from .client import AzureDevOpsClient
from .config import AzureDevOpsConfig
from .models import AzureDevOpsWorkItem, TicketExecutionResult

logger = logging.getLogger(__name__)


class AzureDevOpsUpdater:
    """
    Handles two-way synchronization with Azure DevOps REST API:
    updating work item states and appending rich execution feedback comments.
    """

    def __init__(
        self,
        client: AzureDevOpsClient,
        config: Optional[AzureDevOpsConfig] = None,
    ) -> None:
        """
        Initialize AzureDevOpsUpdater.

        Args:
            client: An active AzureDevOpsClient instance.
            config: Optional config; defaults to client's config.
        """
        self.client = client
        self.config = config or client.config

    async def update_state(
        self,
        work_item_id: int,
        new_state: str,
        comment: Optional[str] = None,
    ) -> AzureDevOpsWorkItem:
        """
        Update the state of an Azure DevOps work item and optionally log a history comment.

        Args:
            work_item_id: The ID of the work item.
            new_state: Target state (e.g., 'Active', 'Resolved', 'Done', 'In Progress').
            comment: Optional comment explaining the state change.

        Returns:
            Updated AzureDevOpsWorkItem.
        """
        logger.info(f"Updating Azure DevOps work item #{work_item_id} state to '{new_state}'")
        return await self.client.update_work_item_state(
            work_item_id=work_item_id,
            new_state=new_state,
            comment=comment,
        )

    def format_execution_summary(self, result: TicketExecutionResult) -> str:
        """
        Format a comprehensive Markdown comment describing execution results,
        diff stats, and test metrics.

        Args:
            result: The TicketExecutionResult.

        Returns:
            Markdown-formatted summary string.
        """
        status_badge = "✅ **SUCCESS**" if result.success else "❌ **FAILED**"
        lines = [
            "## 🤖 Auto Claude Execution Summary",
            "",
            f"- **Result**: {status_badge}",
            f"- **Work Item ID**: `#{result.work_item_id}`",
            f"- **Spec ID**: `{result.spec_id}`",
            f"- **Final State**: `{result.final_state}`",
        ]

        # Error details if failed
        if not result.success and result.error_message:
            lines.extend([
                "",
                "### ❌ Failure Details",
                "```",
                result.error_message,
                "```",
            ])

        # Test metrics
        if result.test_results:
            tr = result.test_results
            total = tr.get("total", 0)
            passed = tr.get("passed", 0)
            failed = tr.get("failed", 0)
            skipped = tr.get("skipped", 0)
            duration = tr.get("duration", "N/A")
            pass_rate = f"{(passed / total * 100):.1f}%" if total > 0 else "100%"

            lines.extend([
                "",
                "### 🧪 Test Verification Results",
                f"- **Total Tests**: {total}",
                f"- **Passed**: {passed}",
                f"- **Failed**: {failed}",
                f"- **Skipped**: {skipped}",
                f"- **Pass Rate**: {pass_rate}",
                f"- **Duration**: {duration}s",
            ])

        # Changed files / diff summary
        if result.diff_summary:
            lines.extend([
                "",
                "### 📝 Code Changes & Diff Summary",
                "```",
                result.diff_summary,
                "```",
            ])

        lines.extend([
            "",
            "---",
            "*Automated feedback synchronization by Auto Claude Azure DevOps Integration.*",
        ])

        return "\n".join(lines)

    async def post_execution_summary(
        self,
        work_item_id: int,
        result: TicketExecutionResult,
    ) -> Dict[str, Any]:
        """
        Format and post a detailed execution summary comment to an Azure DevOps work item.

        Args:
            work_item_id: The work item ID.
            result: The TicketExecutionResult to summarize.

        Returns:
            Comment creation response dictionary from Azure DevOps.
        """
        comment_text = self.format_execution_summary(result)
        logger.info(f"Posting execution summary comment to work item #{work_item_id}")
        return await self.client.add_work_item_comment(
            work_item_id=work_item_id,
            comment_text=comment_text,
        )

    # ========================================================================
    # LIFECYCLE HOOKS
    # ========================================================================

    async def task_started(
        self,
        work_item_id: int,
        spec_id: Optional[str] = None,
    ) -> AzureDevOpsWorkItem:
        """
        Lifecycle hook: Called when Auto Claude begins executing a ticket.
        Transitions state to Active and records an initiation comment.
        """
        state = self.config.get_mapped_state("in_progress")
        spec_info = f" Spec: `{spec_id}`." if spec_id else ""
        comment = (
            f"🚀 **Auto Claude Execution Started**\n\n"
            f"Auto Claude has begun autonomous execution on this work item.{spec_info}\n"
            f"Work is isolated on a dedicated git branch."
        )
        return await self.update_state(work_item_id, new_state=state, comment=comment)

    async def task_stuck(
        self,
        work_item_id: int,
        reason: str,
    ) -> AzureDevOpsWorkItem:
        """
        Lifecycle hook: Called when Auto Claude is blocked or needs human intervention.
        Updates state and records reasons for the blocker.
        """
        state = self.config.get_mapped_state("blocked")
        comment = (
            f"⚠️ **Auto Claude Execution Blocked**\n\n"
            f"The autonomous agent encountered an issue requiring attention:\n\n"
            f"```\n{reason}\n```"
        )
        return await self.update_state(work_item_id, new_state=state, comment=comment)

    async def qa_approved(
        self,
        work_item_id: int,
        summary: Optional[str] = None,
    ) -> AzureDevOpsWorkItem:
        """
        Lifecycle hook: Called when QA validation completes successfully.
        Transitions work item to Resolved / Done.
        """
        state = self.config.get_mapped_state("completed")
        summary_text = summary or "All acceptance criteria, unit tests, and integration tests passed."
        comment = (
            f"✅ **Auto Claude QA Approved**\n\n"
            f"{summary_text}\n\n"
            f"Ready for review or deployment."
        )
        return await self.update_state(work_item_id, new_state=state, comment=comment)

    async def qa_rejected(
        self,
        work_item_id: int,
        reason: str,
    ) -> AzureDevOpsWorkItem:
        """
        Lifecycle hook: Called when QA validation detects regressions or unmet criteria.
        Reverts work item back to Active for rework.
        """
        state = self.config.get_mapped_state("failed")
        comment = (
            f"❌ **Auto Claude QA Verification Rejected**\n\n"
            f"Verification checks failed with the following details:\n\n"
            f"```\n{reason}\n```\n\n"
            f"Reverting state to `{state}` for remediation."
        )
        return await self.update_state(work_item_id, new_state=state, comment=comment)
