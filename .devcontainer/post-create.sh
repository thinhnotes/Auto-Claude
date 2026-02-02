#!/bin/bash
set -e

echo "🚀 Setting up Auto Claude development environment..."
echo "⏱️  This will take 3-5 minutes on first run, <1 minute on subsequent runs..."

# Track installation failures
CLAUDE_CLI_FAILED=false

# Install UV (Python package manager) if not installed
if ! command -v uv &> /dev/null; then
    echo "📦 Installing UV package manager..."
    
    UV_INSTALLER_URL="https://astral.sh/uv/install.sh"
    UV_INSTALLER_SCRIPT="$(mktemp)"
    
    # Download installer
    if ! curl -LsSf "$UV_INSTALLER_URL" -o "$UV_INSTALLER_SCRIPT"; then
        echo "❌ Failed to download UV installer"
        rm -f "$UV_INSTALLER_SCRIPT"
        exit 1
    fi
    
    # Optional: Verify installer integrity if UV_INSTALLER_SHA256 is set
    # Set this in your environment for additional security:
    # export UV_INSTALLER_SHA256="expected_sha256_hash"
    if [ -n "${UV_INSTALLER_SHA256:-}" ]; then
        echo "🔐 Verifying UV installer integrity..."
        DOWNLOADED_SHA256="$(sha256sum "$UV_INSTALLER_SCRIPT" | awk '{print $1}')"
        if [ "$DOWNLOADED_SHA256" != "$UV_INSTALLER_SHA256" ]; then
            echo "❌ UV installer checksum mismatch!"
            echo "Expected: $UV_INSTALLER_SHA256"
            echo "Got:      $DOWNLOADED_SHA256"
            rm -f "$UV_INSTALLER_SCRIPT"
            exit 1
        fi
        echo "✅ UV installer integrity verified"
    fi
    
    # Execute installer
    sh "$UV_INSTALLER_SCRIPT"
    rm -f "$UV_INSTALLER_SCRIPT"
    
    # Ensure uv (installed in ~/.cargo/bin by default) is on PATH for this script.
    export PATH="$HOME/.cargo/bin:$PATH"
else
    echo "✅ UV already installed, skipping..."
fi

# Install Claude CLI globally (make non-blocking)
echo "🤖 Installing Claude CLI (optional - running in background)..."
CLAUDE_INSTALL_LOG="/tmp/claude-install.log"
CLAUDE_FAILED_FLAG="/tmp/claude-failed"
rm -f "$CLAUDE_FAILED_FLAG"

(
    if ! npm install -g @anthropic-ai/claude-code > "$CLAUDE_INSTALL_LOG" 2>&1; then
        touch "$CLAUDE_FAILED_FLAG"
    fi
) &
CLAUDE_PID=$!

# Install root dependencies with offline cache
echo "📦 Installing root dependencies..."
npm install --prefer-offline --no-audit --no-fund

# Run backend and frontend installation in parallel
echo "🔄 Installing backend and frontend dependencies in parallel..."

# Backend installation (background)
(
    echo "  🐍 [Backend] Installing Python dependencies..."
    cd apps/backend
    if [ ! -d ".venv" ]; then
        echo "  🐍 [Backend] Creating Python virtual environment..."
        uv venv
    fi
    echo "  🐍 [Backend] Installing Python packages..."
    uv pip install -r requirements.txt --quiet
    
    # Install test dependencies only if explicitly requested
    if [ "${INSTALL_TEST_DEPS:-false}" = "true" ] && [ -f "../../tests/requirements-test.txt" ]; then
        echo "  🐍 [Backend] Installing test dependencies..."
        uv pip install -r ../../tests/requirements-test.txt --quiet
    fi
    echo "  ✅ [Backend] Installation complete"
) &
BACKEND_PID=$!

# Frontend installation (background)
(
    echo "  ⚛️  [Frontend] Installing dependencies..."
    cd apps/frontend
    npm install --prefer-offline --no-audit --no-fund
    echo "  ✅ [Frontend] Installation complete"
) &
FRONTEND_PID=$!

# Wait for parallel installations to complete
echo "⏳ Waiting for parallel installations..."
wait $BACKEND_PID
wait $FRONTEND_PID
echo "✅ Parallel installations complete"

# Set up git hooks (optional)
if [ -d ".husky" ]; then
    echo "🔧 Setting up git hooks..."
    if npm run | grep -q "^  prepare"; then
        npm run prepare 2>/dev/null || echo "⚠️  Husky setup skipped"
    fi
fi

# Create .env files from examples if they don't exist
echo "📝 Checking environment files..."
if [ -f "apps/backend/.env.example" ] && [ ! -f "apps/backend/.env" ]; then
    echo "Creating apps/backend/.env from .env.example..."
    cp apps/backend/.env.example apps/backend/.env
    echo "⚠️  Please configure your .env file with API keys"
fi

if [ -f "apps/frontend/.env.example" ] && [ ! -f "apps/frontend/.env" ]; then
    echo "Creating apps/frontend/.env from .env.example..."
    cp apps/frontend/.env.example apps/frontend/.env
fi

# Wait for Claude CLI installation to finish
echo "⏳ Waiting for Claude CLI installation..."
wait $CLAUDE_PID 2>/dev/null || true

# Check if Claude CLI installation failed
if [ -f "$CLAUDE_FAILED_FLAG" ]; then
    CLAUDE_CLI_FAILED=true
    echo "⚠️  Claude CLI installation failed (see $CLAUDE_INSTALL_LOG)"
else
    CLAUDE_CLI_FAILED=false
fi

echo ""
echo "✅ Development environment setup complete!"
echo "⏱️  Setup took approximately $(( SECONDS / 60 )) minutes"
echo ""
echo "📚 Quick Start Commands:"
echo "  npm run dev              - Start frontend development server"
echo "  npm run test             - Run frontend tests"
echo "  npm run test:backend     - Run backend tests (install test deps first)"
echo "  npm run lint             - Lint frontend code"
echo "  cd apps/backend && .venv/bin/python run.py          - Backend CLI"
echo ""
echo "🔐 Authentication:"
echo "  Run 'claude' command to authenticate with Claude CLI"
echo "  Then type '/login' and press Enter to complete OAuth"
echo ""
echo "💡 Tips:"
echo "  - Test dependencies are not installed by default (faster startup)"
echo "  - To install test deps: INSTALL_TEST_DEPS=true bash .devcontainer/post-create.sh"
echo "  - Subsequent rebuilds will be much faster (~1 minute) thanks to caching"
echo ""

# Show prominent warning if Claude CLI installation failed
if [ "$CLAUDE_CLI_FAILED" = true ]; then
    echo "⚠️  =============================================="
    echo "⚠️  WARNING: Claude CLI installation failed!"
    echo "⚠️  You may need to install it manually:"
    echo "⚠️  npm install -g @anthropic-ai/claude-code"
    echo "⚠️  =============================================="
    echo ""
fi
