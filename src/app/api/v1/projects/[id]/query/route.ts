import { NextRequest, NextResponse } from "next/server";
import { authenticate, AuthError } from "@/lib/api-auth";
import { handleQueryGraph } from "@/lib/api-handlers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const q = req.nextUrl.searchParams.get("q");
    const count = parseInt(req.nextUrl.searchParams.get("count") ?? "10", 10);

    if (!q?.trim()) {
      return NextResponse.json({ ok: false, error: "q query parameter is required" }, { status: 400 });
    }

    const ctx = await authenticate(req.headers.get("authorization"));
    const result = await handleQueryGraph(ctx, id, q, count);
    return NextResponse.json({ ok: true, data: result });
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
