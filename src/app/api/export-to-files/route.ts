import { NextRequest, NextResponse } from "next/server";
import * as path from "node:path";
import { exportProjectToFilesystem } from "@/lib/export-filesystem";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId } = body as { projectId?: string };

    if (!projectId) {
      return NextResponse.json(
        { ok: false, error: "projectId is required" },
        { status: 400 }
      );
    }

    // outputRoot is server-side only — never accept it from the client to
    // prevent path traversal attacks.
    const outputRoot =
      process.env.TERROIR_EXPORT_ROOT ??
      path.join(process.cwd(), "exports");

    const result = await exportProjectToFilesystem(projectId, outputRoot);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
