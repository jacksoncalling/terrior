import { NextRequest, NextResponse } from "next/server";
import { deleteDocument } from "@/lib/supabase";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing document id" }, { status: 400 });
    await deleteDocument(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[documents/delete] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
