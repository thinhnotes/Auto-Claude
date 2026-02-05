"""
Unit Tests for Task Worktree Handlers
======================================

Tests all 7 worktree WebSocket handlers with mocks.
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock
import subprocess

import pytest

from apps.backend.core.worktree import WorktreeInfo, WorktreeManager
from apps.backend.web.ws.handlers.task_worktree import (
    handle_worktree_status,
    handle_worktree_diff,
    handle_worktree_merge_preview,
    handle_worktree_merge,
    handle_worktree_discard,
    handle_clear_staged_state,
    handle_list_worktrees,
)


# ==================== Fixtures ====================


@pytest.fixture
def mock_get_project_path():
    """Mock get_project_path to return a test path."""
    with patch("apps.backend.web.ws.handlers.task_worktree.get_project_path") as mock:
        # Create a mock Path that has exists() return True
        mock_path = MagicMock(spec=Path)
        mock_path.exists.return_value = True
        mock_path.__str__.return_value = "/fake/project/path"
        mock.return_value = mock_path
        yield mock


@pytest.fixture
def mock_parse_task_id():
    """Mock parse_task_id to return test project_id and folder."""
    with patch("apps.backend.web.ws.handlers.task_worktree.parse_task_id") as mock:
        mock.return_value = ("test-project", "001-test-task")
        yield mock


@pytest.fixture
def mock_worktree_manager():
    """Mock WorktreeManager class."""
    with patch("apps.backend.web.ws.handlers.task_worktree.WorktreeManager") as mock:
        manager_instance = MagicMock(spec=WorktreeManager)
        mock.return_value = manager_instance
        yield manager_instance


@pytest.fixture
def mock_subprocess_run():
    """Mock subprocess.run for git commands."""
    with patch("subprocess.run") as mock:
        yield mock


# ==================== handle_worktree_status Tests ====================


class TestHandleWorktreeStatus:
    """Test handle_worktree_status handler."""

    @pytest.mark.asyncio
    async def test_success_with_changes(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test getting worktree status with uncommitted changes."""
        # Setup mock worktree info
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
            is_active=True,
            commit_count=3,
            files_changed=5,
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_worktree_manager.base_branch = "main"

        # Mock git status output (has changes)
        mock_subprocess_run.side_effect = [
            MagicMock(returncode=0, stdout=" M file.txt\n"),  # git status
            MagicMock(returncode=0, stdout="3\n"),  # git rev-list --count
        ]

        result = await handle_worktree_status({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is True
        assert result["data"]["exists"] is True
        assert result["data"]["branch"] == "auto-claude/001-test-task"
        assert result["data"]["commitCount"] == 3
        assert result["data"]["clean"] is False
        mock_worktree_manager.get_worktree_info.assert_called_once_with("001-test-task")

    @pytest.mark.asyncio
    async def test_success_clean_state(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test getting worktree status with no changes."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
            is_active=True,
            commit_count=0,
            files_changed=0,
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_worktree_manager.base_branch = "main"

        # Mock git status output (no changes)
        mock_subprocess_run.side_effect = [
            MagicMock(returncode=0, stdout=""),  # git status (empty = clean)
            MagicMock(returncode=0, stdout="0\n"),  # git rev-list --count
        ]

        result = await handle_worktree_status({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is True
        assert result["data"]["exists"] is True
        assert result["data"]["clean"] is True
        assert result["data"]["commitCount"] == 0

    @pytest.mark.asyncio
    async def test_no_worktree_exists(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager
    ):
        """Test when no worktree exists for the task."""
        mock_worktree_manager.get_worktree_info.return_value = None

        result = await handle_worktree_status({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is True
        assert result["data"]["exists"] is False

    @pytest.mark.asyncio
    async def test_missing_task_id(self):
        """Test error when taskId parameter is missing."""
        result = await handle_worktree_status({"projectId": "test-project"})

        assert result["success"] is False
        assert "Missing required parameters (projectId, taskId)" in result["error"]

    @pytest.mark.asyncio
    async def test_invalid_task_id(self, mock_parse_task_id):
        """Test error when task ID is invalid."""
        mock_parse_task_id.side_effect = ValueError("Invalid task ID")

        result = await handle_worktree_status({
            "projectId": "test-project",
            "taskId": "invalid"
        })

        assert result["success"] is False
        assert "Invalid task ID" in result["error"]

    @pytest.mark.asyncio
    async def test_exception_handling(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager
    ):
        """Test handling of unexpected exceptions."""
        mock_worktree_manager.get_worktree_info.side_effect = Exception("Disk error")

        result = await handle_worktree_status({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is False
        assert "Disk error" in result["error"]


# ==================== handle_worktree_diff Tests ====================


class TestHandleWorktreeDiff:
    """Test handle_worktree_diff handler."""

    @pytest.mark.asyncio
    async def test_success_with_diff(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test getting worktree diff with changes."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info

        # Mock git diff output
        diff_output = """diff --git a/file.txt b/file.txt
index 123..456 789
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line1
+line2
 line3
"""
        mock_subprocess_run.return_value = MagicMock(
            returncode=0,
            stdout=diff_output,
            stderr="",
        )

        result = await handle_worktree_diff({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is True
        assert result["data"]["diff"] == diff_output

    @pytest.mark.asyncio
    async def test_success_no_diff(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test getting worktree diff with no changes."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_subprocess_run.return_value = MagicMock(
            returncode=0,
            stdout="",
            stderr="",
        )

        result = await handle_worktree_diff({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is True
        assert result["data"]["diff"] == ""

    @pytest.mark.asyncio
    async def test_no_worktree(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager
    ):
        """Test diff when no worktree exists."""
        mock_worktree_manager.get_worktree_info.return_value = None

        result = await handle_worktree_diff({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is False
        assert "Worktree does not exist for this task" in result["error"]

    @pytest.mark.asyncio
    async def test_git_command_failure(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test handling of git command failures."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_subprocess_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="fatal: not a git repository",
        )

        result = await handle_worktree_diff({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is False
        assert "Failed to get git diff" in result["error"]

    @pytest.mark.asyncio
    async def test_missing_task_id(self):
        """Test error when taskId is missing."""
        result = await handle_worktree_diff({"projectId": "test-project"})

        assert result["success"] is False
        assert "Missing required parameters (projectId, taskId)" in result["error"]


# ==================== handle_worktree_merge_preview Tests ====================


class TestHandleWorktreeMergePreview:
    """Test handle_worktree_merge_preview handler."""

    @pytest.mark.asyncio
    async def test_success_no_conflicts(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test merge preview with no conflicts."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info

        # Mock git merge --no-commit --no-ff (success) and git status, then git merge --abort
        mock_subprocess_run.side_effect = [
            MagicMock(returncode=0, stdout="Automatic merge went well", stderr=""),  # git merge
            MagicMock(returncode=0, stdout="", stderr=""),  # git status (no conflicts)
            MagicMock(returncode=0, stdout="", stderr=""),  # git merge --abort
        ]

        result = await handle_worktree_merge_preview({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is True
        assert result["data"]["hasConflicts"] is False
        assert result["data"]["conflicts"] == []

    @pytest.mark.asyncio
    async def test_merge_conflicts_detected(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test merge preview with conflicts."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info

        # Mock git merge with conflict, git status showing conflicts, then git merge --abort
        mock_subprocess_run.side_effect = [
            MagicMock(returncode=1, stdout="", stderr="CONFLICT (content): Merge conflict in file.txt"),  # git merge
            MagicMock(returncode=0, stdout="UU file.txt\n", stderr=""),  # git status (conflict marker)
            MagicMock(returncode=0, stdout="", stderr=""),  # git merge --abort
        ]

        result = await handle_worktree_merge_preview({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is True
        assert result["data"]["hasConflicts"] is True
        assert len(result["data"]["conflicts"]) > 0

    @pytest.mark.asyncio
    async def test_no_worktree(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager
    ):
        """Test merge preview when no worktree exists."""
        mock_worktree_manager.get_worktree_info.return_value = None

        result = await handle_worktree_merge_preview({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is False
        assert "No worktree found for task" in result["error"]

    @pytest.mark.asyncio
    async def test_missing_task_id(self):
        """Test error when taskId is missing."""
        result = await handle_worktree_merge_preview({"projectId": "test-project"})

        assert result["success"] is False
        assert "Missing required parameters (projectId, taskId)" in result["error"]


# ==================== handle_worktree_merge Tests ====================


class TestHandleWorktreeMerge:
    """Test handle_worktree_merge handler."""

    @pytest.mark.asyncio
    async def test_success_merge(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager
    ):
        """Test successful worktree merge."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_worktree_manager.merge_worktree.return_value = True
        mock_worktree_manager.base_branch = "main"

        result = await handle_worktree_merge({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is True
        assert "message" in result["data"]
        assert result["data"]["conflicts"] == []
        mock_worktree_manager.merge_worktree.assert_called_once_with(
            "001-test-task",
            no_commit=False,
            base_branch=None
        )

    @pytest.mark.asyncio
    async def test_merge_with_no_commit(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager
    ):
        """Test merge with no_commit option (stage only)."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_worktree_manager.merge_worktree.return_value = True
        mock_worktree_manager.base_branch = "main"

        result = await handle_worktree_merge({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task",
            "noCommit": True,
        })

        assert result["success"] is True
        mock_worktree_manager.merge_worktree.assert_called_once_with(
            "001-test-task",
            no_commit=True,
            base_branch=None
        )

    @pytest.mark.asyncio
    async def test_merge_failed(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test merge failure (conflicts)."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_worktree_manager.merge_worktree.return_value = False

        # Mock git status to show conflicts
        mock_subprocess_run.return_value = MagicMock(
            returncode=0,
            stdout="UU conflicted.txt\n",
            stderr=""
        )

        result = await handle_worktree_merge({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is False
        assert "Merge conflicts detected" in result["error"]

    @pytest.mark.asyncio
    async def test_missing_task_id(self):
        """Test error when taskId is missing."""
        result = await handle_worktree_merge({"projectId": "test-project"})

        assert result["success"] is False
        assert "Missing required parameters (projectId, taskId)" in result["error"]

    @pytest.mark.asyncio
    async def test_exception_handling(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager
    ):
        """Test exception handling during merge."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_worktree_manager.merge_worktree.side_effect = Exception("Merge error")

        result = await handle_worktree_merge({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is False
        assert "Merge failed: Merge error" in result["error"]


# ==================== handle_worktree_discard Tests ====================


class TestHandleWorktreeDiscard:
    """Test handle_worktree_discard handler."""

    @pytest.mark.asyncio
    async def test_success_discard(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test successful worktree discard."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info

        # Mock git reset --hard and git clean
        mock_subprocess_run.side_effect = [
            MagicMock(returncode=0, stdout="", stderr=""),  # git reset --hard
            MagicMock(returncode=0, stdout="", stderr=""),  # git clean -fd
        ]

        result = await handle_worktree_discard({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is True
        assert result["data"]["discarded"] is True

    @pytest.mark.asyncio
    async def test_missing_task_id(self):
        """Test error when taskId is missing."""
        result = await handle_worktree_discard({"projectId": "test-project"})

        assert result["success"] is False
        assert "Missing required parameters (projectId, taskId)" in result["error"]

    @pytest.mark.asyncio
    async def test_exception_handling(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager
    ):
        """Test exception handling during discard."""
        mock_worktree_manager.get_worktree_info.side_effect = Exception("Discard error")

        result = await handle_worktree_discard({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is False
        assert "Failed to discard worktree changes: Discard error" in result["error"]


# ==================== handle_clear_staged_state Tests ====================


class TestHandleClearStagedState:
    """Test handle_clear_staged_state handler."""

    @pytest.mark.asyncio
    async def test_success_clear_staged(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test successfully clearing staged changes."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_subprocess_run.return_value = MagicMock(
            returncode=0,
            stdout="",
            stderr="",
        )

        result = await handle_clear_staged_state({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is True
        assert result["data"]["cleared"] is True

    @pytest.mark.asyncio
    async def test_no_worktree(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager
    ):
        """Test clearing staged state when no worktree exists."""
        mock_worktree_manager.get_worktree_info.return_value = None

        result = await handle_clear_staged_state({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is False
        assert "No worktree found for task" in result["error"]

    @pytest.mark.asyncio
    async def test_git_reset_failure(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test handling of git reset failure."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_subprocess_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="fatal: Failed to resolve 'HEAD' as a valid ref.",
        )

        result = await handle_clear_staged_state({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })

        assert result["success"] is False
        assert "Failed to clear staged state" in result["error"]

    @pytest.mark.asyncio
    async def test_missing_task_id(self):
        """Test error when taskId is missing."""
        result = await handle_clear_staged_state({"projectId": "test-project"})

        assert result["success"] is False
        assert "Missing required parameters (projectId, taskId)" in result["error"]


# ==================== handle_list_worktrees Tests ====================


class TestHandleListWorktrees:
    """Test handle_list_worktrees handler."""

    @pytest.mark.asyncio
    async def test_success_with_worktrees(
        self, mock_get_project_path, mock_worktree_manager, mock_subprocess_run
    ):
        """Test listing multiple worktrees."""
        worktree1 = WorktreeInfo(
            path=Path("/fake/worktree/path1"),
            branch="auto-claude/001-task-one",
            spec_name="001-task-one",
            base_branch="main",
            commit_count=5,
            files_changed=10,
        )
        worktree2 = WorktreeInfo(
            path=Path("/fake/worktree/path2"),
            branch="auto-claude/002-task-two",
            spec_name="002-task-two",
            base_branch="main",
            commit_count=2,
            files_changed=3,
        )
        mock_worktree_manager.list_all_worktrees.return_value = [worktree1, worktree2]
        mock_worktree_manager.get_changed_files.side_effect = [
            ["file1.txt"] * 10,  # 10 files for first worktree
            ["file2.txt"] * 3,   # 3 files for second worktree
        ]
        mock_worktree_manager.base_branch = "main"

        # Mock git rev-list commands for commit count
        mock_subprocess_run.side_effect = [
            MagicMock(returncode=0, stdout="5\n", stderr=""),  # First worktree commit count
            MagicMock(returncode=0, stdout="2\n", stderr=""),  # Second worktree commit count
        ]

        result = await handle_list_worktrees({"projectId": "test-project"})

        assert result["success"] is True
        assert len(result["data"]["worktrees"]) == 2
        assert result["data"]["worktrees"][0]["specName"] == "001-task-one"
        assert result["data"]["worktrees"][0]["branch"] == "auto-claude/001-task-one"
        assert result["data"]["worktrees"][0]["filesChanged"] == 10
        assert result["data"]["worktrees"][1]["specName"] == "002-task-two"

    @pytest.mark.asyncio
    async def test_success_no_worktrees(
        self, mock_get_project_path, mock_worktree_manager
    ):
        """Test listing when no worktrees exist."""
        mock_worktree_manager.list_all_worktrees.return_value = []

        result = await handle_list_worktrees({"projectId": "test-project"})

        assert result["success"] is True
        assert result["data"]["worktrees"] == []

    @pytest.mark.asyncio
    async def test_missing_project_id(self):
        """Test error when projectId is missing."""
        result = await handle_list_worktrees({})

        assert result["success"] is False
        assert "Missing required parameter (projectId)" in result["error"]

    @pytest.mark.asyncio
    async def test_exception_handling(
        self, mock_get_project_path, mock_worktree_manager
    ):
        """Test exception handling during list."""
        mock_worktree_manager.list_all_worktrees.side_effect = Exception("List error")

        result = await handle_list_worktrees({"projectId": "test-project"})

        assert result["success"] is False
        assert "Failed to list worktrees: List error" in result["error"]


# ==================== Integration Tests ====================


class TestWorktreeHandlersIntegration:
    """Integration tests for worktree handlers."""

    @pytest.mark.asyncio
    async def test_full_worktree_workflow(
        self, mock_get_project_path, mock_parse_task_id, mock_worktree_manager, mock_subprocess_run
    ):
        """Test complete worktree workflow: status -> diff -> merge_preview -> merge."""
        worktree_info = WorktreeInfo(
            path=Path("/fake/worktree/path"),
            branch="auto-claude/001-test-task",
            spec_name="001-test-task",
            base_branch="main",
            commit_count=3,
            files_changed=5,
        )
        mock_worktree_manager.get_worktree_info.return_value = worktree_info
        mock_worktree_manager.merge_worktree.return_value = True
        mock_worktree_manager.base_branch = "main"

        # Setup sequential mock calls for different operations
        mock_subprocess_run.side_effect = [
            # handle_worktree_status: git status + git rev-list
            MagicMock(returncode=0, stdout="", stderr=""),  # git status (clean)
            MagicMock(returncode=0, stdout="3\n", stderr=""),  # git rev-list
            # handle_worktree_diff: git diff
            MagicMock(returncode=0, stdout="diff output", stderr=""),
            # handle_worktree_merge_preview: git merge + git status + git merge --abort
            MagicMock(returncode=0, stdout="", stderr=""),  # git merge
            MagicMock(returncode=0, stdout="", stderr=""),  # git status
            MagicMock(returncode=0, stdout="", stderr=""),  # git merge --abort
        ]

        # 1. Check status
        status_result = await handle_worktree_status({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })
        assert status_result["success"] is True
        assert status_result["data"]["exists"] is True

        # 2. Get diff
        diff_result = await handle_worktree_diff({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })
        assert diff_result["success"] is True
        assert diff_result["data"]["diff"] == "diff output"

        # 3. Merge preview
        preview_result = await handle_worktree_merge_preview({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })
        assert preview_result["success"] is True
        assert preview_result["data"]["hasConflicts"] is False

        # 4. Merge
        merge_result = await handle_worktree_merge({
            "projectId": "test-project",
            "taskId": "test-project:001-test-task"
        })
        assert merge_result["success"] is True
        assert merge_result["data"]["conflicts"] == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
