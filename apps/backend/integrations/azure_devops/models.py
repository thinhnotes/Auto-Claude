"""
Azure DevOps Data Models
========================

Dataclasses representing Azure DevOps Work Items and execution results.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class AzureDevOpsWorkItem:
    """Represents an ingested Azure DevOps Work Item."""

    id: int
    title: str
    description: str               # Converted to clean Markdown/text
    state: str
    work_item_type: str            # Bug, Task, User Story
    priority: int
    url: str
    tags: List[str] = field(default_factory=list)
    raw_fields: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_api_response(cls, item_data: Dict[str, Any]) -> "AzureDevOpsWorkItem":
        """
        Parse work item from Azure DevOps REST API JSON response.

        Handles:
          - Extracting fields from 'fields' dictionary
          - Fallback from System.Description to Microsoft.VSTS.TCM.ReproSteps
          - Priority parsing (handles string/int conversions and defaults to 3)
          - Tags parsing (semicolon-separated string -> list)
        """
        item_id = int(item_data.get("id") or item_data.get("fields", {}).get("System.Id", 0))
        fields = item_data.get("fields", {})

        title = str(fields.get("System.Title", "")).strip()

        # Handle description & repro steps
        raw_desc = fields.get("System.Description") or ""
        repro_steps = fields.get("Microsoft.VSTS.TCM.ReproSteps") or ""

        if raw_desc and repro_steps:
            description = f"{raw_desc}\n\n### Steps to Reproduce\n{repro_steps}"
        elif repro_steps:
            description = repro_steps
        else:
            description = raw_desc

        state = str(fields.get("System.State", "New"))
        work_item_type = str(fields.get("System.WorkItemType", "Task"))

        # Parse priority
        raw_priority = fields.get("Microsoft.VSTS.Common.Priority")
        priority = 3  # default medium priority
        if raw_priority is not None:
            try:
                priority = int(raw_priority)
            except (ValueError, TypeError):
                priority = 3

        # Parse tags
        raw_tags = fields.get("System.Tags", "")
        tags: List[str] = []
        if raw_tags:
            tags = [t.strip() for t in str(raw_tags).split(";") if t.strip()]

        url = item_data.get("url", "")

        return cls(
            id=item_id,
            title=title,
            description=description,
            state=state,
            work_item_type=work_item_type,
            priority=priority,
            url=url,
            tags=tags,
            raw_fields=fields,
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert work item to serializable dictionary."""
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "state": self.state,
            "work_item_type": self.work_item_type,
            "priority": self.priority,
            "url": self.url,
            "tags": self.tags,
            "raw_fields": self.raw_fields,
        }


@dataclass
class TicketExecutionResult:
    """Execution result for a single Azure DevOps work item."""

    work_item_id: int
    success: bool
    spec_id: str
    final_state: str
    error_message: Optional[str] = None
    test_results: Optional[Dict[str, Any]] = None
    diff_summary: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert execution result to serializable dictionary."""
        return {
            "work_item_id": self.work_item_id,
            "success": self.success,
            "spec_id": self.spec_id,
            "final_state": self.final_state,
            "error_message": self.error_message,
            "test_results": self.test_results,
            "diff_summary": self.diff_summary,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TicketExecutionResult":
        """Reconstruct from dictionary."""
        return cls(
            work_item_id=data["work_item_id"],
            success=data["success"],
            spec_id=data.get("spec_id", ""),
            final_state=data.get("final_state", ""),
            error_message=data.get("error_message"),
            test_results=data.get("test_results"),
            diff_summary=data.get("diff_summary"),
        )
