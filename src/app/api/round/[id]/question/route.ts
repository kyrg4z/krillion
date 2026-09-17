import { NextResponse } from "next/server";
import { serveQuestion } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idx = Number(new URL(request.url).searchParams.get("idx") ?? "0");
  const question = await serveQuestion(id, idx);
  if (!question) return NextResponse.json({ error: "No such question." }, { status: 404 });
  return NextResponse.json({ question });
}
