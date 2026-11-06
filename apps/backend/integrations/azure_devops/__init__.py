"""
Azure DevOps Integration Module
===============================

Provides authentication, work item querying, batch ingestion, status updates,
spec mapping, autonomous execution runner, feedback synchronization, and mock test
transport for Azure DevOps REST API.
"""

from .client import (
    AzureDevOpsAuthError,
    AzureDevOpsClient,
    AzureDevOpsError,
    AzureDevOpsNotFoundError,
    AzureDevOpsQueryError,
    AzureDevOpsRateLimitError,
)
from .config import AzureDevOpsConfig, normalize_azure_devops_url
from .mapper import (
    create_spec_from_work_item,
    html_to_markdown,
    slugify_title,
    work_item_to_auto_claude_spec,
)
from .models import AzureDevOpsWorkItem, TicketExecutionResult
from .runner import BatchTicketRunner
from .updater import AzureDevOpsUpdater

__all__ = [
    "AzureDevOpsConfig",
    "normalize_azure_devops_url",
    "AzureDevOpsClient",
    "AzureDevOpsWorkItem",
    "TicketExecutionResult",
    "AzureDevOpsError",
    "AzureDevOpsAuthError",
    "AzureDevOpsNotFoundError",
    "AzureDevOpsQueryError",
    "AzureDevOpsRateLimitError",
    "html_to_markdown",
    "slugify_title",
    "create_spec_from_work_item",
    "work_item_to_auto_claude_spec",
    "BatchTicketRunner",
    "AzureDevOpsUpdater",
]
