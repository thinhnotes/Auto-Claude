import { NextResponse } from "next/server";
import { findProject, loadStore, saveStore } from "@/lib/server/task-engine";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const project = findProject(projectId);
  if (!project) {
    return NextResponse.json({ detail: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: project, project });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const store = loadStore();
  store.projects = store.projects.filter((p) => p.id !== projectId);
  saveStore(store);
  return NextResponse.json({ success: true, data: { id: projectId, deleted: true } });
}
