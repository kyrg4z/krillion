import { NextResponse } from "next/server";
import { startSession, serveQuestion } from "@/lib/engine";
import type { CategoryId, Mode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: Mode; category?: CategoryId; sourceId?: string; length?: number;
    };
    const mode = body.mode ?? "mixed";
    const { sessionId, length } = startSession({
      mode,
      category: body.category ?? null,
      sourceId: body.sourceId ?? null,
      length: body.length,
    });
    return NextResponse.json({ sessionId, length, question: serveQuestion(sessionId, 0) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
