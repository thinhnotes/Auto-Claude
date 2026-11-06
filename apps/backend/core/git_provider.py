#!/usr/bin/env python3
"""
Git Provider Detection
======================

Utility to detect git hosting provider (GitHub, GitLab, or unknown) from git remote URLs.
Supports both SSH and HTTPS remote formats, and self-hosted GitLab instances.
"""

import re
from pathlib import Path

from .git_executable import run_git


def detect_git_provider(project_dir: str | Path, remote_name: str | None = None) -> str:
    """Detect the git hosting provider from the git remote URL.

    Args:
        project_dir: Path to the git repository
        remote_name: Name of the remote to check (defaults to "origin")

    Returns:
        'github' if GitHub remote detected
        'gitlab' if GitLab remote detected (cloud or self-hosted)
        'unknown' if no remote or unsupported provider

    Examples:
        >>> detect_git_provider('/path/to/repo')
        'github'  # for git@github.com:user/repo.git
        'gitlab'  # for git@gitlab.com:user/repo.git
        'gitlab'  # for https://gitlab.company.com/user/repo.git
        'unknown' # for no remote or other providers
    """
    try:
        # Get the remote URL (use specified remote or default to origin)
        remote = remote_name if remote_name else "origin"
        result = run_git(
            ["remote", "get-url", remote],
            cwd=project_dir,
            timeout=5,
        )

        # If command failed or no output, return unknown
        if result.returncode != 0 or not result.stdout.strip():
            return "unknown"

        remote_url = result.stdout.strip()

        # Parse ssh:// URL format: ssh://[user@]host[:port]/path
        ssh_url_match = re.match(r"^ssh://(?:[^@]+@)?([^:/]+)(?::[^/]+)?/", remote_url)
        if ssh_url_match:
            hostname = ssh_url_match.group(1)
            return _classify_hostname(hostname)

        # Parse HTTPS/HTTP format: https://host/path or http://host/path
        # Must check before scp-like format to avoid matching "https" as hostname
        https_match = re.match(r"^https?://([^/]+)/", remote_url)
        if https_match:
            hostname = https_match.group(1)
            return _classify_hostname(hostname)

        # Parse scp-like format: [user@]host:path (any username, not just 'git')
        # This handles git@github.com:user/repo.git and similar formats
        scp_match = re.match(r"^(?:[^@]+@)?([^:]+):", remote_url)
        if scp_match:
            hostname = scp_match.group(1)
            # Exclude paths that look like Windows drives (e.g., C:)
            if len(hostname) > 1:
                return _classify_hostname(hostname)

        # Unrecognized URL format
        return "unknown"

    except Exception:
        # Any error (subprocess issues, etc.) -> unknown
        return "unknown"


def _classify_hostname(hostname: str) -> str:
    """Classify a hostname as github, gitlab, azure_devops, or unknown.

    Args:
        hostname: The git remote hostname (e.g., 'github.com', 'dev.azure.com', 'gitlab.example.com')

    Returns:
        'github', 'gitlab', 'azure_devops', or 'unknown'
    """
    hostname_lower = hostname.lower()

    # Strip port if present
    clean_hostname = hostname_lower.split(":")[0]
    # Strip user info if present
    if "@" in clean_hostname:
        clean_hostname = clean_hostname.split("@")[-1]

    # Check for Azure DevOps (cloud and visualstudio.com)
    # Match dev.azure.com, *.dev.azure.com, visualstudio.com, *.visualstudio.com
    if (
        clean_hostname == "dev.azure.com"
        or clean_hostname.endswith(".dev.azure.com")
        or clean_hostname == "visualstudio.com"
        or clean_hostname.endswith(".visualstudio.com")
    ):
        return "azure_devops"

    # Check for GitHub (cloud and self-hosted/enterprise)
    # Match github.com, *.github.com, or domains where a segment is or starts with 'github'
    hostname_parts = clean_hostname.split(".")
    if (
        clean_hostname == "github.com"
        or clean_hostname.endswith(".github.com")
        or any(
            part == "github" or part.startswith("github-") for part in hostname_parts
        )
    ):
        return "github"

    # Check for GitLab (cloud and self-hosted)
    # Match gitlab.com, *.gitlab.com, or domains where a segment is or starts with 'gitlab'
    if (
        clean_hostname == "gitlab.com"
        or clean_hostname.endswith(".gitlab.com")
        or any(
            part == "gitlab" or part.startswith("gitlab-") for part in hostname_parts
        )
    ):
        return "gitlab"

    # Unknown provider
    return "unknown"
