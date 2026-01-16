#!/usr/bin/env python3
"""
Git Worktree Manager - Per-Spec Architecture
=============================================

Each spec gets its own worktree:
- Worktree path: .auto-claude/worktrees/tasks/{spec-name}/
- Branch name: auto-claude/{spec-name}

This allows:
1. Multiple specs to be worked on simultaneously
2. Each spec's changes are isolated
3. Branches persist until explicitly merged
4. Clear 1:1:1 mapping: spec → worktree → branch
"""

import asyncio
import os
import re
import shutil
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from core.git_executable import run_git


class WorktreeError(Exception):
    """Error during worktree operations."""

    pass


@dataclass
class WorktreeInfo:
    """Information about a spec's worktree."""

    path: Path
    branch: str
    spec_name: str
    base_branch: str
    is_active: bool = True
    commit_count: int = 0
    files_changed: int = 0
    additions: int = 0
    deletions: int = 0
    last_commit_date: datetime | None = None
    days_since_last_commit: int | None = None


class WorktreeManager:
    """
    Manages per-spec Git worktrees.

    Each spec gets its own worktree in .auto-claude/worktrees/tasks/{spec-name}/ with
    a corresponding branch auto-claude/{spec-name}.
    """

    # Timeout constants for subprocess operations
    GIT_PUSH_TIMEOUT = 120  # 2 minutes for git push (network operations)
    GH_CLI_TIMEOUT = 60  # 1 minute for gh CLI commands
    GH_QUERY_TIMEOUT = 30  # 30 seconds for gh CLI queries

    def __init__(self, project_dir: Path, base_branch: str | None = None):
        self.project_dir = project_dir
        self.base_branch = base_branch or self._detect_base_branch()
        self.worktrees_dir = project_dir / ".auto-claude" / "worktrees" / "tasks"
        self._merge_lock = asyncio.Lock()

    def _detect_base_branch(self) -> str:
        """
        Detect the base branch for worktree creation.

        Priority order:
        1. DEFAULT_BRANCH environment variable
        2. Current branch if it's not main/master
        3. Auto-detect main/master (if they exist)
        4. Fall back to current branch

        Returns:
            The detected base branch name
        """
        # 1. Check for DEFAULT_BRANCH env var
        env_branch = os.getenv("DEFAULT_BRANCH")
        if env_branch:
            # Verify the branch exists
            result = run_git(
                ["rev-parse", "--verify", env_branch],
                cwd=self.project_dir,
            )
            if result.returncode == 0:
                return env_branch
            else:
                print(
                    f"Warning: DEFAULT_BRANCH '{env_branch}' not found, auto-detecting..."
                )

        # 2. Prefer current branch if it's not main/master
        current = self._get_current_branch()
        if current not in {"main", "master"}:
            return current

        # 3. Auto-detect main/master
        for branch in ["main", "master"]:
            result = run_git(
                ["rev-parse", "--verify", branch],
                cwd=self.project_dir,
            )
            if result.returncode == 0:
                return branch

        # 4. Fall back to current branch
        print("Warning: Could not find 'main' or 'master' branch.")
        print(f"Warning: Using current branch '{current}' as base for worktree.")
        print("Tip: Set DEFAULT_BRANCH=your-branch in .env to avoid this.")
        return current

    def _get_current_branch(self) -> str:
        """Get the current git branch."""
        result = run_git(
            ["rev-parse", "--abbrev-ref", "HEAD"],
            cwd=self.project_dir,
        )
        if result.returncode != 0:
            raise WorktreeError(f"Failed to get current branch: {result.stderr}")
        return result.stdout.strip()

    def _run_git(
        self, args: list[str], cwd: Path | None = None, timeout: int = 60
    ) -> subprocess.CompletedProcess:
        """Run a git command and return the result.

        Args:
            args: Git command arguments (without 'git' prefix)
            cwd: Working directory for the command
            timeout: Command timeout in seconds (default: 60)

        Returns:
            CompletedProcess with command results. On timeout, returns a
            CompletedProcess with returncode=-1 and timeout error in stderr.
        """
        return run_git(args, cwd=cwd or self.project_dir, timeout=timeout)

    def _unstage_gitignored_files(self) -> None:
        """
        Unstage any staged files that are gitignored in the current branch,
        plus any files in the .auto-claude directory which should never be merged.

        This is needed after a --no-commit merge because files that exist in the
        source branch (like spec files in .auto-claude/specs/) get staged even if
        they're gitignored in the target branch.
        """
        # Get list of staged files
        result = self._run_git(["diff", "--cached", "--name-only"])
        if result.returncode != 0 or not result.stdout.strip():
            return

        staged_files = result.stdout.strip().split("\n")

        # Files to unstage: gitignored files + .auto-claude directory files
        files_to_unstage = set()

        # 1. Check which staged files are gitignored
        # git check-ignore returns the files that ARE ignored
        result = run_git(
            ["check-ignore", "--stdin"],
            cwd=self.project_dir,
            input_data="\n".join(staged_files),
        )

        if result.stdout.strip():
            for file in result.stdout.strip().split("\n"):
                if file.strip():
                    files_to_unstage.add(file.strip())

        # 2. Always unstage .auto-claude directory files - these are project-specific
        # and should never be merged from the worktree branch
        auto_claude_patterns = [".auto-claude/", "auto-claude/specs/"]
        for file in staged_files:
            file = file.strip()
            if not file:
                continue
            # Normalize path separators for cross-platform (Windows backslash support)
            normalized = file.replace("\\", "/")
            for pattern in auto_claude_patterns:
                if normalized.startswith(pattern) or f"/{pattern}" in normalized:
                    files_to_unstage.add(file)
                    break

        if files_to_unstage:
            print(
                f"Unstaging {len(files_to_unstage)} auto-claude/gitignored file(s)..."
            )
            # Unstage each file
            for file in files_to_unstage:
                self._run_git(["reset", "HEAD", "--", file])

    def setup(self) -> None:
        """Create worktrees directory if needed."""
        self.worktrees_dir.mkdir(parents=True, exist_ok=True)

    # ==================== Per-Spec Worktree Methods ====================

    def get_worktree_path(self, spec_name: str) -> Path:
        """Get the worktree path for a spec."""
        return self.worktrees_dir / spec_name

    def get_branch_name(self, spec_name: str) -> str:
        """Get the branch name for a spec."""
        return f"auto-claude/{spec_name}"

    def worktree_exists(self, spec_name: str) -> bool:
        """Check if a worktree exists for a spec."""
        return self.get_worktree_path(spec_name).exists()

    def get_worktree_info(self, spec_name: str) -> WorktreeInfo | None:
        """Get info about a spec's worktree."""
        worktree_path = self.get_worktree_path(spec_name)
        if not worktree_path.exists():
            return None

        # Verify the branch exists in the worktree
        result = self._run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=worktree_path)
        if result.returncode != 0:
            return None

        actual_branch = result.stdout.strip()

        # Get statistics
        stats = self._get_worktree_stats(spec_name)

        return WorktreeInfo(
            path=worktree_path,
            branch=actual_branch,
            spec_name=spec_name,
            base_branch=self.base_branch,
            is_active=True,
            **stats,
        )

    def _check_branch_namespace_conflict(self) -> str | None:
        """
        Check if a branch named 'auto-claude' exists, which would block creating
        branches in the 'auto-claude/*' namespace.

        Git stores branch refs as files under .git/refs/heads/, so a branch named
        'auto-claude' creates a file that prevents creating the 'auto-claude/'
        directory needed for 'auto-claude/{spec-name}' branches.

        Returns:
            The conflicting branch name if found, None otherwise.
        """
        result = self._run_git(["rev-parse", "--verify", "auto-claude"])
        if result.returncode == 0:
            return "auto-claude"
        return None

    def _get_worktree_stats(self, spec_name: str) -> dict:
        """Get diff statistics for a worktree."""
        worktree_path = self.get_worktree_path(spec_name)

        stats = {
            "commit_count": 0,
            "files_changed": 0,
            "additions": 0,
            "deletions": 0,
            "last_commit_date": None,
            "days_since_last_commit": None,
        }

        if not worktree_path.exists():
            return stats

        # Commit count
        result = self._run_git(
            ["rev-list", "--count", f"{self.base_branch}..HEAD"], cwd=worktree_path
        )
        if result.returncode == 0:
            stats["commit_count"] = int(result.stdout.strip() or "0")

        # Last commit date (most recent commit in this worktree)
        result = self._run_git(
            ["log", "-1", "--format=%cd", "--date=iso"], cwd=worktree_path
        )
        if result.returncode == 0 and result.stdout.strip():
            try:
                # Parse ISO date format: "2026-01-04 00:25:25 +0100"
                date_str = result.stdout.strip()
                # Convert git format to ISO format for fromisoformat()
                # "2026-01-04 00:25:25 +0100" -> "2026-01-04T00:25:25+01:00"
                parts = date_str.rsplit(" ", 1)
                if len(parts) == 2:
                    date_part, tz_part = parts
                    # Convert timezone format: "+0100" -> "+01:00"
                    if len(tz_part) == 5 and (
                        tz_part.startswith("+") or tz_part.startswith("-")
                    ):
                        tz_formatted = f"{tz_part[:3]}:{tz_part[3:]}"
                        iso_str = f"{date_part.replace(' ', 'T')}{tz_formatted}"
                        last_commit_date = datetime.fromisoformat(iso_str)
                        stats["last_commit_date"] = last_commit_date
                        # Use timezone-aware now() for accurate comparison
                        now_aware = datetime.now(last_commit_date.tzinfo)
                        stats["days_since_last_commit"] = (
                            now_aware - last_commit_date
                        ).days
                    else:
                        # Fallback for unexpected timezone format
                        last_commit_date = datetime.strptime(
                            parts[0], "%Y-%m-%d %H:%M:%S"
                        )
                        stats["last_commit_date"] = last_commit_date
                        stats["days_since_last_commit"] = (
                            datetime.now() - last_commit_date
                        ).days
                else:
                    # No timezone in output
                    last_commit_date = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
                    stats["last_commit_date"] = last_commit_date
                    stats["days_since_last_commit"] = (
                        datetime.now() - last_commit_date
                    ).days
            except (ValueError, TypeError) as e:
                # If parsing fails, silently continue without date info
                pass

        # Diff stats
        result = self._run_git(
            ["diff", "--shortstat", f"{self.base_branch}...HEAD"], cwd=worktree_path
        )
        if result.returncode == 0 and result.stdout.strip():
            # Parse: "3 files changed, 50 insertions(+), 10 deletions(-)"
            match = re.search(r"(\d+) files? changed", result.stdout)
            if match:
                stats["files_changed"] = int(match.group(1))
            match = re.search(r"(\d+) insertions?", result.stdout)
            if match:
                stats["additions"] = int(match.group(1))
            match = re.search(r"(\d+) deletions?", result.stdout)
            if match:
                stats["deletions"] = int(match.group(1))

        return stats

    def create_worktree(self, spec_name: str) -> WorktreeInfo:
        """
        Create a worktree for a spec.

        Args:
            spec_name: The spec folder name (e.g., "002-implement-memory")

        Returns:
            WorktreeInfo for the created worktree

        Raises:
            WorktreeError: If a branch namespace conflict exists or worktree creation fails
        """
        worktree_path = self.get_worktree_path(spec_name)
        branch_name = self.get_branch_name(spec_name)

        # Check for branch namespace conflict (e.g., 'auto-claude' blocking 'auto-claude/*')
        conflicting_branch = self._check_branch_namespace_conflict()
        if conflicting_branch:
            raise WorktreeError(
                f"Branch '{conflicting_branch}' exists and blocks creating '{branch_name}'.\n"
                f"\n"
                f"Git branch names work like file paths - a branch named 'auto-claude' prevents\n"
                f"creating branches under 'auto-claude/' (like 'auto-claude/{spec_name}').\n"
                f"\n"
                f"Fix: Rename the conflicting branch:\n"
                f"  git branch -m {conflicting_branch} {conflicting_branch}-backup"
            )

        # Remove existing if present (from crashed previous run)
        if worktree_path.exists():
            self._run_git(["worktree", "remove", "--force", str(worktree_path)])

        # Delete branch if it exists (from previous attempt)
        self._run_git(["branch", "-D", branch_name])

        # Fetch latest from remote to ensure we have the most up-to-date code
        # GitHub/remote is the source of truth, not the local branch
        fetch_result = self._run_git(["fetch", "origin", self.base_branch])
        if fetch_result.returncode != 0:
            print(
                f"Warning: Could not fetch {self.base_branch} from origin: {fetch_result.stderr}"
            )
            print("Falling back to local branch...")

        # Determine the start point for the worktree
        # Prefer origin/{base_branch} (remote) over local branch to ensure we have latest code
        remote_ref = f"origin/{self.base_branch}"
        start_point = self.base_branch  # Default to local branch

        # Check if remote ref exists and use it as the source of truth
        check_remote = self._run_git(["rev-parse", "--verify", remote_ref])
        if check_remote.returncode == 0:
            start_point = remote_ref
            print(f"Creating worktree from remote: {remote_ref}")
        else:
            print(
                f"Remote ref {remote_ref} not found, using local branch: {self.base_branch}"
            )

        # Create worktree with new branch from the start point (remote preferred)
        result = self._run_git(
            ["worktree", "add", "-b", branch_name, str(worktree_path), start_point]
        )

        if result.returncode != 0:
            raise WorktreeError(
                f"Failed to create worktree for {spec_name}: {result.stderr}"
            )

        print(f"Created worktree: {worktree_path.name} on branch {branch_name}")

        return WorktreeInfo(
            path=worktree_path,
            branch=branch_name,
            spec_name=spec_name,
            base_branch=self.base_branch,
            is_active=True,
        )

    def get_or_create_worktree(self, spec_name: str) -> WorktreeInfo:
        """
        Get existing worktree or create a new one for a spec.

        Args:
            spec_name: The spec folder name

        Returns:
            WorktreeInfo for the worktree
        """
        existing = self.get_worktree_info(spec_name)
        if existing:
            print(f"Using existing worktree: {existing.path}")
            return existing

        return self.create_worktree(spec_name)

    def remove_worktree(self, spec_name: str, delete_branch: bool = False) -> None:
        """
        Remove a spec's worktree.

        Args:
            spec_name: The spec folder name
            delete_branch: Whether to also delete the branch
        """
        worktree_path = self.get_worktree_path(spec_name)
        branch_name = self.get_branch_name(spec_name)

        if worktree_path.exists():
            result = self._run_git(
                ["worktree", "remove", "--force", str(worktree_path)]
            )
            if result.returncode == 0:
                print(f"Removed worktree: {worktree_path.name}")
            else:
                print(f"Warning: Could not remove worktree: {result.stderr}")
                shutil.rmtree(worktree_path, ignore_errors=True)

        if delete_branch:
            self._run_git(["branch", "-D", branch_name])
            print(f"Deleted branch: {branch_name}")

        self._run_git(["worktree", "prune"])

    def merge_worktree(
        self,
        spec_name: str,
        delete_after: bool = False,
        no_commit: bool = False,
        base_branch: str | None = None,
    ) -> bool:
        """
        Merge a spec's worktree branch back to base branch.

        Args:
            spec_name: The spec folder name
            delete_after: Whether to remove worktree and branch after merge
            no_commit: If True, merge changes but don't commit (stage only for review)

        Returns:
            True if merge succeeded
        """
        info = self.get_worktree_info(spec_name)
        if not info:
            print(f"No worktree found for spec: {spec_name}")
            return False

        target_branch = base_branch or info.base_branch

        if no_commit:
            print(
                f"Merging {info.branch} into {target_branch} (staged, not committed)..."
            )
        else:
            print(f"Merging {info.branch} into {target_branch}...")

        # Switch to base branch in main project
        result = self._run_git(["checkout", self.base_branch])
        if result.returncode != 0:
            print(f"Error: Could not checkout base branch: {result.stderr}")
            return False

        # Merge the spec branch
        merge_args = ["merge", "--no-ff", info.branch]
        if no_commit:
            # --no-commit stages the merge but doesn't create the commit
            merge_args.append("--no-commit")
        else:
            merge_args.extend(["-m", f"auto-claude: Merge {info.branch} into {target_branch}"])

        result = self._run_git(merge_args)

        if result.returncode != 0:
            # Check if it's "already up to date" - not an error
            output = (result.stdout + result.stderr).lower()
            if "already up to date" in output or "already up-to-date" in output:
                print(f"Branch {info.branch} is already up to date.")
                if no_commit:
                    print("No changes to stage.")
                if delete_after:
                    self.remove_worktree(spec_name, delete_branch=True)
                return True
            # Check for actual conflicts
            if "conflict" in output:
                print("Merge conflict! Aborting merge...")
                self._run_git(["merge", "--abort"])
                return False
            # Other error - show details
            stderr_msg = (
                result.stderr[:200]
                if result.stderr
                else result.stdout[:200]
                if result.stdout
                else "<no output>"
            )
            print(f"Merge failed: {stderr_msg}")
            self._run_git(["merge", "--abort"])
            return False

        if no_commit:
            # Unstage any files that are gitignored in the main branch
            # These get staged during merge because they exist in the worktree branch
            self._unstage_gitignored_files()
            print(
                f"Changes from {info.branch} are now staged in your working directory."
            )
            print("Review the changes, then commit when ready:")
            print("  git commit -m 'your commit message'")
        else:
            print(f"Successfully merged {info.branch}")

        if delete_after:
            self.remove_worktree(spec_name, delete_branch=True)

        return True

    def commit_in_worktree(self, spec_name: str, message: str) -> bool:
        """Commit all changes in a spec's worktree."""
        worktree_path = self.get_worktree_path(spec_name)
        if not worktree_path.exists():
            return False

        self._run_git(["add", "."], cwd=worktree_path)
        result = self._run_git(["commit", "-m", message], cwd=worktree_path)

        if result.returncode == 0:
            return True
        elif "nothing to commit" in result.stdout + result.stderr:
            return True
        else:
            print(f"Commit failed: {result.stderr}")
            return False

    # ==================== Listing & Discovery ====================

    def list_all_worktrees(self) -> list[WorktreeInfo]:
        """List all spec worktrees (includes legacy .worktrees/ location)."""
        worktrees = []
        seen_specs = set()

        # Check new location first
        if self.worktrees_dir.exists():
            for item in self.worktrees_dir.iterdir():
                if item.is_dir():
                    info = self.get_worktree_info(item.name)
                    if info:
                        worktrees.append(info)
                        seen_specs.add(item.name)

        # Check legacy location (.worktrees/)
        legacy_dir = self.project_dir / ".worktrees"
        if legacy_dir.exists():
            for item in legacy_dir.iterdir():
                if item.is_dir() and item.name not in seen_specs:
                    info = self.get_worktree_info(item.name)
                    if info:
                        worktrees.append(info)

        return worktrees

    def list_all_spec_branches(self) -> list[str]:
        """List all auto-claude branches (even if worktree removed)."""
        result = self._run_git(["branch", "--list", "auto-claude/*"])
        if result.returncode != 0:
            return []

        branches = []
        for line in result.stdout.strip().split("\n"):
            branch = line.strip().lstrip("* ")
            if branch:
                branches.append(branch)

        return branches

    def get_changed_files(
        self, spec_name: str, base_branch: str | None = None
    ) -> list[tuple[str, str]]:
        """Get list of changed files in a spec's worktree."""
        worktree_path = self.get_worktree_path(spec_name)
        if not worktree_path.exists():
            return []

        diff_base = base_branch or self.base_branch
        result = self._run_git(
            ["diff", "--name-status", f"{diff_base}...HEAD"], cwd=worktree_path
        )

        files = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("\t", 1)
            if len(parts) == 2:
                files.append((parts[0], parts[1]))

        return files

    def get_change_summary(
        self, spec_name: str, base_branch: str | None = None
    ) -> dict:
        """Get a summary of changes in a worktree."""
        files = self.get_changed_files(spec_name, base_branch=base_branch)

        new_files = sum(1 for status, _ in files if status == "A")
        modified_files = sum(1 for status, _ in files if status == "M")
        deleted_files = sum(1 for status, _ in files if status == "D")

        return {
            "new_files": new_files,
            "modified_files": modified_files,
            "deleted_files": deleted_files,
        }

    def cleanup_all(self) -> None:
        """Remove all worktrees and their branches."""
        for worktree in self.list_all_worktrees():
            self.remove_worktree(worktree.spec_name, delete_branch=True)

    def cleanup_stale_worktrees(self) -> None:
        """Remove worktrees that aren't registered with git."""
        if not self.worktrees_dir.exists():
            return

        # Get list of registered worktrees
        result = self._run_git(["worktree", "list", "--porcelain"])
        registered_paths = set()
        for line in result.stdout.split("\n"):
            if line.startswith("worktree "):
                registered_paths.add(Path(line.split(" ", 1)[1]))

        # Remove unregistered directories
        for item in self.worktrees_dir.iterdir():
            if item.is_dir() and item not in registered_paths:
                print(f"Removing stale worktree directory: {item.name}")
                shutil.rmtree(item, ignore_errors=True)

        self._run_git(["worktree", "prune"])

    def get_test_commands(self, spec_name: str) -> list[str]:
        """Detect likely test/run commands for the project."""
        worktree_path = self.get_worktree_path(spec_name)
        commands = []

        if (worktree_path / "package.json").exists():
            commands.append("npm install && npm run dev")
            commands.append("npm test")

        if (worktree_path / "requirements.txt").exists():
            commands.append("pip install -r requirements.txt")

        if (worktree_path / "Cargo.toml").exists():
            commands.append("cargo run")
            commands.append("cargo test")

        if (worktree_path / "go.mod").exists():
            commands.append("go run .")
            commands.append("go test ./...")

        if not commands:
            commands.append("# Check the project's README for run instructions")

        return commands

    # ==================== Backward Compatibility ====================
    # These methods provide backward compatibility with the old single-worktree API

    def get_staging_path(self) -> Path | None:
        """
        Backward compatibility: Get path to any existing spec worktree.
        Prefer using get_worktree_path(spec_name) instead.
        """
        worktrees = self.list_all_worktrees()
        if worktrees:
            return worktrees[0].path
        return None

    def get_staging_info(self) -> WorktreeInfo | None:
        """
        Backward compatibility: Get info about any existing spec worktree.
        Prefer using get_worktree_info(spec_name) instead.
        """
        worktrees = self.list_all_worktrees()
        if worktrees:
            return worktrees[0]
        return None

    def merge_staging(self, delete_after: bool = True) -> bool:
        """
        Backward compatibility: Merge first found worktree.
        Prefer using merge_worktree(spec_name) instead.
        """
        worktrees = self.list_all_worktrees()
        if worktrees:
            return self.merge_worktree(worktrees[0].spec_name, delete_after)
        return False

    def remove_staging(self, delete_branch: bool = True) -> None:
        """
        Backward compatibility: Remove first found worktree.
        Prefer using remove_worktree(spec_name) instead.
        """
        worktrees = self.list_all_worktrees()
        if worktrees:
            self.remove_worktree(worktrees[0].spec_name, delete_branch)

    def get_or_create_staging(self, spec_name: str) -> WorktreeInfo:
        """
        Backward compatibility: Alias for get_or_create_worktree.
        """
        return self.get_or_create_worktree(spec_name)

    def staging_exists(self) -> bool:
        """
        Backward compatibility: Check if any spec worktree exists.
        Prefer using worktree_exists(spec_name) instead.
        """
        return len(self.list_all_worktrees()) > 0

    def commit_in_staging(self, message: str) -> bool:
        """
        Backward compatibility: Commit in first found worktree.
        Prefer using commit_in_worktree(spec_name, message) instead.
        """
        worktrees = self.list_all_worktrees()
        if worktrees:
            return self.commit_in_worktree(worktrees[0].spec_name, message)
        return False

    def has_uncommitted_changes(self, in_staging: bool = False) -> bool:
        """Check if there are uncommitted changes."""
        worktrees = self.list_all_worktrees()
        if in_staging and worktrees:
            cwd = worktrees[0].path
        else:
            cwd = None
        result = self._run_git(["status", "--porcelain"], cwd=cwd)
        return bool(result.stdout.strip())


# Keep STAGING_WORKTREE_NAME for backward compatibility in imports
STAGING_WORKTREE_NAME = "auto-claude"
