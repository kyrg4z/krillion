import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { idx, given, ms } = (await request.json()) as { idx: number; given: string; ms: number };
    return NextResponse.json(await answerQuestion(id, idx, String(given), Number(ms) || 0));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
