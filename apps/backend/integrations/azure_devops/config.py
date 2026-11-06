"""
Azure DevOps Integration Configuration
======================================

Configuration dataclass, URL normalizer, and environment variable loaders
for Azure DevOps REST API integration.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple


# Default state mapping: Auto Claude status -> Azure DevOps status
DEFAULT_STATE_MAPPING: Dict[str, str] = {
    "pending": "New",
    "in_progress": "Active",
    "completed": "Resolved",
    "blocked": "Active",
    "failed": "Active",
}

# Supported Work Item Types
DEFAULT_WORK_ITEM_TYPES = ["Bug", "Task", "User Story"]


def normalize_azure_devops_url(url: str) -> Tuple[str, Optional[str]]:
    """
    Normalize Azure DevOps organization URL and extract optional project.

    Supports:
      - https://dev.azure.com/{org}
      - https://dev.azure.com/{org}/{project}
      - https://{org}.visualstudio.com
      - https://{org}.visualstudio.com/{project}
      - Plain organization name (e.g., 'my-org')

    Args:
        url: Raw URL or organization name.

    Returns:
        Tuple of (canonical_organization_url, extracted_project_or_none)
    """
    if not url:
        return "", None

    cleaned = url.strip().rstrip("/")
    if not cleaned:
        return "", None

    # Handle plain org name (no schema)
    if not cleaned.startswith("http://") and not cleaned.startswith("https://"):
        if "/" not in cleaned:
            return f"https://dev.azure.com/{cleaned}", None
        parts = cleaned.split("/", 1)
        return f"https://dev.azure.com/{parts[0]}", parts[1]

    # Pattern 1: https://dev.azure.com/{org}(/{project})?
    dev_azure_match = re.match(
        r"^https?://dev\.azure\.com/(?P<org>[^/]+)(?:/(?P<project>[^/_]+))?(?:/.*)?$",
        cleaned,
        re.IGNORECASE,
    )
    if dev_azure_match:
        org = dev_azure_match.group("org")
        project = dev_azure_match.group("project")
        return f"https://dev.azure.com/{org}", project

    # Pattern 2: https://{org}.visualstudio.com(/{project})?
    vs_match = re.match(
        r"^https?://(?P<org>[^/]+)\.visualstudio\.com(?:/(?P<project>[^/_]+))?(?:/.*)?$",
        cleaned,
        re.IGNORECASE,
    )
    if vs_match:
        org = vs_match.group("org")
        project = vs_match.group("project")
        return f"https://{org}.visualstudio.com", project

    # Fallback: remove trailing slashes
    return cleaned, None


@dataclass
class AzureDevOpsConfig:
    """Configuration for Azure DevOps REST API connection."""

    organization_url: str          # e.g., "https://dev.azure.com/my-org" or "https://my-org.visualstudio.com"
    project: str                   # Project name
    personal_access_token: str     # PAT string
    api_version: str = "7.1"
    state_mapping: Dict[str, str] = field(default_factory=lambda: dict(DEFAULT_STATE_MAPPING))

    def __post_init__(self) -> None:
        """Normalize URL and fallback project if embedded in URL."""
        normalized_url, extracted_project = normalize_azure_devops_url(self.organization_url)
        self.organization_url = normalized_url
        if not self.project and extracted_project:
            self.project = extracted_project
        if not self.state_mapping:
            self.state_mapping = dict(DEFAULT_STATE_MAPPING)

    @classmethod
    def from_env(cls) -> "AzureDevOpsConfig":
        """
        Create configuration from environment variables.

        Supported variables:
          - AZURE_DEVOPS_PAT or AZURE_DEVOPS_TOKEN
          - AZURE_DEVOPS_ORG or AZURE_DEVOPS_ORGANIZATION_URL or AZURE_DEVOPS_ORG_URL
          - AZURE_DEVOPS_PROJECT
          - AZURE_DEVOPS_API_VERSION (optional, defaults to "7.1")
        """
        pat = os.environ.get("AZURE_DEVOPS_PAT") or os.environ.get("AZURE_DEVOPS_TOKEN") or ""
        org_url = (
            os.environ.get("AZURE_DEVOPS_ORG")
            or os.environ.get("AZURE_DEVOPS_ORGANIZATION_URL")
            or os.environ.get("AZURE_DEVOPS_ORG_URL")
            or ""
        )
        project = os.environ.get("AZURE_DEVOPS_PROJECT", "")
        api_version = os.environ.get("AZURE_DEVOPS_API_VERSION", "7.1")

        return cls(
            organization_url=org_url,
            project=project,
            personal_access_token=pat,
            api_version=api_version,
        )

    def is_valid(self) -> bool:
        """Check if all mandatory credentials are present."""
        return bool(self.organization_url and self.project and self.personal_access_token)

    @property
    def project_base_url(self) -> str:
        """Get the base REST URL for project-scoped API calls."""
        org = self.organization_url.rstrip("/")
        proj = self.project.strip("/")
        return f"{org}/{proj}/_apis"

    @property
    def org_base_url(self) -> str:
        """Get the base REST URL for organization-scoped API calls."""
        org = self.organization_url.rstrip("/")
        return f"{org}/_apis"

    def get_mapped_state(self, internal_status: str) -> str:
        """Map internal task status to Azure DevOps state."""
        return self.state_mapping.get(internal_status, "Active")
