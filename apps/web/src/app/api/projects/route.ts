import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import {
  listProjects,
  createOrUpdateProject,
  findProject,
  resolveSpecsDir,
  buildTask,
  listTasksForProject,
  createTaskForProject,
  updateTaskStatusForProject,
  updateTaskForProject,
  deleteTaskForProject,
  startTaskExecution,
  stopTaskExecution,
  approveTaskForProject,
  rejectTaskForProject,
  getTaskFilesDiffForProject,
  listProjectFiles,
  getRoadmapForProject,
  generateRoadmapForProject,
  updateRoadmapFeatureForProject,
  getIdeasForProject,
  generateIdeasForProject,
  updateIdeasForProject,
  getChangelogForProject,
  generateChangelogForProject,
  getContextForProject,
  getMemoriesForProject,
  queryInsightsForProject,
  listWorktreesForProject,
  createWorktreeForProject,
  mergeWorktreeForProject,
  discardWorktreeForProject,
  getWorktreeDiffForProject,
  getMcpStatusForProject,
  listTerminalsForProject,
  createTerminalForProject,
  openTaskTerminalForProject,
  ensureTaskSourceTreeForProject,
  execTerminalCommandForProject,
  execAgyCommandForProject,
  autocompleteTerminalForProject,
  closeTerminalForProject,
  getAzureDevOpsForProject,
  refreshAzureDevOpsForProject,
  saveAzureDevOpsConfigForProject,
  testAzureDevOpsConnectionForProject,
  createAzureDevOpsTicketForProject,
  importAzureDevOpsTicketsForProject,
} from "@/lib/server/task-engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const projectId = url.searchParams.get("projectId") || "";
    const taskId = url.searchParams.get("taskId") || "";

    if (action === "files" && projectId) {
      const dirPath = url.searchParams.get("path") || undefined;
      const files = listProjectFiles(projectId, dirPath);
      return NextResponse.json({
        success: true,
        files,
        data: { files },
      });
    }

    if (action === "tasks" && projectId) {
      const tasks = listTasksForProject(projectId);
      return NextResponse.json({
        success: true,
        data: tasks,
        tasks,
      });
    }

    if (action === "task" && projectId && taskId) {
      const project = findProject(projectId);
      if (!project) {
        return NextResponse.json({ detail: "Project not found" }, { status: 404 });
      }
      const specFolder = path.join(resolveSpecsDir(project), taskId);
      if (!fs.existsSync(specFolder)) {
        return NextResponse.json({ detail: "Task not found" }, { status: 404 });
      }
      const task = buildTask(specFolder, projectId);
      return NextResponse.json({ success: true, data: task, task });
    }

    if (action === "taskDiff" && projectId && taskId) {
      const files = getTaskFilesDiffForProject(projectId, taskId);
      return NextResponse.json({
        success: true,
        files,
        data: { files },
      });
    }

    if (action === "logs" && projectId && taskId) {
      const project = findProject(projectId);
      if (!project) {
        return NextResponse.json({ detail: "Project not found" }, { status: 404 });
      }
      const specFolder = path.join(resolveSpecsDir(project), taskId);
      if (!fs.existsSync(specFolder)) {
        return NextResponse.json({ detail: "Task not found" }, { status: 404 });
      }
      const task = buildTask(specFolder, projectId);
      return NextResponse.json({
        success: true,
        logs: task.logs || [],
        data: { logs: task.logs || [] },
      });
    }

    if (action === "roadmap" && projectId) {
      return NextResponse.json(getRoadmapForProject(projectId));
    }

    if (action === "ideas" && projectId) {
      return NextResponse.json(getIdeasForProject(projectId));
    }

    if (action === "changelog" && projectId) {
      return NextResponse.json(getChangelogForProject(projectId));
    }

    if (action === "context" && projectId) {
      return NextResponse.json(getContextForProject(projectId));
    }

    if (action === "memories" && projectId) {
      const query = url.searchParams.get("query") || undefined;
      return NextResponse.json(getMemoriesForProject(projectId, query));
    }

    if (action === "worktrees" && projectId) {
      return NextResponse.json(listWorktreesForProject(projectId));
    }

    if (action === "worktreeDiff" && projectId) {
      const specName = url.searchParams.get("specName") || "";
      return NextResponse.json(getWorktreeDiffForProject(projectId, specName));
    }

    if (action === "mcpStatus" && projectId) {
      return NextResponse.json(getMcpStatusForProject(projectId));
    }

    if (action === "terminals" && projectId) {
      return NextResponse.json(listTerminalsForProject(projectId));
    }

    if (action === "azureDevOps" && projectId) {
      const shouldRefresh = url.searchParams.get("refresh") === "true";
      if (shouldRefresh) {
        const refreshed = await refreshAzureDevOpsForProject(projectId);
        return NextResponse.json(refreshed);
      }
      return NextResponse.json(getAzureDevOpsForProject(projectId));
    }

    const projects = listProjects();
    return NextResponse.json({
      success: true,
      data: projects,
      projects,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to handle GET /api/projects",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const projectId = url.searchParams.get("projectId") || "";
    const taskId = url.searchParams.get("taskId") || "";

    if (action === "createTask" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        title?: string;
        description?: string;
        metadata?: Record<string, any>;
      };
      const task = createTaskForProject(projectId, body || {});
      return NextResponse.json({
        success: true,
        data: task,
        task,
      });
    }

    if (action === "startTask" && projectId && taskId) {
      const task = startTaskExecution(projectId, taskId);
      return NextResponse.json({
        success: true,
        data: task,
        task,
      });
    }

    if (action === "stopTask" && projectId && taskId) {
      const task = stopTaskExecution(projectId, taskId);
      return NextResponse.json({
        success: true,
        data: task,
        task,
      });
    }

    if (action === "approveTask" && projectId && taskId) {
      const body = (await req.json().catch(() => ({}))) as { feedback?: string };
      const task = approveTaskForProject(projectId, taskId, body?.feedback);
      return NextResponse.json({
        success: true,
        data: task,
        task,
      });
    }

    if (action === "rejectTask" && projectId && taskId) {
      const body = (await req.json().catch(() => ({}))) as { feedback?: string };
      const task = rejectTaskForProject(
        projectId,
        taskId,
        body?.feedback || "Please refine implementation",
      );
      return NextResponse.json({
        success: true,
        data: task,
        task,
      });
    }

    if (action === "updateTaskStatus" && projectId && taskId) {
      const body = (await req.json().catch(() => ({}))) as { status?: string };
      const task = updateTaskStatusForProject(
        projectId,
        taskId,
        body.status || "backlog",
      );
      return NextResponse.json({
        success: true,
        data: task,
        task,
      });
    }

    if ((action === "task" || action === "updateTask") && projectId && taskId) {
      const body = (await req.json().catch(() => ({}))) as {
        title?: string;
        description?: string;
        status?: string;
        instructions?: string;
        triggerAiFix?: boolean;
      };
      const task = updateTaskForProject(projectId, taskId, body || {});
      return NextResponse.json({
        success: true,
        data: task,
        task,
      });
    }

    if (action === "deleteTask" && projectId && taskId) {
      deleteTaskForProject(projectId, taskId);
      return NextResponse.json({
        success: true,
        data: { id: taskId, deleted: true },
      });
    }

    if (action === "generateRoadmap" && projectId) {
      const res = await generateRoadmapForProject(projectId);
      return NextResponse.json(res);
    }

    if (action === "updateRoadmapFeature" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        featureId?: string;
        title?: string;
        description?: string;
        priority?: number | string;
        status?: string;
        triggerAiBuild?: boolean;
      };
      const featureId =
        url.searchParams.get("featureId") || body.featureId || "";
      const res = updateRoadmapFeatureForProject(projectId, featureId, body);
      return NextResponse.json(res);
    }

    if (action === "generateIdeas" && projectId) {
      const res = await generateIdeasForProject(projectId);
      return NextResponse.json(res);
    }

    if (action === "updateIdeas" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        operation?: "dismiss" | "dismissAll" | "delete" | "convert" | "updateStatus";
        ideaId?: string;
        status?: string;
      };
      const res = updateIdeasForProject(projectId, {
        operation: body.operation || "dismiss",
        ideaId: body.ideaId,
        status: body.status,
      });
      return NextResponse.json(res);
    }

    if (action === "generateChangelog" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        version?: string;
        taskIds?: string[];
      };
      const res = generateChangelogForProject(projectId, body);
      return NextResponse.json(res);
    }

    if (action === "refreshProjectIndex" && projectId) {
      const res = getContextForProject(projectId);
      return NextResponse.json(res);
    }

    if (action === "insightsStream" && projectId) {
      const body = (await req.json().catch(() => ({}))) as { message?: string };
      const reply = queryInsightsForProject(projectId, body.message || "");
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const text = reply.response || "";
          const chunkSize = 48;
          for (let i = 0; i < text.length; i += chunkSize) {
            const chunk = text.slice(i, i + chunkSize);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`,
              ),
            );
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    if (action === "createWorktree" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        specName?: string;
        baseBranch?: string;
      };
      const res = createWorktreeForProject(
        projectId,
        body.specName || "",
        body.baseBranch,
      );
      return NextResponse.json(res);
    }

    if (action === "mergeWorktree" && projectId) {
      const body = (await req.json().catch(() => ({}))) as { specName?: string };
      const specName = url.searchParams.get("specName") || body.specName || "";
      const res = mergeWorktreeForProject(projectId, specName);
      return NextResponse.json(res);
    }

    if (action === "discardWorktree" && projectId) {
      const body = (await req.json().catch(() => ({}))) as { specName?: string };
      const specName = url.searchParams.get("specName") || body.specName || "";
      const res = discardWorktreeForProject(projectId, specName);
      return NextResponse.json(res);
    }

    if (action === "createTerminal" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        sessionId?: string;
        title?: string;
        cwd?: string;
        worktreePath?: string;
        associatedTaskId?: string;
        isClaudeMode?: boolean;
      };
      const res = createTerminalForProject(projectId, body);
      return NextResponse.json(res);
    }

    if (action === "openTaskTerminal" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        taskId?: string;
        sessionId?: string;
        title?: string;
      };
      const targetTaskId = taskId || body.taskId || "";
      const res = openTaskTerminalForProject(projectId, targetTaskId, {
        sessionId: body.sessionId,
        title: body.title,
      });
      return NextResponse.json(res);
    }

    if (action === "syncTaskSourceTree" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        taskId?: string;
      };
      const targetTaskId = taskId || body.taskId || "";
      const res = ensureTaskSourceTreeForProject(projectId, targetTaskId);
      return NextResponse.json(res);
    }

    if (action === "execTerminal" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        sessionId?: string;
        command?: string;
        cwd?: string;
      };
      const res = await execTerminalCommandForProject(
        projectId,
        body.sessionId || "default",
        body.command || "",
        body.cwd,
      );
      return NextResponse.json(res);
    }

    if (action === "execAgy" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        sessionId?: string;
        prompt?: string;
        command?: string;
        cwd?: string;
      };
      const res = await execAgyCommandForProject(
        projectId,
        body.sessionId || "default",
        body.prompt || body.command || "",
        body.cwd,
      );
      return NextResponse.json(res);
    }

    if (action === "terminalAutocomplete" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        sessionId?: string;
        input?: string;
        cwd?: string;
      };
      const res = autocompleteTerminalForProject(
        projectId,
        body.sessionId || "default",
        body.input || "",
        body.cwd,
      );
      return NextResponse.json(res);
    }

    if (action === "closeTerminal" && projectId) {
      const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
      const sessionId =
        url.searchParams.get("sessionId") || body.sessionId || "default";
      const res = closeTerminalForProject(projectId, sessionId);
      return NextResponse.json(res);
    }

    if (action === "testAzureDevOpsConnection" && projectId) {
      const body = (await req.json().catch(() => ({}))) as Partial<any>;
      const res = await testAzureDevOpsConnectionForProject(projectId, body);
      return NextResponse.json(res);
    }

    if (action === "refreshAzureDevOps" && projectId) {
      const res = await refreshAzureDevOpsForProject(projectId);
      return NextResponse.json(res);
    }

    if (action === "saveAzureDevOpsConfig" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        organizationUrl?: string;
        project?: string;
        personalAccessToken?: string;
        useMock?: boolean;
      };
      const res = await saveAzureDevOpsConfigForProject(projectId, body);
      return NextResponse.json(res);
    }

    if (action === "createAzureDevOpsTicket" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        title?: string;
        description?: string;
        type?: string;
        priority?: number;
        tags?: string[];
      };
      const res = createAzureDevOpsTicketForProject(projectId, {
        title: body.title || "New Azure DevOps Ticket",
        description: body.description,
        type: body.type,
        priority: body.priority,
        tags: body.tags,
      });
      return NextResponse.json(res);
    }

    if (action === "importAzureDevOpsTickets" && projectId) {
      const body = (await req.json().catch(() => ({}))) as {
        workItemIds?: number[];
        autoStart?: boolean;
      };
      const res = importAzureDevOpsTicketsForProject(
        projectId,
        Array.isArray(body.workItemIds) ? body.workItemIds : [],
        Boolean(body.autoStart),
      );
      return NextResponse.json(res);
    }

    const body = (await req.json()) as { path?: string; name?: string };
    if (!body?.path?.trim()) {
      return NextResponse.json(
        { success: false, detail: "Path is required" },
        { status: 400 },
      );
    }
    const project = createOrUpdateProject(body.path, body.name);
    return NextResponse.json({
      success: true,
      data: project,
      project,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        detail: err instanceof Error ? err.message : "Failed to handle POST /api/projects",
      },
      { status: 400 },
    );
  }
}

export async function PUT(req: Request) {
  return POST(req);
}

export async function DELETE(req: Request) {
  return POST(req);
}
