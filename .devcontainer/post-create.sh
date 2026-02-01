#!/bin/bash
set -e

echo "🚀 Setting up Auto Claude development environment..."

# Install UV (Python package manager) if not installed
if ! command -v uv &> /dev/null; then
    echo "📦 Installing UV package manager..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.cargo/bin:$PATH"
fi

# Install Claude CLI globally
echo "🤖 Installing Claude CLI..."
npm install -g @anthropic-ai/claude-code || echo "⚠️  Claude CLI installation failed (may require authentication)"

# Install root dependencies
echo "📦 Installing root dependencies..."
npm install

# Install backend dependencies
echo "🐍 Installing backend dependencies..."
cd apps/backend
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    uv venv
fi
echo "Installing Python packages..."
uv pip install -r requirements.txt

# Install test dependencies if available
if [ -f "../../tests/requirements-test.txt" ]; then
    echo "Installing test dependencies..."
    uv pip install -r ../../tests/requirements-test.txt
fi

cd ../..

# Install frontend dependencies
echo "⚛️  Installing frontend dependencies..."
cd apps/frontend
npm install
cd ../..

# Set up git hooks
echo "🔧 Setting up git hooks..."
if [ -d ".husky" ]; then
    npm run prepare 2>/dev/null || echo "⚠️  Husky setup skipped"
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

echo ""
echo "✅ Development environment setup complete!"
echo ""
echo "📚 Quick Start Commands:"
echo "  npm run dev              - Start frontend development server"
echo "  npm run test             - Run frontend tests"
echo "  npm run test:backend     - Run backend tests"
echo "  npm run lint             - Lint frontend code"
echo "  cd apps/backend && .venv/bin/python run.py --help  - Backend CLI help"
echo ""
echo "🔐 Authentication:"
echo "  Run 'claude' command to authenticate with Claude CLI"
echo "  Then type '/login' and press Enter to complete OAuth"
echo ""
