import { NextResponse } from "next/server";
import { extractSections } from "@/lib/extract";
import { addSource, listSources } from "@/lib/sources";
import { generateFromSource, storeGenerated } from "@/lib/generate-local";
import { aiConfig } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 40 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({ sources: listSources(), ai: aiConfig() });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const notes = form.get("notes");
    const title = String(form.get("title") ?? "").trim();

    let sections: Awaited<ReturnType<typeof extractSections>>["sections"] = [];
    let kind = "notes";
    let filename: string | null = null;
    let finalTitle = title;

    if (file instanceof File) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "That file is larger than 40 MB." }, { status: 413 });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extracted = await extractSections(file.name, bytes);
      sections = extracted.sections;
      kind = extracted.kind;
      filename = file.name;
      finalTitle = title || file.name.replace(/\.[^.]+$/, "");
    } else if (typeof notes === "string" && notes.trim().length > 0) {
      sections = [{ ref: null, text: notes.trim() }];
      kind = "notes";
      finalTitle = title || "Notes";
    } else {
      return NextResponse.json({ error: "Attach a file or paste some notes." }, { status: 400 });
    }

    if (sections.length === 0) {
      return NextResponse.json({ error: "No readable text was found in that file." }, { status: 422 });
    }

    const { id, chunks } = addSource({ title: finalTitle, kind, filename, sections });
    // Deterministic generation runs immediately and costs nothing.
    const stored = storeGenerated(id, finalTitle, generateFromSource(id));

    return NextResponse.json({ id, title: finalTitle, chunks, questions: stored });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
