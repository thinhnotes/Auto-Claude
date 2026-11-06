import { NextResponse } from "next/server";
import {
  listTasksForProject,
  createTaskForProject,
} from "@/lib/server/task-engine";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const tasks = listTasksForProject(projectId);
    return NextResponse.json({
      success: true,
      data: tasks,
      tasks,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to list tasks",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const body = (await req.json()) as {
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
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        detail: err instanceof Error ? err.message : "Failed to create task",
      },
      { status: 400 },
    );
  }
}
