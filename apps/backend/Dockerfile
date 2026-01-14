FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Configure git to allow any directory as safe
# This prevents "dubious ownership" errors when running as different users
# or when the container user doesn't match the file owner
# Using --system config so it applies to all users, not just root
RUN git config --system --add safe.directory '*'

# Install Claude CLI
# Make claude accessible to non-root users running the container
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && ln -sf /root/.claude/local/bin/claude /usr/local/bin/claude \
    && chmod -R 755 /root/.claude

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY . .

# Expose port 8000
EXPOSE 8000

# Run uvicorn
CMD ["uvicorn", "web.main:app", "--host", "0.0.0.0", "--port", "8000"]
