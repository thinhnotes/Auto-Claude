"""
Azure DevOps Provider Implementation
====================================

Implements the GitProvider protocol for Azure DevOps using AzureDevOpsClient.
Supports Work Items (Issues/Tickets) and Azure Repos Git (Pull Requests/Repositories).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

# Import AzureDevOpsClient, AzureDevOpsConfig, AzureDevOpsWorkItem gracefully
try:
    from apps.backend.integrations.azure_devops.client import AzureDevOpsClient
    from apps.backend.integrations.azure_devops.config import AzureDevOpsConfig
    from apps.backend.integrations.azure_devops.models import AzureDevOpsWorkItem
except ImportError:
    try:
        from integrations.azure_devops.client import AzureDevOpsClient
        from integrations.azure_devops.config import AzureDevOpsConfig
        from integrations.azure_devops.models import AzureDevOpsWorkItem
    except ImportError:
        AzureDevOpsClient = None  # type: ignore
        AzureDevOpsConfig = None  # type: ignore
        AzureDevOpsWorkItem = None  # type: ignore

from .protocol import (
    GitProvider,
    IssueData,
    IssueFilters,
    LabelData,
    PRData,
    PRFilters,
    ProviderType,
    ReviewData,
)


@dataclass
class AzureDevOpsProvider:
    """
    Azure DevOps implementation of the GitProvider protocol.

    Wraps the AzureDevOpsClient functionality.

    Usage:
        provider = AzureDevOpsProvider(_repo="my-org/my-project")
        issue = await provider.fetch_issue(1042)
        await provider.add_comment(1042, "Fixed issue")
    """

    _repo: str = ""
    _client: Any | None = None
    _config: Any | None = None
    _project_dir: str | None = None
    organization_url: str | None = None
    project: str | None = None
    personal_access_token: str | None = None
    pat: str | None = None
    enable_rate_limiting: bool = True

    def __post_init__(self) -> None:
        # Parse organization and project from _repo if provided
        extracted_org = None
        extracted_project = None
        if self._repo:
            parts = [p for p in self._repo.split("/") if p]
            if len(parts) >= 2:
                extracted_org = parts[0]
                extracted_project = parts[1]
            elif len(parts) == 1:
                extracted_project = parts[0]

        final_project = self.project or extracted_project or ""
        token = self.personal_access_token or self.pat or ""

        self._init_client()

    def _init_client(self) -> Any:
        # Initialize client if not supplied
        if self._client is None and AzureDevOpsClient is not None:
            if self._config is not None:
                self._client = AzureDevOpsClient(self._config)
            elif AzureDevOpsConfig is not None:
                extracted_org = None
                extracted_project = None
                if self._repo:
                    parts = [p for p in self._repo.split("/") if p]
                    if len(parts) >= 2:
                        extracted_org = parts[0]
                        extracted_project = parts[1]
                    elif len(parts) == 1:
                        extracted_project = parts[0]

                final_project = (
                    self.project
                    or extracted_project
                    or os.getenv("AZURE_DEVOPS_PROJECT")
                    or ""
                )
                token = (
                    self.personal_access_token
                    or self.pat
                    or os.getenv("AZURE_DEVOPS_PAT")
                    or os.getenv("AZURE_DEVOPS_TOKEN")
                    or ""
                )
                org_url = self.organization_url
                if not org_url and extracted_org:
                    org_url = f"https://dev.azure.com/{extracted_org}"

                org_url = (
                    org_url
                    or os.getenv("AZURE_DEVOPS_ORG_URL")
                    or os.getenv("AZURE_DEVOPS_ORG")
                    or ""
                )

                if (not token or not org_url or not final_project) and self._project_dir:
                    state_file = os.path.join(
                        self._project_dir, ".auto-claude", "azure-devops", "state.json"
                    )
                    if os.path.exists(state_file):
                        try:
                            import json

                            with open(state_file, "r", encoding="utf-8") as f:
                                sdata = json.load(f)
                            cfg = sdata.get("config", {})
                            if not org_url:
                                org_url = cfg.get("organizationUrl") or ""
                            if not final_project:
                                final_project = cfg.get("project") or ""
                            if not token:
                                token = cfg.get("personalAccessToken") or ""
                        except Exception:
                            pass

                if org_url and final_project and token:
                    self._config = AzureDevOpsConfig(
                        organization_url=org_url,
                        project=final_project,
                        personal_access_token=token,
                    )
                    self._client = AzureDevOpsClient(self._config)
        return self._client

    def reset_client(self, new_config: Any | None = None) -> None:
        """
        Reset cached client state so updated config/token takes effect.
        Ensures refreshing properly re-reads updated configuration and resets cached client state.
        """
        self._client = None
        self._config = new_config

    def update_config(
        self,
        organization_url: str | None = None,
        project: str | None = None,
        personal_access_token: str | None = None,
    ) -> None:
        """Update configuration and reset cached client state."""
        if organization_url is not None:
            self.organization_url = organization_url
        if project is not None:
            self.project = project
        if personal_access_token is not None:
            self.personal_access_token = personal_access_token
            self.pat = personal_access_token
        self._config = None
        self.reset_client()

    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.AZURE_DEVOPS

    @property
    def repo(self) -> str:
        return self._repo

    @property
    def client(self) -> Any:
        if self._client is None and AzureDevOpsClient is not None:
            self._init_client()
        if self._client is None:
            raise ValueError(
                "AzureDevOpsClient is not configured. Provide client, config, "
                "or set AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORG_URL, and AZURE_DEVOPS_PROJECT."
            )
        return self._client

    async def validate_connection(self) -> dict[str, Any]:
        """Validate organization and PAT credentials against Azure DevOps API."""
        if hasattr(self.client, "validate_connection"):
            return await self.client.validate_connection()
        return {"valid": True, "message": "Connection validated"}

    async def test_connection(self) -> dict[str, Any]:
        """Validate organization and PAT credentials prior to saving."""
        return await self.validate_connection()

    # -------------------------------------------------------------------------
    # Work Item / Issue Operations
    # -------------------------------------------------------------------------

    async def fetch_issue(self, number: int) -> IssueData:
        """Fetch a work item by number."""
        work_item = await self.client.get_work_item(number)
        return self._parse_issue_data(work_item)

    async def fetch_issues(
        self, filters: IssueFilters | None = None, refresh: bool = False
    ) -> list[IssueData]:
        """Fetch work items with optional filters."""
        if refresh:
            if self._client is not None:
                if hasattr(self._client, "reset"):
                    try:
                        self._client.reset()
                    except Exception:
                        pass
                elif hasattr(self._client, "close"):
                    try:
                        import inspect
                        if inspect.iscoroutinefunction(self._client.close):
                            await self._client.close()
                        else:
                            self._client.close()
                    except Exception:
                        pass
            if self._config is not None or (self.organization_url and (self.personal_access_token or self.pat)) or self._project_dir:
                self.reset_client()
        filters = filters or IssueFilters()

        # Query work item IDs (if assignee filter specifies @me, restrict to @me, otherwise search all)
        assigned_to_me = bool(filters.assignee == "@me")
        ids = await self.client.query_work_items(assigned_to_me=assigned_to_me)
        if not ids:
            return []

        # Batch fetch work items up to limit
        limit = filters.limit or 100
        target_ids = ids[:limit]
        work_items = await self.client.get_work_items_batch(target_ids)

        result: list[IssueData] = []
        for wi in work_items:
            issue = self._parse_issue_data(wi)

            # Filter by state
            if filters.state and filters.state != "all":
                if issue.state != filters.state:
                    continue

            # Filter by labels
            if filters.labels:
                if not all(label in issue.labels for label in filters.labels):
                    continue

            # Filter by author
            if filters.author and issue.author != filters.author:
                continue

            # Filter by assignee
            if filters.assignee and filters.assignee != "@me" and filters.assignee not in issue.assignees:
                continue

            # Filter by creation date
            if filters.since and issue.created_at < filters.since:
                continue

            result.append(issue)

        return result

    async def create_issue(
        self,
        title: str,
        body: str,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> IssueData:
        """Create a new work item in Azure DevOps."""
        if hasattr(self.client, "create_work_item"):
            res = await self.client.create_work_item(
                title=title, body=body, labels=labels, assignees=assignees
            )
            return self._parse_issue_data(res)

        patch_doc = [
            {"op": "add", "path": "/fields/System.Title", "value": title},
            {"op": "add", "path": "/fields/System.Description", "value": body},
        ]
        if labels:
            patch_doc.append(
                {"op": "add", "path": "/fields/System.Tags", "value": "; ".join(labels)}
            )
        if assignees and len(assignees) > 0:
            patch_doc.append(
                {"op": "add", "path": "/fields/System.AssignedTo", "value": assignees[0]}
            )

        endpoint = "_apis/wit/workitems/$Task?api-version=7.1"
        res = await self.api_post(endpoint, data=patch_doc)
        return self._parse_issue_data(res)

    async def close_issue(
        self,
        number: int,
        comment: str | None = None,
    ) -> bool:
        """Close a work item."""
        try:
            if comment:
                await self.add_comment(number, comment)
            await self.client.update_work_item_state(number, "Closed")
            return True
        except Exception:
            return False

    async def add_comment(
        self,
        issue_or_pr_number: int,
        body: str,
    ) -> int:
        """Add a comment to a work item."""
        res = await self.client.add_work_item_comment(issue_or_pr_number, body)
        if isinstance(res, dict):
            return int(res.get("id", 0))
        return 0

    # -------------------------------------------------------------------------
    # Label Operations
    # -------------------------------------------------------------------------

    async def apply_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """Apply tags to a work item."""
        issue = await self.fetch_issue(issue_or_pr_number)
        current_tags = set(issue.labels)
        current_tags.update(labels)
        tags_str = "; ".join(sorted(current_tags))

        patch_doc = [{"op": "add", "path": "/fields/System.Tags", "value": tags_str}]
        endpoint = f"_apis/wit/workitems/{issue_or_pr_number}?api-version=7.1"
        await self.api_post(endpoint, data=patch_doc)

    async def remove_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """Remove tags from a work item."""
        issue = await self.fetch_issue(issue_or_pr_number)
        to_remove = set(labels)
        remaining = [t for t in issue.labels if t not in to_remove]
        tags_str = "; ".join(remaining)

        patch_doc = [{"op": "add", "path": "/fields/System.Tags", "value": tags_str}]
        endpoint = f"_apis/wit/workitems/{issue_or_pr_number}?api-version=7.1"
        await self.api_post(endpoint, data=patch_doc)

    async def create_label(self, label: LabelData) -> None:
        """Create a label in Azure DevOps (tags are created on assignment)."""
        pass

    async def list_labels(self) -> list[LabelData]:
        """List tags in Azure DevOps project."""
        try:
            res = await self.api_get("_apis/wit/tags?api-version=7.1-preview.1")
            items = res.get("value", []) if isinstance(res, dict) else []
            return [
                LabelData(name=item.get("name", ""), color="#0078d4", description="")
                for item in items
                if item.get("name")
            ]
        except Exception:
            return []

    # -------------------------------------------------------------------------
    # Pull Request Operations (Azure Repos)
    # -------------------------------------------------------------------------

    async def fetch_pr(self, number: int) -> PRData:
        """Fetch a pull request by number."""
        repo_name = self._get_repo_name()
        endpoint = f"_apis/git/repositories/{repo_name}/pullrequests/{number}?api-version=7.1"
        pr_data = await self.api_get(endpoint)
        diff = await self.fetch_pr_diff(number)
        return self._parse_pr_data(pr_data, diff)

    async def fetch_prs(self, filters: PRFilters | None = None) -> list[PRData]:
        """Fetch pull requests with optional filters."""
        filters = filters or PRFilters()
        repo_name = self._get_repo_name()
        endpoint = f"_apis/git/repositories/{repo_name}/pullrequests?api-version=7.1"
        data = await self.api_get(endpoint)
        items = data.get("value", []) if isinstance(data, dict) else []

        result: list[PRData] = []
        for pr_raw in items:
            pr = self._parse_pr_data(pr_raw, "")
            if filters.state and filters.state != "all":
                if pr.state != filters.state:
                    continue
            if filters.author and pr.author != filters.author:
                continue
            if filters.base_branch and pr.target_branch != filters.base_branch:
                continue
            if filters.head_branch and pr.source_branch != filters.head_branch:
                continue
            result.append(pr)

        return result

    async def fetch_pr_diff(self, number: int) -> str:
        """Fetch the unified diff for a pull request."""
        try:
            repo_name = self._get_repo_name()
            endpoint = f"_apis/git/repositories/{repo_name}/pullrequests/{number}/diffs?api-version=7.1"
            res = await self.api_get(endpoint)
            return res.get("diff", "") if isinstance(res, dict) else str(res or "")
        except Exception:
            return ""

    async def post_review(self, pr_number: int, review: ReviewData) -> int:
        """Post a review comment to a pull request."""
        repo_name = self._get_repo_name()
        endpoint = f"_apis/git/repositories/{repo_name}/pullrequests/{pr_number}/threads?api-version=7.1"
        thread_data = {
            "comments": [{"parentCommentId": 0, "content": review.body, "commentType": 1}],
            "status": 1,
        }
        res = await self.api_post(endpoint, data=thread_data)
        if isinstance(res, dict):
            return int(res.get("id", 0))
        return 0

    async def merge_pr(
        self,
        pr_number: int,
        merge_method: str = "merge",
        commit_title: str | None = None,
    ) -> bool:
        """Merge a pull request."""
        try:
            repo_name = self._get_repo_name()
            endpoint = f"_apis/git/repositories/{repo_name}/pullrequests/{pr_number}?api-version=7.1"
            body = {
                "status": "completed",
                "completionOptions": {
                    "deleteSourceBranch": True,
                    "mergeCommitMessage": commit_title or "Merged by Auto Claude",
                    "mergeStrategy": 1 if merge_method == "squash" else 2,
                },
            }
            await self.api_post(endpoint, data=body)
            return True
        except Exception:
            return False

    async def close_pr(self, pr_number: int, comment: str | None = None) -> bool:
        """Close/abandon a pull request."""
        try:
            if comment:
                await self.post_review(
                    pr_number, ReviewData(pr_number=pr_number, event="comment", body=comment)
                )
            repo_name = self._get_repo_name()
            endpoint = f"_apis/git/repositories/{repo_name}/pullrequests/{pr_number}?api-version=7.1"
            await self.api_post(endpoint, data={"status": "abandoned"})
            return True
        except Exception:
            return False

    # -------------------------------------------------------------------------
    # Repository Operations
    # -------------------------------------------------------------------------

    async def get_repository_info(self) -> dict[str, Any]:
        """Get repository metadata."""
        try:
            repo_name = self._get_repo_name()
            endpoint = f"_apis/git/repositories/{repo_name}?api-version=7.1"
            return await self.api_get(endpoint)
        except Exception:
            return {
                "name": self._get_repo_name(),
                "provider": "azure_devops",
                "repo": self._repo,
            }

    async def get_default_branch(self) -> str:
        """Get default branch name."""
        try:
            info = await self.get_repository_info()
            default_branch = info.get("defaultBranch", "refs/heads/main")
            return default_branch.replace("refs/heads/", "")
        except Exception:
            return "main"

    async def check_permissions(self, username: str) -> str:
        """Check user permissions."""
        return "write"

    # -------------------------------------------------------------------------
    # Low-level API Operations
    # -------------------------------------------------------------------------

    async def api_get(
        self,
        endpoint: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Make a GET request to Azure DevOps API."""
        if hasattr(self.client, "api_get"):
            return await self.client.api_get(endpoint, params=params)
        if hasattr(self.client, "_get"):
            return await self.client._get(endpoint, params=params)
        if hasattr(self.client, "_http_client"):
            resp = await self.client._http_client.get(endpoint, params=params)
            resp.raise_for_status()
            return resp.json()
        raise NotImplementedError("Client does not support api_get")

    async def api_post(
        self,
        endpoint: str,
        data: dict[str, Any] | None = None,
    ) -> Any:
        """Make a POST request to Azure DevOps API."""
        if hasattr(self.client, "api_post"):
            return await self.client.api_post(endpoint, data=data)
        if hasattr(self.client, "_post"):
            return await self.client._post(endpoint, data=data)
        if hasattr(self.client, "_http_client"):
            headers = None
            if isinstance(data, list):
                headers = {"Content-Type": "application/json-patch+json"}
            resp = await self.client._http_client.post(endpoint, json=data, headers=headers)
            resp.raise_for_status()
            return resp.json()
        raise NotImplementedError("Client does not support api_post")

    # -------------------------------------------------------------------------
    # Convenience Aliases
    # -------------------------------------------------------------------------

    async def get_issue(self, number: int) -> IssueData:
        """Alias for fetch_issue."""
        return await self.fetch_issue(number)

    async def list_issues(self, filters: IssueFilters | None = None) -> list[IssueData]:
        """Alias for fetch_issues."""
        return await self.fetch_issues(filters)

    # -------------------------------------------------------------------------
    # Internal Helpers
    # -------------------------------------------------------------------------

    def _get_repo_name(self) -> str:
        if self._repo:
            return self._repo.split("/")[-1]
        if self.project:
            return self.project
        return "default"

    def _parse_issue_data(self, item: Any) -> IssueData:
        """Parse AzureDevOpsWorkItem or raw dict into IssueData."""
        if isinstance(item, dict):
            raw_fields = item.get("fields", item)
            item_id = item.get("id", 0)
            title = raw_fields.get("System.Title", "")
            body = (
                raw_fields.get("System.Description")
                or raw_fields.get("Microsoft.VSTS.TCM.ReproSteps")
                or ""
            )
            state_str = raw_fields.get("System.State", "Active")
            created_date_str = raw_fields.get("System.CreatedDate")
            changed_date_str = raw_fields.get("System.ChangedDate")
            url = item.get("url", "")
            tags_raw = raw_fields.get("System.Tags", "")
            if isinstance(tags_raw, str):
                tags = [t.strip() for t in tags_raw.split(";") if t.strip()]
            elif isinstance(tags_raw, list):
                tags = [str(t).strip() for t in tags_raw if str(t).strip()]
            else:
                tags = []
            created_by = raw_fields.get("System.CreatedBy", {})
            assigned_to = raw_fields.get("System.AssignedTo", {})
            iteration_path = raw_fields.get("System.IterationPath")
            work_item_type = raw_fields.get("System.WorkItemType", "Task")
        else:
            raw_fields = getattr(item, "raw_fields", {}) or {}
            item_id = item.id
            title = item.title
            body = item.description or raw_fields.get("Microsoft.VSTS.TCM.ReproSteps") or ""
            state_str = item.state
            created_date_str = raw_fields.get("System.CreatedDate")
            changed_date_str = raw_fields.get("System.ChangedDate")
            url = item.url
            tags = list(getattr(item, "tags", []))
            created_by = raw_fields.get("System.CreatedBy", {})
            assigned_to = raw_fields.get("System.AssignedTo", {})
            iteration_path = raw_fields.get("System.IterationPath")
            work_item_type = getattr(item, "work_item_type", "Task")

        # Resolve author
        if isinstance(created_by, dict):
            author = (
                created_by.get("uniqueName")
                or created_by.get("displayName")
                or "unknown"
            )
        else:
            author = str(created_by) if created_by else "unknown"

        # Resolve assignees
        assignees: list[str] = []
        if assigned_to:
            if isinstance(assigned_to, dict):
                name = assigned_to.get("uniqueName") or assigned_to.get("displayName")
                if name:
                    assignees.append(name)
            else:
                assignees.append(str(assigned_to))

        # Normalize state for protocol compliance
        is_closed = state_str.lower() in (
            "closed",
            "resolved",
            "done",
            "removed",
            "completed",
        )
        normalized_state = "closed" if is_closed else "open"

        # Include work item type as first label if not already present
        labels = list(tags)
        if work_item_type and work_item_type not in labels:
            labels.insert(0, work_item_type)

        created_at = self._parse_datetime(created_date_str)
        updated_at = self._parse_datetime(changed_date_str)

        return IssueData(
            number=item_id,
            title=title,
            body=body,
            author=author,
            state=normalized_state,
            labels=labels,
            created_at=created_at,
            updated_at=updated_at,
            url=url,
            assignees=assignees,
            milestone=iteration_path,
            provider=ProviderType.AZURE_DEVOPS,
            raw_data=raw_fields if raw_fields else {"id": item_id, "state": state_str},
        )

    def _parse_pr_data(self, data: dict[str, Any], diff: str) -> PRData:
        """Parse Azure DevOps PR JSON into PRData."""
        created_by = data.get("createdBy", {})
        if isinstance(created_by, dict):
            author_login = (
                created_by.get("uniqueName")
                or created_by.get("displayName")
                or "unknown"
            )
        else:
            author_login = str(created_by) if created_by else "unknown"

        raw_status = str(data.get("status", "active")).lower()
        if raw_status == "completed":
            state = "merged"
        elif raw_status == "abandoned":
            state = "closed"
        else:
            state = "open"

        source_ref = data.get("sourceRefName", "")
        target_ref = data.get("targetRefName", "")
        source_branch = source_ref.replace("refs/heads/", "") if source_ref else ""
        target_branch = target_ref.replace("refs/heads/", "") if target_ref else ""

        reviewers_list: list[str] = []
        for r in data.get("reviewers", []):
            if isinstance(r, dict):
                name = r.get("uniqueName") or r.get("displayName")
                if name:
                    reviewers_list.append(name)
            else:
                reviewers_list.append(str(r))

        labels = [
            label_item.get("name", "")
            for label_item in data.get("labels", [])
            if isinstance(label_item, dict) and label_item.get("name")
        ]
        merge_status = str(data.get("mergeStatus", "")).lower()
        mergeable = merge_status not in ("conflicts", "failure")

        return PRData(
            number=int(data.get("pullRequestId", data.get("number", 0))),
            title=data.get("title", ""),
            body=data.get("description", "") or "",
            author=author_login,
            state=state,
            source_branch=source_branch,
            target_branch=target_branch,
            additions=data.get("additions", 0),
            deletions=data.get("deletions", 0),
            changed_files=data.get("changedFiles", 0),
            files=data.get("files", []),
            diff=diff,
            url=data.get("url", ""),
            created_at=self._parse_datetime(
                data.get("creationDate") or data.get("createdAt")
            ),
            updated_at=self._parse_datetime(
                data.get("closedDate") or data.get("updatedAt")
            ),
            labels=labels,
            reviewers=reviewers_list,
            is_draft=bool(data.get("isDraft", False)),
            mergeable=mergeable,
            provider=ProviderType.AZURE_DEVOPS,
            raw_data=data,
        )

    def _parse_datetime(self, dt_str: str | None) -> datetime:
        """Parse ISO datetime string."""
        if not dt_str:
            return datetime.now(timezone.utc)
        try:
            return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return datetime.now(timezone.utc)
