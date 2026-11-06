import { NextResponse } from "next/server";
import { stopTaskExecution } from "@/lib/server/task-engine";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  context: { params: Promise<{ projectId: string; taskId: string }> },
) {
  try {
    const { projectId, taskId } = await context.params;
    const task = stopTaskExecution(projectId, taskId);
    return NextResponse.json({
      success: true,
      data: task,
      task,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        detail: err instanceof Error ? err.message : "Failed to stop task",
      },
      { status: 400 },
    );
  }
}
