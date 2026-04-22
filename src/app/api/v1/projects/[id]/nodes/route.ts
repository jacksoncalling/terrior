import { NextRequest, NextResponse } from "next/server";
import { authenticate, AuthError } from "@/lib/api-auth";
import { handleAddNode } from "@/lib/api-handlers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json() as {
      label?: string;
      type?: string;
      description?: string;
      hubId?: string;
    };

    if (!body.label?.trim()) {
      return NextResponse.json({ ok: false, error: "label is required" }, { status: 400 });
    }
    if (!body.type?.trim()) {
      return NextResponse.json({ ok: false, error: "type is required" }, { status: 400 });
    }

    const ctx = await authenticate(req.headers.get("authorization"));
    const result = await handleAddNode(ctx, id, {
      label: body.label,
      type: body.type,
      description: body.description,
      hubId: body.hubId,
    });
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
