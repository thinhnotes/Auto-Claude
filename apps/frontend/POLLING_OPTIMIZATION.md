# Polling to WebSocket/SSE Migration Status

## ✅ Completed

### 1. Terminal WebSocket (DONE)
- **File:** `apps/frontend/src/renderer/components/terminal/useWebTerminal.ts`
- **Change:** Fixed WebSocket URL to use same-origin `/api` path
- **Benefit:** Works through nginx proxy, no CSP errors

### 2. Task Logs Streaming (DONE)
- **File:** `apps/frontend/src/renderer/platform/web-adapter.ts`
- **Backend:** `/api/tasks/{taskId}/logs/stream` (SSE)
- **Change:** Converted from polling to Server-Sent Events
- **Benefit:** Real-time updates, reduced server load

## ⏳ Pending (Backend Support Needed)

### 3. Task Progress (Subtasks)
- **File:** `apps/frontend/src/renderer/platform/web-adapter.ts` (line 332-376)
- **Current:** HTTP polling every 2s to `/api/projects/{projectId}/tasks/{specId}/plan`
- **Needed:** Backend WebSocket/SSE endpoint for real-time subtask updates
- **Recommendation:** Add `/api/tasks/{taskId}/plan/stream` (SSE endpoint)

### 4. Roadmap Generation Status
- **File:** `apps/frontend/src/renderer/platform/web-adapter.ts` (line 148-207)
- **Current:** HTTP polling every 2s to `/api/projects/{projectId}/roadmap/status`
- **Needed:** Backend WebSocket/SSE endpoint for roadmap progress
- **Recommendation:** Add `/api/projects/{projectId}/roadmap/stream` (SSE endpoint)

## Backend Changes Required

### Option 1: Server-Sent Events (Recommended)

Add SSE endpoints to the backend:

```python
# apps/backend/web/routers/tasks.py
@router.get("/tasks/{task_id}/plan/stream")
async def stream_task_plan(task_id: str) -> StreamingResponse:
    """Stream task plan updates via SSE"""
    async def stream_plan():
        while task_running:
            plan = load_plan(task_id)
            yield f"data: {json.dumps(plan)}\\n\\n"
            await asyncio.sleep(1)
    return StreamingResponse(stream_plan(), media_type="text/event-stream")

# apps/backend/web/routers/roadmap.py
@router.get("/projects/{project_id}/roadmap/stream")
async def stream_roadmap_status(project_id: str) -> StreamingResponse:
    """Stream roadmap generation progress via SSE"""
    async def stream_status():
        while roadmap_generating:
            status = get_roadmap_status(project_id)
            yield f"data: {json.dumps(status)}\\n\\n"
            await asyncio.sleep(1)
    return StreamingResponse(stream_status(), media_type="text/event-stream")
```

### Option 2: WebSocket (More Complex)

Add WebSocket endpoints for bidirectional communication.

## Frontend Migration Guide

Once backend endpoints are ready:

```typescript
// Convert Task Progress to SSE
const eventSource = new EventSource(`/api/tasks/${taskId}/plan/stream`);
eventSource.onmessage = (event) => {
  const plan = JSON.parse(event.data);
  taskProgressCallbacks.forEach(cb => cb(taskId, plan, projectId));
};

// Convert Roadmap to SSE
const eventSource = new EventSource(`/api/projects/${projectId}/roadmap/stream`);
eventSource.onmessage = (event) => {
  const status = JSON.parse(event.data);
  if (status.phase === 'complete') {
    eventSource.close();
  }
  roadmapProgressCallbacks.forEach(cb => cb(projectId, status));
};
```

## Performance Impact

Current polling overhead (per active task):
- Task Progress: ~30 req/min
- Roadmap: ~30 req/min  
- Task Logs: ✅ **Eliminated** (now SSE)

After full migration:
- **~60 fewer HTTP requests per minute** per active task
- **Real-time updates** (no 2s delay)
- **Reduced server CPU/memory** usage
