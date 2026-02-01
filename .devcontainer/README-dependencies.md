# DevContainer Python Dependencies - Auto-Installation

## Overview

The devcontainer is now configured to automatically install all Python dependencies when the container is created or rebuilt.

## What Gets Installed

### Core Python Dependencies (from requirements.txt)
- `claude-agent-sdk` - Claude AI SDK
- `python-dotenv` - Environment variable management
- `fastapi` - Web framework
- `uvicorn[standard]` - ASGI server
- `websockets` - WebSocket support
- `httpx` - HTTP client
- `pydantic` - Data validation
- `sentry-sdk` - Error tracking
- All other dependencies listed in `apps/backend/requirements.txt`

### Web Server Dependencies (explicitly added)
- `uvicorn[standard]` - With websockets, httptools, uvloop, watchfiles
- `fastapi` - Latest version
- `httpx` - For external API calls
- `websockets` - WebSocket protocol support

### Test Dependencies (if available)
- From `tests/requirements-test.txt`

## Installation Strategy

The post-create script tries multiple approaches:

1. **Try UV package manager first** (if venv exists)
   ```bash
   uv pip install -r requirements.txt
   ```

2. **Fallback to system pip** (if UV fails or no venv)
   ```bash
   python -m pip install -r requirements.txt
   ```

3. **Ensure web dependencies** (always runs)
   ```bash
   python -m pip install uvicorn[standard] fastapi httpx websockets
   ```

## Configuration Changes

### 1. DevContainer Settings (`devcontainer.json`)

```json
{
  "settings": {
    "python.defaultInterpreterPath": "/usr/local/bin/python",
    "python.terminal.activateEnvironment": false
  }
}
```

**Why:** Uses system Python instead of venv for simplicity and consistency.

### 2. Post-Create Script (`post-create.sh`)

Added fallback logic:
- Creates venv if possible
- Falls back to system Python if venv creation fails
- Explicitly installs web server dependencies
- Handles errors gracefully

### 3. Package.json Scripts

Updated to use system Python:
```json
{
  "backend:web": "cd apps/backend && python -m uvicorn web.main:app --reload --host 127.0.0.1 --port 8000"
}
```

**Before:** `cd apps/backend && .venv/bin/python -m uvicorn ...`  
**After:** `cd apps/backend && python -m uvicorn ...`

## Manual Installation (if needed)

If the auto-installation fails, run manually:

```bash
# Install all backend dependencies
cd apps/backend
python -m pip install -r requirements.txt

# Install web server dependencies
python -m pip install uvicorn[standard] fastapi httpx websockets

# Verify installation
python -m uvicorn --version
python -c "import fastapi; print(fastapi.__version__)"
python -c "import websockets; print(websockets.__version__)"
```

## Rebuilding the DevContainer

To trigger a fresh installation:

1. **VS Code Command Palette** (Ctrl+Shift+P / Cmd+Shift+P)
2. Select: `Dev Containers: Rebuild Container`
3. Wait for post-create script to complete

The post-create script will:
- ✅ Install UV package manager
- ✅ Install Claude CLI
- ✅ Install Python dependencies (venv or system)
- ✅ Install web server dependencies
- ✅ Install test dependencies
- ✅ Install frontend dependencies
- ✅ Set up git hooks
- ✅ Create .env files from examples

## Verification

After devcontainer rebuild, verify installation:

```bash
# Check Python packages
python -m pip list | grep -E "(uvicorn|fastapi|httpx|websockets|claude-agent-sdk)"

# Start web server
cd apps/backend
python -m uvicorn web.main:app --host 127.0.0.1 --port 8000

# Test WebSocket
python test_websocket.py
```

Expected output:
```
uvicorn         0.40.0
fastapi         0.128.0
httpx           0.28.1
websockets      16.0
claude-agent-sdk 0.1.27
```

## Troubleshooting

### Issue: uvicorn not found

**Solution:**
```bash
python -m pip install uvicorn[standard]
```

### Issue: ModuleNotFoundError: No module named 'xxx'

**Solution:**
```bash
cd apps/backend
python -m pip install -r requirements.txt
```

### Issue: .venv creation fails

**This is expected and handled automatically.** The script will use system Python.

### Issue: Permission denied when installing packages

**Solution:** Packages install to `/usr/local/python/3.12.12/lib/python3.12/site-packages` which should be writable in the devcontainer.

## Notes

- **Virtual environment:** Optional, falls back to system Python if creation fails
- **System Python:** `/usr/local/bin/python` (Python 3.12)
- **Package location:** `/usr/local/python/3.12.12/lib/python3.12/site-packages`
- **Auto-install:** Runs on every devcontainer create/rebuild
- **Manual override:** You can always run `python -m pip install` manually

---

**Last Updated:** 2026-02-01  
**Related:** WebSocket Migration, Backend Setup
