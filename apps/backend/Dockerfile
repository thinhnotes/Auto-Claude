FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Configure git to allow any directory (needed for mounted volumes)
RUN git config --global --add safe.directory '*' \
    && git config --global user.email "auto-claude@local" \
    && git config --global user.name "Auto Claude"

# Install Claude CLI
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && ln -sf /root/.claude/local/bin/claude /usr/local/bin/claude

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY . .

# Create entrypoint script to setup git safe directory at runtime
RUN echo '#!/bin/bash\n\
# Ensure HOME is writable\n\
mkdir -p "$HOME" 2>/dev/null || true\n\
# Mark all directories as safe for git\n\
git config --global --add safe.directory "*" 2>/dev/null || true\n\
git config --global user.email "auto-claude@local" 2>/dev/null || true\n\
git config --global user.name "Auto Claude" 2>/dev/null || true\n\
exec "$@"' > /entrypoint.sh && chmod +x /entrypoint.sh

# Expose port 8000
EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]

# Run uvicorn from /app directory
CMD ["uvicorn", "web.main:app", "--host", "0.0.0.0", "--port", "8000"]
