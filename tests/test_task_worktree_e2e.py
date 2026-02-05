"""
E2E Tests for Task Worktree Handlers
=====================================

Tests worktree handlers with real git repositories and WorktreeManager.
"""

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from apps.backend.core.worktree import WorktreeManager, WorktreeInfo
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
def temp_git_repo():
    """Create a temporary git repository for testing."""
    temp_dir = Path(tempfile.mkdtemp())

    try:
        # Initialize git repo
        subprocess.run(["git", "init"], cwd=temp_dir, check=True, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=temp_dir,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=temp_dir,
            check=True,
            capture_output=True,
        )

        # Create initial commit on main branch
        test_file = temp_dir / "README.md"
        test_file.write_text("# Test Project\n")
        subprocess.run(["git", "add", "."], cwd=temp_dir, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Initial commit"],
            cwd=temp_dir,
            check=True,
            capture_output=True,
        )

        # Rename to main if needed
        subprocess.run(
            ["git", "branch", "-M", "main"],
            cwd=temp_dir,
            check=True,
            capture_output=True,
        )

        yield temp_dir
    finally:
        # Cleanup
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


@pytest.fixture
def worktree_manager(temp_git_repo):
    """Create a WorktreeManager instance for testing."""
    manager = WorktreeManager(temp_git_repo, base_branch="main")
    manager.setup()
    yield manager

    # Cleanup worktrees
    try:
        manager.cleanup_all()
    except Exception:
        pass


@pytest.fixture
def mock_get_project_path(temp_git_repo):
    """Mock get_project_path to return the temp repo."""
    with patch("apps.backend.web.ws.handlers.task_worktree.get_project_path") as mock:
        mock.return_value = temp_git_repo
        yield mock


@pytest.fixture
def mock_parse_task_id():
    """Mock parse_task_id for E2E tests."""
    with patch("apps.backend.web.ws.handlers.task_worktree.parse_task_id") as mock:
        mock.return_value = ("test-project", "001-test-task")
        yield mock


# ==================== E2E Test Cases ====================


class TestWorktreeHandlersE2E:
    """E2E tests for worktree handlers with real git operations."""

    @pytest.mark.asyncio
    async def test_full_worktree_lifecycle(
        self, temp_git_repo, worktree_manager, mock_get_project_path, mock_parse_task_id
    ):
        """Test complete worktree lifecycle: create -> status -> diff -> merge -> discard."""
        spec_name = "001-test-task"

        # Step 1: Create worktree
        worktree_info = worktree_manager.create_worktree(spec_name)
        assert worktree_info.path.exists()
        assert worktree_info.branch == "auto-claude/001-test-task"

        # Step 2: Check status (should be clean initially)
        status_result = await handle_worktree_status({"taskId": "test-project:001-test-task"})
        assert status_result["success"] is True
        assert status_result["data"]["hasWorktree"] is True
        assert status_result["data"]["branch"] == "auto-claude/001-test-task"
        assert status_result["data"]["hasUncommittedChanges"] is False

        # Step 3: Make changes in worktree
        test_file = worktree_info.path / "feature.txt"
        test_file.write_text("New feature implementation\n")
        subprocess.run(["git", "add", "."], cwd=worktree_info.path, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add feature"],
            cwd=worktree_info.path,
            check=True,
            capture_output=True,
        )

        # Step 4: Check status (should have committed changes)
        status_result = await handle_worktree_status({"taskId": "test-project:001-test-task"})
        assert status_result["success"] is True
        assert status_result["data"]["commitCount"] > 0

        # Step 5: Get diff
        diff_result = await handle_worktree_diff({"taskId": "test-project:001-test-task"})
        assert diff_result["success"] is True
        assert diff_result["data"]["hasChanges"] is True
        assert "feature.txt" in diff_result["data"]["diff"]

        # Step 6: Merge preview (should have no conflicts)
        preview_result = await handle_worktree_merge_preview({"taskId": "test-project:001-test-task"})
        assert preview_result["success"] is True
        assert preview_result["data"]["hasConflicts"] is False

        # Step 7: Merge worktree
        merge_result = await handle_worktree_merge({"taskId": "test-project:001-test-task"})
        assert merge_result["success"] is True
        assert merge_result["data"]["merged"] is True

        # Verify merge: feature.txt should exist in main branch
        main_feature_file = temp_git_repo / "feature.txt"
        assert main_feature_file.exists()
        assert "New feature implementation" in main_feature_file.read_text()

        # Step 8: Discard worktree
        discard_result = await handle_worktree_discard({"taskId": "test-project:001-test-task"})
        assert discard_result["success"] is True

        # Verify worktree is gone
        assert not worktree_info.path.exists()

    @pytest.mark.asyncio
    async def test_worktree_status_with_uncommitted_changes(
        self, temp_git_repo, worktree_manager, mock_get_project_path, mock_parse_task_id
    ):
        """Test status detection of uncommitted changes."""
        spec_name = "001-test-task"
        worktree_info = worktree_manager.create_worktree(spec_name)

        # Make uncommitted change
        test_file = worktree_info.path / "uncommitted.txt"
        test_file.write_text("Uncommitted content\n")

        status_result = await handle_worktree_status({"taskId": "test-project:001-test-task"})
        assert status_result["success"] is True
        assert status_result["data"]["hasUncommittedChanges"] is True

    @pytest.mark.asyncio
    async def test_worktree_diff_empty(
        self, temp_git_repo, worktree_manager, mock_get_project_path, mock_parse_task_id
    ):
        """Test diff when no changes have been made."""
        spec_name = "001-test-task"
        worktree_manager.create_worktree(spec_name)

        diff_result = await handle_worktree_diff({"taskId": "test-project:001-test-task"})
        assert diff_result["success"] is True
        assert diff_result["data"]["hasChanges"] is False
        assert diff_result["data"]["diff"] == ""

    @pytest.mark.asyncio
    async def test_worktree_merge_with_no_commit(
        self, temp_git_repo, worktree_manager, mock_get_project_path, mock_parse_task_id
    ):
        """Test merge with noCommit flag (stage changes only)."""
        spec_name = "001-test-task"
        worktree_info = worktree_manager.create_worktree(spec_name)

        # Make and commit changes
        test_file = worktree_info.path / "staged.txt"
        test_file.write_text("Staged content\n")
        subprocess.run(["git", "add", "."], cwd=worktree_info.path, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add staged file"],
            cwd=worktree_info.path,
            check=True,
            capture_output=True,
        )

        # Merge with no_commit
        merge_result = await handle_worktree_merge({
            "taskId": "test-project:001-test-task",
            "noCommit": True,
        })
        assert merge_result["success"] is True

        # Verify changes are staged but not committed
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            cwd=temp_git_repo,
            check=True,
            capture_output=True,
            text=True,
        )
        assert "staged.txt" in result.stdout

    @pytest.mark.asyncio
    async def test_worktree_discard_preserve_branch(
        self, temp_git_repo, worktree_manager, mock_get_project_path, mock_parse_task_id
    ):
        """Test discard worktree but preserve branch."""
        spec_name = "001-test-task"
        worktree_info = worktree_manager.create_worktree(spec_name)
        branch_name = worktree_info.branch

        # Discard with preserveBranch
        discard_result = await handle_worktree_discard({
            "taskId": "test-project:001-test-task",
            "preserveBranch": True,
        })
        assert discard_result["success"] is True

        # Verify worktree is gone
        assert not worktree_info.path.exists()

        # Verify branch still exists
        result = subprocess.run(
            ["git", "branch", "--list", branch_name],
            cwd=temp_git_repo,
            check=True,
            capture_output=True,
            text=True,
        )
        assert branch_name in result.stdout

    @pytest.mark.asyncio
    async def test_clear_staged_state(
        self, temp_git_repo, worktree_manager, mock_get_project_path, mock_parse_task_id
    ):
        """Test clearing staged changes in worktree."""
        spec_name = "001-test-task"
        worktree_info = worktree_manager.create_worktree(spec_name)

        # Create and stage a file
        test_file = worktree_info.path / "staged.txt"
        test_file.write_text("Staged content\n")
        subprocess.run(["git", "add", "."], cwd=worktree_info.path, check=True, capture_output=True)

        # Verify file is staged
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            cwd=worktree_info.path,
            check=True,
            capture_output=True,
            text=True,
        )
        assert "staged.txt" in result.stdout

        # Clear staged state
        clear_result = await handle_clear_staged_state({"taskId": "test-project:001-test-task"})
        assert clear_result["success"] is True

        # Verify staging area is cleared
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            cwd=worktree_info.path,
            check=True,
            capture_output=True,
            text=True,
        )
        assert result.stdout.strip() == ""

    @pytest.mark.asyncio
    async def test_list_worktrees_multiple(
        self, temp_git_repo, worktree_manager, mock_get_project_path
    ):
        """Test listing multiple worktrees."""
        # Create multiple worktrees
        worktree_manager.create_worktree("001-first-task")
        worktree_manager.create_worktree("002-second-task")
        worktree_manager.create_worktree("003-third-task")

        list_result = await handle_list_worktrees({"projectId": "test-project"})
        assert list_result["success"] is True
        assert len(list_result["data"]["worktrees"]) == 3

        # Verify worktree details
        spec_names = [w["specName"] for w in list_result["data"]["worktrees"]]
        assert "001-first-task" in spec_names
        assert "002-second-task" in spec_names
        assert "003-third-task" in spec_names

    @pytest.mark.asyncio
    async def test_list_worktrees_empty(
        self, temp_git_repo, worktree_manager, mock_get_project_path
    ):
        """Test listing when no worktrees exist."""
        list_result = await handle_list_worktrees({"projectId": "test-project"})
        assert list_result["success"] is True
        assert list_result["data"]["worktrees"] == []

    @pytest.mark.asyncio
    async def test_worktree_merge_conflicts(
        self, temp_git_repo, worktree_manager, mock_get_project_path, mock_parse_task_id
    ):
        """Test merge preview and merge with conflicts."""
        spec_name = "001-test-task"
        worktree_info = worktree_manager.create_worktree(spec_name)

        # Modify same file in both main and worktree
        main_file = temp_git_repo / "README.md"
        main_file.write_text("# Main Branch Change\n")
        subprocess.run(["git", "add", "."], cwd=temp_git_repo, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Update README in main"],
            cwd=temp_git_repo,
            check=True,
            capture_output=True,
        )

        worktree_file = worktree_info.path / "README.md"
        worktree_file.write_text("# Worktree Branch Change\n")
        subprocess.run(["git", "add", "."], cwd=worktree_info.path, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Update README in worktree"],
            cwd=worktree_info.path,
            check=True,
            capture_output=True,
        )

        # Merge preview should detect conflicts
        preview_result = await handle_worktree_merge_preview({"taskId": "test-project:001-test-task"})
        assert preview_result["success"] is True
        assert preview_result["data"]["hasConflicts"] is True

        # Merge should fail
        merge_result = await handle_worktree_merge({"taskId": "test-project:001-test-task"})
        assert merge_result["success"] is False

    @pytest.mark.asyncio
    async def test_worktree_operations_on_nonexistent_worktree(
        self, temp_git_repo, mock_get_project_path, mock_parse_task_id
    ):
        """Test handlers with non-existent worktree."""
        # Status should report no worktree
        status_result = await handle_worktree_status({"taskId": "test-project:999-nonexistent"})
        assert status_result["success"] is True
        assert status_result["data"]["hasWorktree"] is False

        # Diff should fail
        diff_result = await handle_worktree_diff({"taskId": "test-project:999-nonexistent"})
        assert diff_result["success"] is False

        # Merge preview should fail
        preview_result = await handle_worktree_merge_preview({"taskId": "test-project:999-nonexistent"})
        assert preview_result["success"] is False

    @pytest.mark.asyncio
    async def test_worktree_merge_delete_after(
        self, temp_git_repo, worktree_manager, mock_get_project_path, mock_parse_task_id
    ):
        """Test merge with deleteAfter flag."""
        spec_name = "001-test-task"
        worktree_info = worktree_manager.create_worktree(spec_name)

        # Make changes
        test_file = worktree_info.path / "feature.txt"
        test_file.write_text("Feature content\n")
        subprocess.run(["git", "add", "."], cwd=worktree_info.path, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add feature"],
            cwd=worktree_info.path,
            check=True,
            capture_output=True,
        )

        # Merge with deleteAfter
        merge_result = await handle_worktree_merge({
            "taskId": "test-project:001-test-task",
            "deleteAfter": True,
        })
        assert merge_result["success"] is True

        # Verify worktree is removed
        assert not worktree_info.path.exists()

        # Verify branch is removed
        result = subprocess.run(
            ["git", "branch", "--list", "auto-claude/001-test-task"],
            cwd=temp_git_repo,
            check=True,
            capture_output=True,
            text=True,
        )
        assert "auto-claude/001-test-task" not in result.stdout


class TestWorktreeHandlersEdgeCases:
    """Test edge cases and error conditions."""

    @pytest.mark.asyncio
    async def test_invalid_project_path(self, mock_parse_task_id):
        """Test handlers with invalid project path."""
        with patch("apps.backend.web.ws.handlers.task_worktree.get_project_path") as mock:
            mock.return_value = Path("/nonexistent/path")

            # Should handle gracefully
            result = await handle_worktree_status({"taskId": "test-project:001-test-task"})
            assert result["success"] is False or result["data"]["hasWorktree"] is False

    @pytest.mark.asyncio
    async def test_concurrent_worktree_operations(
        self, temp_git_repo, worktree_manager, mock_get_project_path, mock_parse_task_id
    ):
        """Test handling of concurrent worktree operations."""
        import asyncio

        spec_name = "001-test-task"
        worktree_manager.create_worktree(spec_name)

        # Run multiple status checks concurrently
        tasks = [
            handle_worktree_status({"taskId": "test-project:001-test-task"})
            for _ in range(5)
        ]
        results = await asyncio.gather(*tasks)

        # All should succeed
        for result in results:
            assert result["success"] is True
            assert result["data"]["hasWorktree"] is True

    @pytest.mark.asyncio
    async def test_worktree_with_gitignored_files(
        self, temp_git_repo, worktree_manager, mock_get_project_path, mock_parse_task_id
    ):
        """Test worktree operations with .gitignore files."""
        spec_name = "001-test-task"
        worktree_info = worktree_manager.create_worktree(spec_name)

        # Create .gitignore
        gitignore = worktree_info.path / ".gitignore"
        gitignore.write_text("*.log\n*.tmp\n")

        # Create ignored file
        ignored_file = worktree_info.path / "test.log"
        ignored_file.write_text("Log content\n")

        # Create tracked file
        tracked_file = worktree_info.path / "feature.txt"
        tracked_file.write_text("Feature content\n")

        subprocess.run(["git", "add", "."], cwd=worktree_info.path, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Add files"],
            cwd=worktree_info.path,
            check=True,
            capture_output=True,
        )

        # Diff should only show tracked file
        diff_result = await handle_worktree_diff({"taskId": "test-project:001-test-task"})
        assert diff_result["success"] is True
        assert "feature.txt" in diff_result["data"]["diff"]
        assert "test.log" not in diff_result["data"]["diff"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
