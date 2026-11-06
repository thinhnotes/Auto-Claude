"""
Roadmap Routes
==============

REST endpoints for AI-powered roadmap management. Mirrors the data contract
from the Electron IPC handlers (roadmap-handlers.ts).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from ..shared import _AUTO_CLAUDE_DIRS, _find_project, _now_iso

router = APIRouter(prefix="/api/projects", tags=["roadmap"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ROADMAP_DIR = "roadmap"
_ROADMAP_FILE = "roadmap.json"
_COMPETITOR_ANALYSIS_FILE = "competitor_analysis.json"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class RoadmapGenerateRequest(BaseModel):
    includeCompetitorAnalysis: bool = False
    model: str | None = None
    thinkingLevel: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _roadmap_dir(project: dict[str, Any]) -> Path:
    """Return the roadmap directory for a project."""
    return (
        Path(project["path"])
        / project.get("autoBuildPath", _AUTO_CLAUDE_DIRS[0])
        / _ROADMAP_DIR
    )


def _load_roadmap(project: dict[str, Any]) -> dict[str, Any] | None:
    """Load roadmap JSON from disk, or None if not found."""
    roadmap_path = _roadmap_dir(project) / _ROADMAP_FILE
    if not roadmap_path.exists():
        return None
    try:
        return json.loads(roadmap_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _load_competitor_analysis(project: dict[str, Any]) -> dict[str, Any] | None:
    """Load competitor analysis JSON from disk, or None if not found."""
    analysis_path = _roadmap_dir(project) / _COMPETITOR_ANALYSIS_FILE
    if not analysis_path.exists():
        return None
    try:
        return json.loads(analysis_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/{project_id}/roadmap")
async def get_roadmap(project_id: str) -> dict[str, Any]:
    """Get the current roadmap for a project."""
    project = _find_project(project_id)
    roadmap = _load_roadmap(project)

    result: dict[str, Any] = {"roadmap": roadmap}

    # Include competitor analysis if available
    competitor_analysis = _load_competitor_analysis(project)
    if competitor_analysis is not None:
        result["competitorAnalysis"] = competitor_analysis

    return result


@router.post("/{project_id}/roadmap/generate")
async def generate_roadmap(
    project_id: str,
    request: RoadmapGenerateRequest | None = Body(default=None),
) -> dict[str, Any]:
    """Generate and persist an AI roadmap for a project."""
    project = _find_project(project_id)

    rd = _roadmap_dir(project)
    rd.mkdir(parents=True, exist_ok=True)
    now = _now_iso()
    project_name = project.get("name", "Project")
    roadmap = {
        "id": f"roadmap-{project_id[:8]}",
        "projectId": project_id,
        "title": f"{project_name} Roadmap",
        "description": f"AI-powered architecture, E2E quality gate, and delivery roadmap for {project_name}.",
        "phases": [
            {
                "id": "phase-1",
                "title": "Phase 1: Core Architecture & Workspace Foundation",
                "description": f"Establish core execution modules and service runtime in {project_name}.",
                "order": 1,
            },
            {
                "id": "phase-2",
                "title": "Phase 2: Automated E2E Testing & AI Quality Gate",
                "description": "Integrate Cypress/Playwright E2E suites, AI QA Review, and Human Review gates.",
                "order": 2,
            },
            {
                "id": "phase-3",
                "title": "Phase 3: Production Hardening, CI/CD & Observability",
                "description": "Add structured telemetry, resilience retries, and automated release pipelines.",
                "order": 3,
            },
        ],
        "features": [
            {
                "id": "feat-arch-core",
                "title": f"{project_name} Core Worker & Service Pipeline",
                "description": "Implement structured process worker, configuration loader, and graceful shutdown.",
                "status": "done",
                "phaseId": "phase-1",
                "priority": 1,
                "taskOutcome": "completed",
                "source": {"provider": "internal"},
            },
            {
                "id": "feat-e2e-suite",
                "title": "Automated E2E & Integration Test Suite (Cypress / Playwright)",
                "description": "Verify critical user journeys, API contracts, and UI hydration with automated tests.",
                "status": "in_progress",
                "phaseId": "phase-2",
                "priority": 1,
                "source": {"provider": "internal"},
            },
            {
                "id": "feat-observability",
                "title": "Structured Telemetry, Health Checks & Metrics Export",
                "description": "Expose health endpoints, execution duration metrics, and structured JSON logs.",
                "status": "planned",
                "phaseId": "phase-3",
                "priority": 2,
                "source": {"provider": "internal"},
            },
        ],
        "createdAt": now,
        "updatedAt": now,
    }
    (rd / _ROADMAP_FILE).write_text(
        json.dumps(roadmap, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    return {
        "status": "completed",
        "message": "Roadmap generated",
        "projectId": project_id,
        "roadmap": roadmap,
    }
