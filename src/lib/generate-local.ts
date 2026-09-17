import { db } from "./db";
import { ready } from "./seed-loader";
import { fingerprint } from "./seed-loader";
import { refreshQuestionCount } from "./sources";
import { hashSeed, mulberry32, shuffle } from "./rng";

type Chunk = { id: string; idx: number; ref: string | null; text: string };

const STOP = new Set([
  "the", "this", "that", "these", "those", "there", "here", "when", "where", "which", "while",
  "however", "therefore", "because", "although", "after", "before", "during", "since", "figure",
  "table", "chapter", "section", "each", "every", "both", "such", "then", "they", "their", "with",
]);

/** Words that mean the match swallowed the start of a predicate. */
const TRAILING_VERB = new Set([
  "describes", "means", "refers", "allows", "gives", "causes", "makes", "shows", "uses", "has",
  "have", "can", "will", "must", "should", "may", "does", "becomes", "occurs", "happens",
  "use", "uses", "make", "show", "give", "cause", "mean", "refer", "allow", "need", "rely",
  "relies", "describe", "include", "includes", "contain", "contains", "provide", "provides",
  "require", "requires", "work", "works", "take", "takes", "come", "comes",
]);

function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]+/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length >= 50 && s.length <= 240 && !/^[\d\W]+$/.test(s));
}

const LEADING = /^(?:The|A|An|This|That|These|Those|Its|Their|Each|Every|Both|Such)\s+/;

/** Multi-word capitalised phrases and standalone technical terms worth asking about. */
function terms(text: string): string[] {
  const found = new Set<string>();
  // A capitalised run, optionally finished by a single lowercase word: "Smith Chart", "Litz wire".
  const proper = text.match(/\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,}){0,2}(?:\s+[a-z]{3,})?\b/g) ?? [];
  for (const match of proper) {
    // Drop a leading determiner rather than the whole phrase: "The Smith Chart" -> "Smith Chart".
    let cleaned = match.trim().replace(LEADING, "").trim();
    // A conjunction means the match ran past the end of the actual term.
    cleaned = cleaned.split(/\s+(?:and|or|with|for)\s+/)[0].trim();
    // Headings often repeat immediately: "Loss and delay Loss and delay".
    const halves = cleaned.split(/\s+/);
    const mid = halves.length / 2;
    if (Number.isInteger(mid) && halves.slice(0, mid).join(" ") === halves.slice(mid).join(" ")) {
      cleaned = halves.slice(0, mid).join(" ");
    }
    const words = cleaned.split(/\s+/);
    if (TRAILING_VERB.has(words[words.length - 1].toLowerCase())) words.pop();
    cleaned = words.join(" ");
    const first = words[0]?.toLowerCase() ?? "";
    if (!cleaned || STOP.has(first)) continue;
    if (cleaned.length < 4 || cleaned.length > 42) continue;
    found.add(cleaned);
  }
  return [...found];
}

function definitionOf(sentence: string): { term: string; definition: string } | null {
  const match = sentence
    .replace(LEADING, "")
    .match(/^([A-Z][\w'’\-]*(?:\s+[\w'’\-]+){0,3})\s+(?:is|are|was|were|refers to|means|describes)\s+(.{25,180})$/);
  if (!match) return null;
  const term = match[1].trim().replace(/[,;:]$/, "");
  const definition = match[2].trim().replace(/[.!?]+$/, "");
  if (term.split(/\s+/).length > 4) return null;
  if (STOP.has(term.toLowerCase())) return null;
  if (definition.length < 25) return null;
  return { term, definition };
}

function pickDistractors(answer: string, pool: string[], rand: () => number, context: string): string[] {
  const lower = answer.toLowerCase();
  const candidates = pool.filter(
    (t) => t.toLowerCase() !== lower && !context.toLowerCase().includes(t.toLowerCase()) && !t.toLowerCase().includes(lower) && !lower.includes(t.toLowerCase()),
  );
  return shuffle(candidates, rand).slice(0, 3);
}

/** Short imports rarely contain four comparable terms, so borrow from the rest of the library. */
function corpusPool(excludeSourceId: string, limit = 250): string[] {
  const rows = db()
    .prepare("SELECT text FROM chunks WHERE source_id != ? LIMIT 400")
    .all(excludeSourceId) as { text: string }[];
  const set = new Set<string>();
  for (const row of rows) {
    for (const term of terms(row.text)) {
      set.add(term);
      if (set.size >= limit) return [...set];
    }
  }
  return [...set];
}

export type GeneratedQuestion = {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  ref: string | null;
  difficulty: 1 | 2 | 3;
};

/**
 * Builds questions from imported material with plain string work — no model,
 * no network, no tokens. Quality gates are strict so weak candidates are dropped.
 */
export function generateFromSource(sourceId: string, limit = 60): GeneratedQuestion[] {
  ready();
  const chunks = db()
    .prepare("SELECT id, idx, ref, text FROM chunks WHERE source_id = ? ORDER BY idx")
    .all(sourceId) as Chunk[];
  if (chunks.length === 0) return [];

  let pool = [...new Set(chunks.flatMap((c) => terms(c.text)))];
  if (pool.length < 10) pool = [...new Set([...pool, ...corpusPool(sourceId)])];
  if (pool.length < 3) return [];

  const rand = mulberry32(hashSeed(sourceId));
  const out: GeneratedQuestion[] = [];
  const used = new Set<string>();

  const perChunk = 3;

  for (const chunk of chunks) {
    if (out.length >= limit) break;
    let made = 0;

    for (const sentence of sentences(chunk.text)) {
      if (made >= perChunk || out.length >= limit) break;

      const definition = definitionOf(sentence);
      if (definition && !used.has(definition.term.toLowerCase())) {
        const distractors = pickDistractors(definition.term, pool, rand, sentence);
        // Three options is the floor; a thin import still yields a playable question.
        if (distractors.length >= 2) {
          const options = shuffle([definition.term, ...distractors], rand);
          out.push({
            prompt: `Which term fits this description: “${definition.definition}”?`,
            options,
            answer: options.indexOf(definition.term),
            explanation: sentence,
            ref: chunk.ref,
            difficulty: 2,
          });
          used.add(definition.term.toLowerCase());
          made++;
          continue;
        }
      }

      const inSentence = terms(sentence).filter((t) => !used.has(t.toLowerCase()) && sentence.indexOf(t) > 12);
      const target = inSentence[0];
      if (!target) continue;
      const distractors = pickDistractors(target, pool, rand, sentence.replace(target, ""));
      if (distractors.length < 2) continue;
      const options = shuffle([target, ...distractors], rand);
      out.push({
        prompt: `Complete the statement: “${sentence.replace(target, "______").trim()}”`,
        options,
        answer: options.indexOf(target),
        explanation: sentence,
        ref: chunk.ref,
        difficulty: 1,
      });
      used.add(target.toLowerCase());
      made++;
    }
  }

  return out;
}

export function storeGenerated(
  sourceId: string,
  sourceTitle: string,
  questions: GeneratedQuestion[],
  origin: "import" | "ai" = "import",
): number {
  const conn = db();
  const now = Date.now();
  const insert = conn.prepare(`
    INSERT INTO questions (id, category, topic, difficulty, kind, prompt, options, answer, aliases, explanation, deeper, source_id, source_ref, origin, fingerprint, created_at)
    VALUES (@id, 'general', @topic, @difficulty, 'mc', @prompt, @options, @answer, '[]', @explanation, '[]', @source_id, @source_ref, @origin, @fingerprint, @created_at)
    ON CONFLICT(id) DO NOTHING
  `);
  const exists = conn.prepare("SELECT 1 FROM questions WHERE fingerprint = ? LIMIT 1");

  let stored = 0;
  conn.transaction(() => {
    questions.forEach((q, i) => {
      const fp = fingerprint(q.prompt);
      if (exists.get(fp)) return;
      insert.run({
        id: `${sourceId}:${fp}`,
        topic: sourceTitle.slice(0, 48),
        difficulty: q.difficulty,
        prompt: q.prompt,
        options: JSON.stringify(q.options),
        answer: String(q.answer),
        explanation: q.explanation,
        source_id: sourceId,
        source_ref: q.ref,
        origin,
        fingerprint: fp,
        created_at: now + i,
      });
      stored++;
    });
  })();
  refreshQuestionCount(sourceId);
  return stored;
}
