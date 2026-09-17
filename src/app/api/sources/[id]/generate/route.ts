import { NextResponse } from "next/server";
import { generateFromSource, storeGenerated } from "@/lib/generate-local";
import { generateWithAi } from "@/lib/ai";
import { get } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { useAi } = (await request.json().catch(() => ({}))) as { useAi?: boolean };
    const source = await get<{ title: string }>("SELECT title FROM sources WHERE id = ?", [id]);
    if (!source) return NextResponse.json({ error: "Unknown source." }, { status: 404 });

    const questions = useAi ? await generateWithAi(id) : await generateFromSource(id);
    const stored = await storeGenerated(id, source.title, questions, useAi ? "ai" : "import");
    return NextResponse.json({ stored, offered: questions.length });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
