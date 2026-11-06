import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import {
  findProject,
  resolveSpecsDir,
  buildTask,
  deleteTaskForProject,
} from "@/lib/server/task-engine";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ projectId: string; taskId: string }> },
) {
  const { projectId, taskId } = await context.params;
  const project = findProject(projectId);
  if (!project) {
    return NextResponse.json({ detail: "Project not found" }, { status: 404 });
  }
  const specsDir = resolveSpecsDir(project);
  const specFolder = path.join(specsDir, taskId);
  if (!fs.existsSync(specFolder)) {
    return NextResponse.json({ detail: "Task not found" }, { status: 404 });
  }
  const task = buildTask(specFolder, projectId);
  return NextResponse.json({ success: true, data: task, task });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ projectId: string; taskId: string }> },
) {
  const { projectId, taskId } = await context.params;
  deleteTaskForProject(projectId, taskId);
  return NextResponse.json({
    success: true,
    data: { id: taskId, deleted: true },
  });
}
