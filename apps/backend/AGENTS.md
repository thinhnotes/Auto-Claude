# Backend Development Guide for AI Agents

## Code Formatting

All Python code MUST be formatted with Ruff before committing:

```bash
# Check formatting
cd apps/backend && uv run ruff format . --check --diff

# Apply formatting
cd apps/backend && uv run ruff format .

# Linting
cd apps/backend && uv run ruff check .
```

**IMPORTANT**: When generating or modifying Python code in `apps/backend/`, follow these formatting rules:
- Use trailing commas in multi-line collections
- Add blank lines after class definitions before the first method
- Break long function signatures into multiple lines (one parameter per line when needed)
- Keep consistent spacing around operators and commas
- Use double quotes for strings (Ruff default)

## Testing

Run tests with pytest:
```bash
cd apps/backend && .venv/bin/pytest tests/ -v
```

## Code Quality Checks

Before committing, ensure:
1. Ruff formatting passes: `uv run ruff format . --check`
2. Ruff linting passes: `uv run ruff check .`
3. Tests pass: `.venv/bin/pytest tests/ -v`
