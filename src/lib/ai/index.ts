import { db } from "../db";
import { hashSeed, mulberry32, shuffle } from "../rng";
import type { GeneratedQuestion } from "../generate-local";

export type AiConfig = {
  enabled: boolean;
  provider: string;
  model: string;
  hasKey: boolean;
};

/** The game never reads this. Only document import does. */
export function aiConfig(): AiConfig {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  return {
    enabled: process.env.AI_ENABLED === "true" && key.length > 0,
    provider,
    model: process.env.AI_MODEL ?? "claude-sonnet-5",
    hasKey: key.length > 0,
  };
}

export interface Provider {
  complete(system: string, user: string, maxTokens: number): Promise<string>;
}

async function loadProvider(): Promise<Provider> {
  const { anthropicProvider } = await import("./anthropic");
  return anthropicProvider();
}

const SYSTEM = [
  "You write short multiple-choice quiz questions from a supplied passage.",
  "Answerable in under 20 seconds from understanding, never from calculation.",
  "Return JSON only: [{\"q\":string,\"a\":[4 strings, correct first],\"why\":string,\"d\":1|2|3}]",
  "One question per passage at most. Skip a passage that has no clear fact. Keep options mutually exclusive.",
].join(" ");

type RawQuestion = { q: string; a: string[]; why: string; d?: number };

function parseQuestions(text: string): RawQuestion[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as RawQuestion[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Batches unused chunks into a small number of short prompts. Chunks already
 * used are never re-sent, and results are stored so nothing regenerates.
 */
export async function generateWithAi(
  sourceId: string,
  opts: { batchSize?: number; maxBatches?: number } = {},
): Promise<GeneratedQuestion[]> {
  const config = aiConfig();
  if (!config.enabled) throw new Error("AI is disabled. Set AI_ENABLED=true and provide a key.");

  const batchSize = opts.batchSize ?? 4;
  const maxBatches = opts.maxBatches ?? 6;
  const conn = db();
  const chunks = conn
    .prepare("SELECT id, ref, text FROM chunks WHERE source_id = ? AND used = 0 ORDER BY idx LIMIT ?")
    .all(sourceId, batchSize * maxBatches) as { id: string; ref: string | null; text: string }[];
  if (chunks.length === 0) return [];

  const provider = await loadProvider();
  const markUsed = conn.prepare("UPDATE chunks SET used = 1 WHERE id = ?");
  const out: GeneratedQuestion[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const user = batch
      .map((c, n) => `#${n + 1}\n${c.text.slice(0, 1400)}`)
      .join("\n\n");

    let reply = "";
    try {
      reply = await provider.complete(SYSTEM, user, 1600);
    } catch {
      break;
    }

    for (const raw of parseQuestions(reply)) {
      if (!raw?.q || !Array.isArray(raw.a) || raw.a.length !== 4) continue;
      if (new Set(raw.a).size !== 4) continue;
      const authored = raw.a.map((o) => String(o).trim());
      const options = shuffle(authored, mulberry32(hashSeed(raw.q)));
      out.push({
        prompt: raw.q.trim(),
        options,
        answer: options.indexOf(authored[0]),
        explanation: (raw.why ?? "").trim(),
        ref: batch[0]?.ref ?? null,
        difficulty: ([1, 2, 3].includes(Number(raw.d)) ? Number(raw.d) : 2) as 1 | 2 | 3,
      });
    }
    conn.transaction(() => batch.forEach((c) => markUsed.run(c.id)))();
  }

  return out;
}
