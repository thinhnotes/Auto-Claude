import { NextResponse } from "next/server";
import { updateTaskStatusForProject } from "@/lib/server/task-engine";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  context: { params: Promise<{ projectId: string; taskId: string }> },
) {
  try {
    const { projectId, taskId } = await context.params;
    const body = (await req.json()) as { status?: string };
    const task = updateTaskStatusForProject(
      projectId,
      taskId,
      body.status || "backlog",
    );
    return NextResponse.json({ success: true, data: task, task });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        detail: err instanceof Error ? err.message : "Failed to update status",
      },
      { status: 400 },
    );
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ projectId: string; taskId: string }> },
) {
  return PUT(req, context);
}
