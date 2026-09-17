import crypto from "node:crypto";
import { db } from "./db";
import { ready } from "./seed-loader";
import { categoryName } from "./categories";
import { hashSeed, mulberry32, shuffle, todayKey } from "./rng";
import { answerMatches } from "./grade";
import type { AnswerResult, CategoryId, DeeperStep, Mode, ServedQuestion } from "./types";

export type StartOptions = {
  mode: Mode;
  category?: CategoryId | null;
  sourceId?: string | null;
  length?: number;
};

type QuestionRow = {
  id: string;
  category: string;
  topic: string;
  difficulty: number;
  kind: string;
  prompt: string;
  options: string;
  answer: string;
  aliases: string;
  explanation: string;
  deeper: string;
  source_ref: string | null;
};

type CandidateRow = QuestionRow & {
  seen: number | null;
  correct: number | null;
  last_seen: number | null;
  next_due: number | null;
  strength: number | null;
};

const ROUND_DEFAULT = 8;
const ROUND_MIN = 5;
const ROUND_MAX = 10;

function candidateSql(where: string): string {
  return `
    SELECT q.id, q.category, q.topic, q.difficulty, q.kind, q.prompt, q.options, q.answer,
           q.aliases, q.explanation, q.deeper, q.source_ref,
           s.seen, s.correct, s.last_seen, s.next_due, m.strength
    FROM questions q
    LEFT JOIN question_state s ON s.question_id = q.id
    LEFT JOIN mastery m ON m.key = q.category || '::' || q.topic
    ${where}
  `;
}

function loadCandidates(opts: StartOptions): CandidateRow[] {
  const conn = db();
  if (opts.mode === "source" && opts.sourceId) {
    return conn.prepare(candidateSql("WHERE q.source_id = ?")).all(opts.sourceId) as CandidateRow[];
  }
  if (opts.mode === "category" && opts.category) {
    return conn
      .prepare(candidateSql("WHERE q.category = ? AND q.source_id IS NULL"))
      .all(opts.category) as CandidateRow[];
  }
  // Imported material joins mixed and weak-topic rounds; the curated modes stay curated.
  const includeImported = opts.mode === "mixed" || opts.mode === "weak";
  return conn
    .prepare(candidateSql(includeImported ? "" : "WHERE q.source_id IS NULL"))
    .all() as CandidateRow[];
}

/**
 * Ranks candidates entirely in SQL-fed JavaScript: unseen first, then due for review,
 * then weak topics, with a seeded jitter so rounds are varied but reproducible.
 */
function rankCandidates(rows: CandidateRow[], mode: Mode, rand: () => number, now: number): CandidateRow[] {
  const scored = rows.map((row) => {
    const seen = row.seen ?? 0;
    const strength = row.strength ?? 0.5;
    const accuracy = seen > 0 ? (row.correct ?? 0) / seen : 0.5;

    let score = 0;
    if (seen === 0) score += 1.0;
    if (row.next_due != null && row.next_due <= now) score += 0.8;
    score += (1 - strength) * (mode === "weak" ? 2.4 : 0.9);
    score += (1 - accuracy) * (mode === "weak" ? 1.2 : 0.4);

    if (row.last_seen != null) {
      const hoursSince = (now - row.last_seen) / 3_600_000;
      if (hoursSince < 6) score -= 1.6;
      else if (hoursSince < 24) score -= 0.6;
    }
    if (mode === "random" || mode === "daily") score = 0;
    return { row, score: score + rand() * (mode === "weak" ? 0.35 : 0.9) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.row);
}

/** Keeps a round from turning into eight questions on the same topic. */
function diversify(rows: CandidateRow[], count: number, spreadCategories: boolean): CandidateRow[] {
  const picked: CandidateRow[] = [];
  const topicCount = new Map<string, number>();
  const catCount = new Map<string, number>();
  const capTopic = 2;
  const capCat = spreadCategories ? Math.max(2, Math.ceil(count / 3)) : count;

  for (const pass of [0, 1]) {
    for (const row of rows) {
      if (picked.length >= count) break;
      if (picked.includes(row)) continue;
      if (pass === 0) {
        if ((topicCount.get(row.topic) ?? 0) >= capTopic) continue;
        if ((catCount.get(row.category) ?? 0) >= capCat) continue;
      }
      picked.push(row);
      topicCount.set(row.topic, (topicCount.get(row.topic) ?? 0) + 1);
      catCount.set(row.category, (catCount.get(row.category) ?? 0) + 1);
    }
  }
  return picked;
}

export function startSession(opts: StartOptions): { sessionId: string; length: number } {
  ready();
  const conn = db();
  const now = Date.now();
  const length = Math.min(ROUND_MAX, Math.max(ROUND_MIN, opts.length ?? ROUND_DEFAULT));

  const daily = opts.mode === "daily";
  const seed = daily ? `daily:${todayKey()}` : crypto.randomUUID();
  const rand = mulberry32(hashSeed(seed));

  const rows = loadCandidates(opts);
  if (rows.length === 0) throw new Error("No questions available for that selection.");

  let ordered: CandidateRow[];
  if (daily) {
    ordered = shuffle(rows, rand);
  } else {
    ordered = rankCandidates(rows, opts.mode, rand, now);
  }

  const spread = opts.mode !== "category" && opts.mode !== "source";
  let picked = diversify(ordered, length, spread);
  // Gentle ramp: open easy, finish hard.
  picked.sort((a, b) => a.difficulty - b.difficulty);

  const sessionId = crypto.randomUUID();
  const insertSession = conn.prepare(`
    INSERT INTO sessions (id, mode, category, source_id, seed, length, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertQueue = conn.prepare(`
    INSERT INTO session_queue (session_id, idx, question_id, layout) VALUES (?, ?, ?, ?)
  `);

  conn.transaction(() => {
    insertSession.run(sessionId, opts.mode, opts.category ?? null, opts.sourceId ?? null, seed, picked.length, now);
    picked.forEach((row, idx) => {
      const optionCount = (JSON.parse(row.options) as string[]).length;
      const layout = shuffle(
        Array.from({ length: optionCount }, (_, i) => i),
        mulberry32(hashSeed(`${sessionId}:${row.id}`)),
      );
      insertQueue.run(sessionId, idx, row.id, JSON.stringify(layout));
    });
  })();

  return { sessionId, length: picked.length };
}

function queueRow(sessionId: string, idx: number) {
  const row = db()
    .prepare(
      `SELECT sq.idx, sq.question_id, sq.layout, sq.answered_at, q.*
       FROM session_queue sq JOIN questions q ON q.id = sq.question_id
       WHERE sq.session_id = ? AND sq.idx = ?`,
    )
    .get(sessionId, idx) as (QuestionRow & { layout: string; answered_at: number | null }) | undefined;
  return row;
}

export function serveQuestion(sessionId: string, idx: number): ServedQuestion | null {
  ready();
  const row = queueRow(sessionId, idx);
  if (!row) return null;
  const options = JSON.parse(row.options) as string[];
  const layout = JSON.parse(row.layout) as number[];
  const deeper = JSON.parse(row.deeper) as DeeperStep[];
  return {
    id: row.id,
    category: row.category as CategoryId,
    categoryName: categoryName(row.category),
    topic: row.topic,
    difficulty: row.difficulty as 1 | 2 | 3,
    kind: row.kind as "mc" | "short",
    prompt: row.prompt,
    options: row.kind === "mc" ? layout.map((i) => options[i]) : [],
    sourceRef: row.source_ref,
    hasDeeper: deeper.length > 0,
  };
}

function scoreFor(difficulty: number, ms: number, streak: number): number {
  const base = difficulty * 100;
  const speed = Math.max(0, 1 - ms / 15000) * base * 0.5;
  const multiplier = 1 + Math.min(streak, 10) * 0.1;
  return Math.round((base + speed) * multiplier);
}

function updateQuestionState(questionId: string, correct: boolean, ms: number, now: number): void {
  const conn = db();
  const prior = conn.prepare("SELECT * FROM question_state WHERE question_id = ?").get(questionId) as
    | { seen: number; correct: number; lapses: number; interval_h: number; ease: number; best_ms: number | null }
    | undefined;

  const ease = prior?.ease ?? 2.3;
  const intervalH = prior?.interval_h ?? 0;
  const nextEase = correct ? Math.min(2.8, ease + 0.1) : Math.max(1.4, ease - 0.25);
  const nextInterval = correct ? (intervalH === 0 ? 20 : intervalH * nextEase) : 4;
  const bestMs = correct ? Math.min(prior?.best_ms ?? ms, ms) : (prior?.best_ms ?? null);

  conn
    .prepare(
      `INSERT INTO question_state (question_id, seen, correct, lapses, last_seen, next_due, interval_h, ease, best_ms)
       VALUES (@id, 1, @correct, @lapse, @now, @due, @interval, @ease, @best)
       ON CONFLICT(question_id) DO UPDATE SET
         seen = seen + 1,
         correct = correct + @correct,
         lapses = lapses + @lapse,
         last_seen = @now,
         next_due = @due,
         interval_h = @interval,
         ease = @ease,
         best_ms = @best`,
    )
    .run({
      id: questionId,
      correct: correct ? 1 : 0,
      lapse: correct ? 0 : 1,
      now,
      due: now + nextInterval * 3_600_000,
      interval: nextInterval,
      ease: nextEase,
      best: bestMs,
    });
}

function updateMastery(category: string, topic: string, correct: boolean, ms: number, now: number): void {
  const key = `${category}::${topic}`;
  const conn = db();
  const prior = conn.prepare("SELECT strength FROM mastery WHERE key = ?").get(key) as
    | { strength: number }
    | undefined;
  const alpha = 0.3;
  const quality = correct ? (ms < 8000 ? 1 : 0.9) : 0;
  const strength = (prior?.strength ?? 0.5) * (1 - alpha) + quality * alpha;

  conn
    .prepare(
      `INSERT INTO mastery (key, category, topic, seen, correct, total_ms, strength, last_seen)
       VALUES (@key, @category, @topic, 1, @correct, @ms, @strength, @now)
       ON CONFLICT(key) DO UPDATE SET
         seen = seen + 1,
         correct = correct + @correct,
         total_ms = total_ms + @ms,
         strength = @strength,
         last_seen = @now`,
    )
    .run({ key, category, topic, correct: correct ? 1 : 0, ms, strength, now });
}

export function answerQuestion(
  sessionId: string,
  idx: number,
  given: string,
  ms: number,
): AnswerResult {
  ready();
  const conn = db();
  const row = queueRow(sessionId, idx);
  if (!row) throw new Error("Question not found in this round.");

  const options = JSON.parse(row.options) as string[];
  const layout = JSON.parse(row.layout) as number[];
  const deeper = JSON.parse(row.deeper) as DeeperStep[];
  const clampedMs = Math.max(200, Math.min(ms, 120_000));

  let correct: boolean;
  let answerIndex = -1;
  let answerText: string;

  if (row.kind === "mc") {
    const trueIndex = Number(row.answer);
    answerIndex = layout.indexOf(trueIndex);
    answerText = options[trueIndex];
    correct = Number(given) === answerIndex;
  } else {
    answerText = row.answer;
    correct = answerMatches(given, row.answer, JSON.parse(row.aliases) as string[]);
  }

  const session = conn.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as {
    total: number; correct: number; score: number; best_streak: number; avg_ms: number;
  };
  const priorStreak = currentStreak(sessionId);
  const streak = correct ? priorStreak + 1 : 0;
  const points = correct ? scoreFor(row.difficulty, clampedMs, priorStreak) : 0;
  const now = Date.now();

  conn.transaction(() => {
    if (row.answered_at == null) {
      conn.prepare("UPDATE session_queue SET answered_at = ? WHERE session_id = ? AND idx = ?").run(now, sessionId, idx);
      conn
        .prepare(
          `INSERT INTO attempts (session_id, question_id, category, topic, difficulty, level, correct, ms, given, points, at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(sessionId, row.id, row.category, row.topic, row.difficulty, correct ? 1 : 0, clampedMs, given, points, now);

      const total = session.total + 1;
      const avgMs = Math.round((session.avg_ms * session.total + clampedMs) / total);
      conn
        .prepare(
          `UPDATE sessions SET total = ?, correct = ?, score = ?, best_streak = ?, avg_ms = ? WHERE id = ?`,
        )
        .run(total, session.correct + (correct ? 1 : 0), session.score + points, Math.max(session.best_streak, streak), avgMs, sessionId);

      updateQuestionState(row.id, correct, clampedMs, now);
      updateMastery(row.category, row.topic, correct, clampedMs, now);
    }
  })();

  return {
    correct,
    answerIndex,
    answerText,
    explanation: row.explanation,
    points,
    streak,
    hasDeeper: deeper.length > 0,
  };
}

function currentStreak(sessionId: string): number {
  const rows = db()
    .prepare("SELECT correct FROM attempts WHERE session_id = ? AND level = 1 ORDER BY id DESC LIMIT 20")
    .all(sessionId) as { correct: number }[];
  let streak = 0;
  for (const r of rows) {
    if (r.correct) streak++;
    else break;
  }
  return streak;
}

export function serveDeeper(sessionId: string, idx: number, step: number) {
  ready();
  const row = queueRow(sessionId, idx);
  if (!row) return null;
  const steps = JSON.parse(row.deeper) as DeeperStep[];
  const chosen = steps[step];
  if (!chosen) return null;
  const layout = shuffle(
    Array.from({ length: chosen.options.length }, (_, i) => i),
    mulberry32(hashSeed(`${sessionId}:${row.id}:d${step}`)),
  );
  return {
    level: chosen.level,
    prompt: chosen.prompt,
    options: layout.map((i) => chosen.options[i]),
    stepCount: steps.length,
    step,
  };
}

export function answerDeeper(sessionId: string, idx: number, step: number, given: number, ms: number) {
  ready();
  const conn = db();
  const row = queueRow(sessionId, idx);
  if (!row) throw new Error("Question not found in this round.");
  const steps = JSON.parse(row.deeper) as DeeperStep[];
  const chosen = steps[step];
  if (!chosen) throw new Error("No such follow-up.");

  const layout = shuffle(
    Array.from({ length: chosen.options.length }, (_, i) => i),
    mulberry32(hashSeed(`${sessionId}:${row.id}:d${step}`)),
  );
  const answerIndex = layout.indexOf(chosen.answer);
  const correct = given === answerIndex;
  const points = correct ? 150 * chosen.level : 0;
  const now = Date.now();
  const clampedMs = Math.max(200, Math.min(ms, 120_000));

  conn.transaction(() => {
    conn
      .prepare(
        `INSERT INTO attempts (session_id, question_id, category, topic, difficulty, level, correct, ms, given, points, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, row.id, row.category, row.topic, row.difficulty, chosen.level, correct ? 1 : 0, clampedMs, String(given), points, now);
    conn.prepare("UPDATE sessions SET score = score + ? WHERE id = ?").run(points, sessionId);
    updateMastery(row.category, row.topic, correct, clampedMs, now);
  })();

  return {
    correct,
    answerIndex,
    answerText: chosen.options[chosen.answer],
    explanation: chosen.explanation,
    points,
    hasNext: step + 1 < steps.length,
  };
}

export type SessionSummary = {
  id: string;
  mode: Mode;
  category: string | null;
  total: number;
  correct: number;
  score: number;
  bestStreak: number;
  avgMs: number;
  accuracy: number;
  xp: number;
  level: number;
  levelProgress: number;
  breakdown: { topic: string; category: string; correct: number; total: number }[];
  missed: { id: string; prompt: string; answer: string; explanation: string; topic: string }[];
};

export function levelFromXp(xp: number): { level: number; progress: number; nextAt: number } {
  const level = Math.floor(Math.sqrt(xp / 250)) + 1;
  const current = (level - 1) ** 2 * 250;
  const next = level ** 2 * 250;
  return { level, progress: next === current ? 0 : (xp - current) / (next - current), nextAt: next };
}

export function finishSession(sessionId: string): SessionSummary {
  ready();
  const conn = db();
  const session = conn.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as {
    id: string; mode: Mode; category: string | null; total: number; correct: number;
    score: number; best_streak: number; avg_ms: number; ended_at: number | null; seed: string;
  };
  if (!session) throw new Error("Unknown round.");

  const now = Date.now();
  if (session.ended_at == null) {
    conn.transaction(() => {
      conn.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(now, sessionId);
      const gainedXp = Math.round(session.score / 5);
      conn
        .prepare("UPDATE profile SET xp = xp + ?, games = games + 1, best_streak = MAX(best_streak, ?) WHERE id = 1")
        .run(gainedXp, session.best_streak);

      if (session.mode === "daily") {
        const key = todayKey();
        conn
          .prepare(
            `INSERT INTO daily (date, session_id, score, correct, total, done_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(date) DO UPDATE SET session_id = excluded.session_id, score = MAX(score, excluded.score),
               correct = excluded.correct, total = excluded.total, done_at = excluded.done_at`,
          )
          .run(key, sessionId, session.score, session.correct, session.total, now);
        bumpDailyStreak(key);
      }
    })();
  }

  const profile = conn.prepare("SELECT xp FROM profile WHERE id = 1").get() as { xp: number };
  const { level, progress } = levelFromXp(profile.xp);

  const breakdown = conn
    .prepare(
      `SELECT topic, category, SUM(correct) AS correct, COUNT(*) AS total
       FROM attempts WHERE session_id = ? AND level = 1 GROUP BY category, topic ORDER BY total DESC`,
    )
    .all(sessionId) as { topic: string; category: string; correct: number; total: number }[];

  const missed = conn
    .prepare(
      `SELECT q.id, q.prompt, q.options, q.answer, q.explanation, q.topic
       FROM attempts a JOIN questions q ON q.id = a.question_id
       WHERE a.session_id = ? AND a.level = 1 AND a.correct = 0`,
    )
    .all(sessionId) as { id: string; prompt: string; options: string; answer: string; explanation: string; topic: string }[];

  return {
    id: session.id,
    mode: session.mode,
    category: session.category,
    total: session.total,
    correct: session.correct,
    score: session.score,
    bestStreak: session.best_streak,
    avgMs: session.avg_ms,
    accuracy: session.total ? session.correct / session.total : 0,
    xp: profile.xp,
    level,
    levelProgress: progress,
    breakdown,
    missed: missed.map((m) => ({
      id: m.id,
      prompt: m.prompt,
      answer: (JSON.parse(m.options) as string[])[Number(m.answer)] ?? m.answer,
      explanation: m.explanation,
      topic: m.topic,
    })),
  };
}

function bumpDailyStreak(dateKey: string): void {
  const conn = db();
  const profile = conn.prepare("SELECT daily_streak, last_daily FROM profile WHERE id = 1").get() as {
    daily_streak: number; last_daily: string | null;
  };
  if (profile.last_daily === dateKey) return;
  const yesterday = new Date(`${dateKey}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = todayKey(yesterday);
  const streak = profile.last_daily === yKey ? profile.daily_streak + 1 : 1;
  conn.prepare("UPDATE profile SET daily_streak = ?, last_daily = ? WHERE id = 1").run(streak, dateKey);
}

export function dailyDone(): boolean {
  ready();
  const row = db().prepare("SELECT date FROM daily WHERE date = ?").get(todayKey());
  return Boolean(row);
}
