# Docker Troubleshooting Guide

This guide covers common issues when running Auto Claude in Docker, with a focus on file permission and git visibility problems.

## Common Issues

### Files Not Visible in SourceTree/Git GUI

**Symptom:** Changes made by Auto Claude inside Docker are not visible in SourceTree, VSCode Git, or other git GUI tools on your host machine.

**Cause:** Docker runs as root by default, creating files with `root:root` ownership. Git 2.35.2+ includes a security feature called "safe.directory" that blocks git operations on repositories owned by a different user.

**Solution:** Start Docker with user mapping to match your host user:

```bash
# Export your user and group IDs
export UID=$(id -u)
export GID=$(id -g)

# Start Docker with user mapping
docker-compose -f docker-compose.web.yml up

# Or inline:
UID=$(id -u) GID=$(id -g) docker-compose -f docker-compose.web.yml up
```

### "Dubious Ownership" Git Error

**Symptom:** Running `git status` or other git commands shows:
```
fatal: detected dubious ownership in repository at '/path/to/repo'
To add an exception for this directory, call:
    git config --global --add safe.directory /path/to/repo
```

**Cause:** Files in the repository are owned by a different user (typically root from Docker) than the user running git commands.

**Solutions:**

**Option 1: User Mapping (Recommended)**

Start Docker with user mapping as shown above. This prevents the issue from occurring.

**Option 2: Add Safe Directory (Quick Fix)**

If you need immediate access to an existing repository with root-owned files:

```bash
# Add specific directory as safe
git config --global --add safe.directory /path/to/Auto-Claude

# Or allow all directories (less secure)
git config --global --add safe.directory '*'
```

**Option 3: Fix Ownership Manually**

Change ownership of existing files to your user:

```bash
sudo chown -R $(id -u):$(id -g) /path/to/code
```

### Git Commits Not Showing Up

**Symptom:** You can see commits inside the Docker container with `git log`, but they don't appear on the host.

**Explanation:** The commits ARE properly stored in git. The issue is that your host git tools can't access them due to the ownership mismatch.

**Verification (inside Docker):**
```bash
# Check if commits exist
git log --oneline -5

# Verify worktree is properly linked
git rev-parse --git-dir
git rev-parse --git-common-dir
```

**Solution:** Apply one of the solutions from the "Dubious Ownership" section above.

### Claude CLI Not Working in Container

**Symptom:** Claude commands fail when running as non-root user inside Docker.

**Cause:** Claude CLI is installed to `/root/.claude` during Docker build and may not be accessible to non-root users.

**Solution:** The Dockerfile has been updated to make Claude CLI accessible:
```dockerfile
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && ln -sf /root/.claude/local/bin/claude /usr/local/bin/claude \
    && chmod -R 755 /root/.claude
```

If you're using an older image, rebuild:
```bash
docker-compose -f docker-compose.web.yml up --build
```

### Home Directory Not Writable

**Symptom:** Applications fail because they can't write to the home directory.

**Cause:** When running as a non-root user (via user mapping), the user may not have a writable home directory.

**Solution:** The docker-compose.web.yml sets `HOME=/tmp` for the backend service, which provides a writable directory for temporary files.

## Understanding Docker User Mapping

### How It Works

Docker containers run as root by default. When you mount a volume, files created inside the container are owned by root:root on the host filesystem.

User mapping tells Docker to run processes as your host user instead:

```yaml
# docker-compose.web.yml
services:
  backend:
    user: "${UID:-1000}:${GID:-1000}"
```

The `${UID:-1000}` syntax means "use the UID environment variable, or default to 1000 if not set."

### Starting with User Mapping

Always export UID and GID before running docker-compose:

```bash
# In your terminal session
export UID=$(id -u)
export GID=$(id -g)

# Then run docker-compose normally
docker-compose -f docker-compose.web.yml up
```

Or create a shell alias:

```bash
# Add to ~/.bashrc or ~/.zshrc
alias docker-compose-user='UID=$(id -u) GID=$(id -g) docker-compose'

# Usage
docker-compose-user -f docker-compose.web.yml up
```

### Verifying User Mapping

Inside the container, check if user mapping is working:

```bash
# Should show your UID, not root
id

# Files created should be owned by your user
touch /tmp/test-ownership
ls -la /tmp/test-ownership
```

## Git Worktree Configuration

Auto Claude uses git worktrees to isolate task workspaces. Understanding the structure helps with troubleshooting:

```
Auto-Claude/
├── .git/                           # Main git directory
│   └── worktrees/
│       └── 001-task-name/          # Worktree git metadata
│           ├── HEAD
│           ├── gitdir              # Points to worktree location
│           └── commondir           # Points to main .git
├── .auto-claude/
│   └── worktrees/
│       └── tasks/
│           └── 001-task-name/      # Actual worktree working directory
│               └── .git            # File pointing to main repo's worktrees/
```

### Verifying Worktree Health

```bash
# List all worktrees
git worktree list

# Check worktree linking (run from worktree directory)
git rev-parse --git-dir      # Should show path to worktree metadata
git rev-parse --git-common-dir  # Should show main .git path
git rev-parse --show-toplevel   # Should show worktree directory
```

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `UID` | 1000 | User ID for running container processes |
| `GID` | 1000 | Group ID for running container processes |
| `HOME` | `/tmp` | Home directory for non-root user (set in docker-compose) |

## Quick Diagnostic Commands

Run these commands to diagnose permission issues:

```bash
# Check who you're running as inside Docker
docker-compose exec backend id

# Check file ownership in the mounted volume
docker-compose exec backend ls -la /home/code

# Check git configuration
docker-compose exec backend git config --list --show-origin

# Test git operations
docker-compose exec backend git status
docker-compose exec backend git log --oneline -3
```

## Rebuilding After Changes

If you've updated the Dockerfile or docker-compose.yml:

```bash
# Rebuild and restart
UID=$(id -u) GID=$(id -g) docker-compose -f docker-compose.web.yml up --build

# Or rebuild without cache
UID=$(id -u) GID=$(id -g) docker-compose -f docker-compose.web.yml build --no-cache
docker-compose -f docker-compose.web.yml up
```

## Getting Help

If you continue to experience issues:

1. Check the [GitHub Issues](https://github.com/AndyMik90/Auto-Claude/issues) for similar problems
2. Join our [Discord community](https://discord.gg/KCXaPBr4Dj) for support
3. Include the output of diagnostic commands when reporting issues
