import { NextResponse } from "next/server";
import { deleteSource } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteSource(id);
  return NextResponse.json({ ok: true });
}
