import PlayClient from "@/components/PlayClient";
import { categoryMeta } from "@/lib/categories";
import { serveQuestion, startSession } from "@/lib/engine";
import type { CategoryId, Mode, ServedQuestion } from "@/lib/types";

export const dynamic = "force-dynamic";

const MODES: Mode[] = ["daily", "category", "mixed", "weak", "source", "random"];

export default async function Play({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; category?: string; sourceId?: string }>;
}) {
  const params = await searchParams;
  const mode = (MODES.includes(params.mode as Mode) ? params.mode : "mixed") as Mode;
  const category = (params.category ?? null) as CategoryId | null;
  const sourceId = params.sourceId ?? null;
  const hue = category ? categoryMeta(category).hue : 262;

  // Dealt on the server so the first question is on screen immediately.
  let opening: { sessionId: string; length: number; question: ServedQuestion } | null = null;
  let openingError: string | null = null;
  try {
    const { sessionId, length } = startSession({ mode, category, sourceId });
    const question = serveQuestion(sessionId, 0);
    if (!question) throw new Error("That round came out empty.");
    opening = { sessionId, length, question };
  } catch (error) {
    openingError = (error as Error).message;
  }

  return (
    <PlayClient
      mode={mode}
      category={category}
      sourceId={sourceId}
      hue={hue}
      opening={opening}
      openingError={openingError}
    />
  );
}
