import crypto from "node:crypto";
import { db, getMeta, setMeta } from "./db";
import { SEED_BANK, SEED_VERSION, shortQuestions } from "./questions";
import type { CategoryId, DeeperStep, SeedQuestion } from "./types";

/** Stable per-question shuffle so the correct choice is not always in one slot. */
function deterministicOrder(seed: string, n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  const h = crypto.createHash("sha256").update(seed).digest();
  for (let i = n - 1; i > 0; i--) {
    const j = h[i % h.length] % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

export function normalisePrompt(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint(prompt: string): string {
  return crypto.createHash("sha1").update(normalisePrompt(prompt)).digest("hex").slice(0, 16);
}

function shuffleChoices(id: string, options: string[]): { options: string[]; answer: number } {
  const order = deterministicOrder(id, options.length);
  const shuffled = order.map((i) => options[i]);
  return { options: shuffled, answer: order.indexOf(0) };
}

function buildDeeper(q: SeedQuestion): DeeperStep[] {
  return (q.deeper ?? []).map((step, i) => {
    const { options, answer } = shuffleChoices(`${q.id}:d${i}`, step.a);
    return { level: step.level, prompt: step.q, options, answer, explanation: step.why };
  });
}

/**
 * Loads the authored bank into SQLite. Deterministic, idempotent, offline.
 * Re-running only rewrites rows whose content actually changed.
 */
export function ensureSeeded(force = false): number {
  const conn = db();
  const already = getMeta("seed_version");
  const count = (conn.prepare("SELECT COUNT(*) AS n FROM questions WHERE origin = 'seed'").get() as { n: number }).n;
  if (!force && already === SEED_VERSION && count > 0) return count;

  const insert = conn.prepare(`
    INSERT INTO questions (id, category, topic, difficulty, kind, prompt, options, answer, aliases, explanation, deeper, source_id, source_ref, origin, fingerprint, created_at)
    VALUES (@id, @category, @topic, @difficulty, 'mc', @prompt, @options, @answer, '[]', @explanation, @deeper, NULL, NULL, 'seed', @fingerprint, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category, topic = excluded.topic, difficulty = excluded.difficulty,
      prompt = excluded.prompt, options = excluded.options, answer = excluded.answer,
      explanation = excluded.explanation, deeper = excluded.deeper, fingerprint = excluded.fingerprint
  `);

  const insertShort = conn.prepare(`
    INSERT INTO questions (id, category, topic, difficulty, kind, prompt, options, answer, aliases, explanation, deeper, source_id, source_ref, origin, fingerprint, created_at)
    VALUES (@id, @category, @topic, @difficulty, 'short', @prompt, '[]', @answer, @aliases, @explanation, '[]', NULL, NULL, 'seed', @fingerprint, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category, topic = excluded.topic, difficulty = excluded.difficulty,
      prompt = excluded.prompt, answer = excluded.answer, aliases = excluded.aliases,
      explanation = excluded.explanation, fingerprint = excluded.fingerprint
  `);

  const now = Date.now();
  const run = conn.transaction(() => {
    for (const [category, list] of Object.entries(SEED_BANK) as [CategoryId, SeedQuestion[]][]) {
      for (const q of list) {
        const { options, answer } = shuffleChoices(q.id, q.a);
        insert.run({
          id: q.id,
          category,
          topic: q.topic,
          difficulty: q.d,
          prompt: q.q,
          options: JSON.stringify(options),
          answer: String(answer),
          explanation: q.why,
          deeper: JSON.stringify(buildDeeper(q)),
          fingerprint: fingerprint(q.q),
          created_at: now,
        });
      }
    }
    for (const q of shortQuestions) {
      insertShort.run({
        id: q.id,
        category: q.category,
        topic: q.topic,
        difficulty: q.d,
        prompt: q.q,
        answer: q.answer,
        aliases: JSON.stringify(q.alias ?? []),
        explanation: q.why,
        fingerprint: fingerprint(q.q),
        created_at: now,
      });
    }
  });
  run();
  setMeta("seed_version", SEED_VERSION);
  return (conn.prepare("SELECT COUNT(*) AS n FROM questions WHERE origin = 'seed'").get() as { n: number }).n;
}

const g = globalThis as unknown as { __krillionReady?: boolean };

/** Call at the top of any server entry point that touches the database. */
export function ready(): void {
  if (g.__krillionReady) return;
  ensureSeeded();
  g.__krillionReady = true;
}
