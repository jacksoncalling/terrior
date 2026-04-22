import { NextRequest, NextResponse } from "next/server";
import { authenticate, AuthError } from "@/lib/api-auth";
import { handleAddSource } from "@/lib/api-handlers";

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json() as { text?: string; title?: string };

    if (!body.text?.trim()) {
      return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
    }

    const ctx = await authenticate(req.headers.get("authorization"));
    const result = await handleAddSource(ctx, id, body.text, body.title);
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
