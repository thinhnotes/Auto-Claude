import { NextResponse } from "next/server";
import { listProjectFiles } from "@/lib/server/task-engine";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const url = new URL(req.url);
    const dirPath = url.searchParams.get("path") || undefined;
    const files = listProjectFiles(projectId, dirPath);
    return NextResponse.json({
      success: true,
      files,
      data: { files },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        detail: err instanceof Error ? err.message : "Failed to load files",
      },
      { status: 404 },
    );
  }
}
