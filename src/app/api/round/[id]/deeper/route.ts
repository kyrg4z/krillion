import { NextResponse } from "next/server";
import { answerDeeper, serveDeeper } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const idx = Number(url.searchParams.get("idx") ?? "0");
  const step = Number(url.searchParams.get("step") ?? "0");
  const payload = serveDeeper(id, idx, step);
  if (!payload) return NextResponse.json({ error: "No follow-up here." }, { status: 404 });
  return NextResponse.json(payload);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { idx, step, given, ms } = (await request.json()) as {
      idx: number; step: number; given: number; ms: number;
    };
    return NextResponse.json(answerDeeper(id, idx, step, Number(given), Number(ms) || 0));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
