import crypto from "node:crypto";
import { db } from "./db";
import { ready } from "./seed-loader";
import type { ExtractedSection } from "./extract";

export type SourceRow = {
  id: string;
  title: string;
  kind: string;
  filename: string | null;
  added_at: number;
  chars: number;
  chunks: number;
  questions: number;
  status: string;
  note: string | null;
};

export type SourceSummary = {
  id: string;
  title: string;
  kind: string;
  addedAt: number;
  chars: number;
  chunks: number;
  questions: number;
  status: string;
  note: string | null;
};

const TARGET = 1100;

/** Splits a section into paragraph-aligned chunks of roughly TARGET characters. */
export function chunkSection(section: ExtractedSection): { ref: string | null; text: string }[] {
  const paragraphs = section.text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const chunks: { ref: string | null; text: string }[] = [];
  let buffer = "";
  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + paragraph.length > TARGET) {
      chunks.push({ ref: section.ref, text: buffer.trim() });
      buffer = "";
    }
    if (paragraph.length > TARGET * 2) {
      const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [paragraph];
      for (const sentence of sentences) {
        if (buffer.length + sentence.length > TARGET) {
          chunks.push({ ref: section.ref, text: buffer.trim() });
          buffer = "";
        }
        buffer += sentence;
      }
    } else {
      buffer += (buffer ? "\n\n" : "") + paragraph;
    }
  }
  if (buffer.trim()) chunks.push({ ref: section.ref, text: buffer.trim() });
  return chunks.filter((c) => c.text.length > 120);
}

export function addSource(input: {
  title: string;
  kind: string;
  filename: string | null;
  sections: ExtractedSection[];
}): { id: string; chunks: number; chars: number } {
  ready();
  const conn = db();
  const id = crypto.randomUUID();
  const now = Date.now();
  const chunks = input.sections.flatMap(chunkSection);
  const chars = chunks.reduce((sum, c) => sum + c.text.length, 0);

  const insertChunk = conn.prepare("INSERT INTO chunks (id, source_id, idx, ref, text) VALUES (?, ?, ?, ?, ?)");
  const insertFts = conn.prepare("INSERT INTO chunks_fts (text, chunk_id, source_id) VALUES (?, ?, ?)");

  conn.transaction(() => {
    conn
      .prepare(
        `INSERT INTO sources (id, title, kind, filename, added_at, chars, chunks, questions, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'ready')`,
      )
      .run(id, input.title, input.kind, input.filename, now, chars, chunks.length);
    chunks.forEach((chunk, idx) => {
      const chunkId = `${id}:${idx}`;
      insertChunk.run(chunkId, id, idx, chunk.ref, chunk.text);
      insertFts.run(chunk.text, chunkId, id);
    });
  })();

  return { id, chunks: chunks.length, chars };
}

export function listSources(): SourceSummary[] {
  ready();
  const rows = db().prepare("SELECT * FROM sources ORDER BY added_at DESC").all() as SourceRow[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    addedAt: r.added_at,
    chars: r.chars,
    chunks: r.chunks,
    questions: r.questions,
    status: r.status,
    note: r.note,
  }));
}

export function deleteSource(id: string): void {
  ready();
  const conn = db();
  conn.transaction(() => {
    conn.prepare("DELETE FROM questions WHERE source_id = ?").run(id);
    conn.prepare("DELETE FROM chunks_fts WHERE source_id = ?").run(id);
    conn.prepare("DELETE FROM chunks WHERE source_id = ?").run(id);
    conn.prepare("DELETE FROM sources WHERE id = ?").run(id);
  })();
}

export function refreshQuestionCount(sourceId: string): number {
  const conn = db();
  const n = (conn.prepare("SELECT COUNT(*) AS n FROM questions WHERE source_id = ?").get(sourceId) as { n: number }).n;
  conn.prepare("UPDATE sources SET questions = ? WHERE id = ?").run(n, sourceId);
  return n;
}

/** Plain full-text search over imported material — used before any model is considered. */
export function searchChunks(query: string, sourceId?: string, limit = 8) {
  ready();
  const safe = query.replace(/["']/g, " ").trim();
  if (!safe) return [];
  const sql = sourceId
    ? `SELECT chunk_id, source_id, snippet(chunks_fts, 0, '', '', '…', 18) AS snippet
       FROM chunks_fts WHERE chunks_fts MATCH ? AND source_id = ? LIMIT ?`
    : `SELECT chunk_id, source_id, snippet(chunks_fts, 0, '', '', '…', 18) AS snippet
       FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?`;
  const params = sourceId ? [safe, sourceId, limit] : [safe, limit];
  try {
    return db().prepare(sql).all(...params) as { chunk_id: string; source_id: string; snippet: string }[];
  } catch {
    return [];
  }
}
