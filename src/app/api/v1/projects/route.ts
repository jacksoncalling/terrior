import { NextRequest, NextResponse } from "next/server";
import { authenticate, AuthError } from "@/lib/api-auth";
import { handleListProjects } from "@/lib/api-handlers";

export async function GET(req: NextRequest) {
  try {
    const ctx = await authenticate(req.headers.get("authorization"));
    const projects = await handleListProjects(ctx);
    return NextResponse.json({ ok: true, data: projects });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
