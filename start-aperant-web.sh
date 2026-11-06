#!/usr/bin/env bash
set -euo pipefail

export PATH="/home/thinhnguyen/.nvm/versions/node/v22.23.2/bin:/home/thinhnguyen/.nvm/versions/node/v26.11.1/bin:$PATH"
APERANT_DIR="/home/thinhnguyen/.gemini/antigravity-cli/scratch/Aperant"
BACKEND_DIR="$APERANT_DIR/apps/backend"
WEB_DIR="$APERANT_DIR/apps/web"
LOG_DIR="$APERANT_DIR/logs"
mkdir -p "$LOG_DIR" "$APERANT_DIR/.auto-claude-web/vscode-web-data"

# Kill existing Aperant processes on 8001, 3782, 3783, 7788, 8443 if any
if [ -f "$LOG_DIR/backend.pid" ]; then kill "$(cat "$LOG_DIR/backend.pid")" >/dev/null 2>&1 || true; fi
if [ -f "$LOG_DIR/web.pid" ]; then kill "$(cat "$LOG_DIR/web.pid")" >/dev/null 2>&1 || true; fi
if [ -f "$LOG_DIR/gateway-3782.pid" ]; then kill "$(cat "$LOG_DIR/gateway-3782.pid")" >/dev/null 2>&1 || true; fi
if [ -f "$LOG_DIR/vscode-8443.pid" ]; then kill "$(cat "$LOG_DIR/vscode-8443.pid")" >/dev/null 2>&1 || true; fi
if [ -f "$LOG_DIR/bridge-3782.pid" ]; then kill "$(cat "$LOG_DIR/bridge-3782.pid")" >/dev/null 2>&1 || true; fi
if [ -f "$LOG_DIR/bridge-7788.pid" ]; then kill "$(cat "$LOG_DIR/bridge-7788.pid")" >/dev/null 2>&1 || true; fi
fuser -k 8001/tcp >/dev/null 2>&1 || true
fuser -k 3782/tcp >/dev/null 2>&1 || true
fuser -k 3783/tcp >/dev/null 2>&1 || true
fuser -k 7788/tcp >/dev/null 2>&1 || true
fuser -k 8443/tcp >/dev/null 2>&1 || true
sleep 1

# 1. Start Aperant FastAPI + Socket.IO Backend on 0.0.0.0:8001 (mapped to https://deeptutor-api.notesvnn.click)
cd "$BACKEND_DIR"
export AUTO_CLAUDE_API_TOKEN="aperant-local-web-token"
export AUTO_CLAUDE_STORE_DIR="$APERANT_DIR/.auto-claude-web"
export PYTHONPATH="$BACKEND_DIR"
setsid "$BACKEND_DIR/.venv/bin/python3" -m uvicorn api.main:app \
  --host 0.0.0.0 \
  --port 8001 \
  > "$LOG_DIR/backend-8001.log" 2>&1 < /dev/null &
echo $! > "$LOG_DIR/backend.pid"

# 2. Start Local Self-Hosted VS Code Web Server on 0.0.0.0:8443 (--server-base-path /vscode-web)
VSCODE_SERVER_BIN="$(find /home/thinhnguyen/.vscode/cli/serve-web -maxdepth 3 -name code-server -type f 2>/dev/null | head -n 1 || true)"
if [ -n "$VSCODE_SERVER_BIN" ]; then
  setsid "$VSCODE_SERVER_BIN" \
    --host 0.0.0.0 \
    --port 8443 \
    --server-base-path /vscode-web \
    --without-connection-token \
    --accept-server-license-terms \
    --server-data-dir "$APERANT_DIR/.auto-claude-web/vscode-web-data" \
    > "$LOG_DIR/vscode-8443.log" 2>&1 < /dev/null &
  echo $! > "$LOG_DIR/vscode-8443.pid"
fi

# 3. Start Aperant Next.js 16 Web UI on 127.0.0.1:3783 (internal upstream for Gateway 3782)
cd "$WEB_DIR"
export BACKEND_INTERNAL_URL="http://127.0.0.1:8001"
export NEXT_PUBLIC_API_URL=""
export NEXT_PUBLIC_SOCKET_URL="https://deeptutor-api.notesvnn.click"
export NEXT_PUBLIC_PUBLIC_SOCKET_URL="https://deeptutor-api.notesvnn.click"
export NEXT_PUBLIC_API_TOKEN="aperant-local-web-token"
setsid npx next dev --turbopack -H 127.0.0.1 -p 3783 \
  > "$LOG_DIR/web-3782.log" 2>&1 < /dev/null &
echo $! > "$LOG_DIR/web.pid"

# 4. Start Same-Origin HTTP + WebSocket Gateway on 0.0.0.0:3782 (mapped to https://deeptutor.notesvnn.click)
setsid node "$APERANT_DIR/scripts/vscode-web-gateway.mjs" \
  > "$LOG_DIR/gateway-3782.log" 2>&1 < /dev/null &
echo $! > "$LOG_DIR/gateway-3782.pid"

# 5. Start lightweight asyncio TCP bridge 0.0.0.0:7788 -> 127.0.0.1:3782 (mapped to https://openhuman.notesvnn.click)
setsid "$BACKEND_DIR/.venv/bin/python3" -c '
import asyncio

async def pipe(reader, writer):
    try:
        while chunk := await reader.read(65536):
            writer.write(chunk)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass

async def handle(client_r, client_w):
    try:
        up_r, up_w = await asyncio.open_connection("127.0.0.1", 3782)
        await asyncio.gather(pipe(client_r, up_w), pipe(up_r, client_w))
    except Exception:
        try:
            client_w.close()
        except Exception:
            pass

async def main():
    srv = await asyncio.start_server(handle, "0.0.0.0", 7788)
    async with srv:
        await srv.serve_forever()

asyncio.run(main())
' > "$LOG_DIR/bridge-7788.log" 2>&1 < /dev/null &
echo $! > "$LOG_DIR/bridge-7788.pid"

echo "Started Aperant Backend (8001), VS Code Web (8443), Next.js (3783), Gateway (3782), and Domain Bridge (7788)."
