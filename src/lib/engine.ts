import crypto from "node:crypto";
import { all, get, tx, type Tx } from "./db";
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

async function loadCandidates(opts: StartOptions): Promise<CandidateRow[]> {
  if (opts.mode === "source" && opts.sourceId) {
    return all<CandidateRow>(candidateSql("WHERE q.source_id = ?"), [opts.sourceId]);
  }
  if (opts.mode === "category" && opts.category) {
    return all<CandidateRow>(candidateSql("WHERE q.category = ? AND q.source_id IS NULL"), [opts.category]);
  }
  // Imported material joins mixed and weak-topic rounds; the curated modes stay curated.
  const includeImported = opts.mode === "mixed" || opts.mode === "weak";
  return all<CandidateRow>(candidateSql(includeImported ? "" : "WHERE q.source_id IS NULL"));
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

export async function startSession(opts: StartOptions): Promise<{ sessionId: string; length: number }> {
  await ready();
  const now = Date.now();
  const length = Math.min(ROUND_MAX, Math.max(ROUND_MIN, opts.length ?? ROUND_DEFAULT));

  const daily = opts.mode === "daily";
  const seed = daily ? `daily:${todayKey()}` : crypto.randomUUID();
  const rand = mulberry32(hashSeed(seed));

  const rows = await loadCandidates(opts);
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

  await tx(async (t) => {
    await t.run(
      `INSERT INTO sessions (id, mode, category, source_id, seed, length, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, opts.mode, opts.category ?? null, opts.sourceId ?? null, seed, picked.length, now],
    );
    for (const [idx, row] of picked.entries()) {
      const optionCount = (JSON.parse(row.options) as string[]).length;
      const layout = shuffle(
        Array.from({ length: optionCount }, (_, i) => i),
        mulberry32(hashSeed(`${sessionId}:${row.id}`)),
      );
      await t.run("INSERT INTO session_queue (session_id, idx, question_id, layout) VALUES (?, ?, ?, ?)", [
        sessionId,
        idx,
        row.id,
        JSON.stringify(layout),
      ]);
    }
  });

  return { sessionId, length: picked.length };
}

function queueRow(sessionId: string, idx: number) {
  return get<QuestionRow & { layout: string; answered_at: number | null }>(
    `SELECT sq.idx, sq.question_id, sq.layout, sq.answered_at, q.*
     FROM session_queue sq JOIN questions q ON q.id = sq.question_id
     WHERE sq.session_id = ? AND sq.idx = ?`,
    [sessionId, idx],
  );
}

export async function serveQuestion(sessionId: string, idx: number): Promise<ServedQuestion | null> {
  await ready();
  const row = await queueRow(sessionId, idx);
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

async function updateQuestionState(
  t: Tx,
  questionId: string,
  correct: boolean,
  ms: number,
  now: number,
): Promise<void> {
  const prior = await t.get<{
    seen: number; correct: number; lapses: number; interval_h: number; ease: number; best_ms: number | null;
  }>("SELECT * FROM question_state WHERE question_id = ?", [questionId]);

  const ease = prior?.ease ?? 2.3;
  const intervalH = prior?.interval_h ?? 0;
  const nextEase = correct ? Math.min(2.8, ease + 0.1) : Math.max(1.4, ease - 0.25);
  const nextInterval = correct ? (intervalH === 0 ? 20 : intervalH * nextEase) : 4;
  const bestMs = correct ? Math.min(prior?.best_ms ?? ms, ms) : (prior?.best_ms ?? null);

  await t.run(
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
    {
      id: questionId,
      correct: correct ? 1 : 0,
      lapse: correct ? 0 : 1,
      now,
      due: now + nextInterval * 3_600_000,
      interval: nextInterval,
      ease: nextEase,
      best: bestMs,
    },
  );
}

async function updateMastery(
  t: Tx,
  category: string,
  topic: string,
  correct: boolean,
  ms: number,
  now: number,
): Promise<void> {
  const key = `${category}::${topic}`;
  const prior = await t.get<{ strength: number }>("SELECT strength FROM mastery WHERE key = ?", [key]);
  const alpha = 0.3;
  const quality = correct ? (ms < 8000 ? 1 : 0.9) : 0;
  const strength = (prior?.strength ?? 0.5) * (1 - alpha) + quality * alpha;

  await t.run(
    `INSERT INTO mastery (key, category, topic, seen, correct, total_ms, strength, last_seen)
     VALUES (@key, @category, @topic, 1, @correct, @ms, @strength, @now)
     ON CONFLICT(key) DO UPDATE SET
       seen = seen + 1,
       correct = correct + @correct,
       total_ms = total_ms + @ms,
       strength = @strength,
       last_seen = @now`,
    { key, category, topic, correct: correct ? 1 : 0, ms, strength, now },
  );
}

export async function answerQuestion(
  sessionId: string,
  idx: number,
  given: string,
  ms: number,
): Promise<AnswerResult> {
  await ready();
  const row = await queueRow(sessionId, idx);
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

  const session = await get<{
    total: number; correct: number; score: number; best_streak: number; avg_ms: number;
  }>("SELECT * FROM sessions WHERE id = ?", [sessionId]);
  if (!session) throw new Error("Unknown round.");
  const priorStreak = await currentStreak(sessionId);
  const streak = correct ? priorStreak + 1 : 0;
  const points = correct ? scoreFor(row.difficulty, clampedMs, priorStreak) : 0;
  const now = Date.now();

  if (row.answered_at == null) {
    await tx(async (t) => {
      await t.run("UPDATE session_queue SET answered_at = ? WHERE session_id = ? AND idx = ?", [now, sessionId, idx]);
      await t.run(
        `INSERT INTO attempts (session_id, question_id, category, topic, difficulty, level, correct, ms, given, points, at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        [sessionId, row.id, row.category, row.topic, row.difficulty, correct ? 1 : 0, clampedMs, given, points, now],
      );

      const total = session.total + 1;
      const avgMs = Math.round((session.avg_ms * session.total + clampedMs) / total);
      await t.run("UPDATE sessions SET total = ?, correct = ?, score = ?, best_streak = ?, avg_ms = ? WHERE id = ?", [
        total,
        session.correct + (correct ? 1 : 0),
        session.score + points,
        Math.max(session.best_streak, streak),
        avgMs,
        sessionId,
      ]);

      await updateQuestionState(t, row.id, correct, clampedMs, now);
      await updateMastery(t, row.category, row.topic, correct, clampedMs, now);
    });
  }

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

async function currentStreak(sessionId: string): Promise<number> {
  const rows = await all<{ correct: number }>(
    "SELECT correct FROM attempts WHERE session_id = ? AND level = 1 ORDER BY id DESC LIMIT 20",
    [sessionId],
  );
  let streak = 0;
  for (const r of rows) {
    if (r.correct) streak++;
    else break;
  }
  return streak;
}

export async function serveDeeper(sessionId: string, idx: number, step: number) {
  await ready();
  const row = await queueRow(sessionId, idx);
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

export async function answerDeeper(sessionId: string, idx: number, step: number, given: number, ms: number) {
  await ready();
  const row = await queueRow(sessionId, idx);
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

  await tx(async (t) => {
    await t.run(
      `INSERT INTO attempts (session_id, question_id, category, topic, difficulty, level, correct, ms, given, points, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, row.id, row.category, row.topic, row.difficulty, chosen.level, correct ? 1 : 0, clampedMs, String(given), points, now],
    );
    await t.run("UPDATE sessions SET score = score + ? WHERE id = ?", [points, sessionId]);
    await updateMastery(t, row.category, row.topic, correct, clampedMs, now);
  });

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

export async function finishSession(sessionId: string): Promise<SessionSummary> {
  await ready();
  const session = await get<{
    id: string; mode: Mode; category: string | null; total: number; correct: number;
    score: number; best_streak: number; avg_ms: number; ended_at: number | null; seed: string;
  }>("SELECT * FROM sessions WHERE id = ?", [sessionId]);
  if (!session) throw new Error("Unknown round.");

  const now = Date.now();
  if (session.ended_at == null) {
    await tx(async (t) => {
      await t.run("UPDATE sessions SET ended_at = ? WHERE id = ?", [now, sessionId]);
      const gainedXp = Math.round(session.score / 5);
      await t.run(
        "UPDATE profile SET xp = xp + ?, games = games + 1, best_streak = MAX(best_streak, ?) WHERE id = 1",
        [gainedXp, session.best_streak],
      );

      if (session.mode === "daily") {
        const key = todayKey();
        await t.run(
          `INSERT INTO daily (date, session_id, score, correct, total, done_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(date) DO UPDATE SET session_id = excluded.session_id, score = MAX(score, excluded.score),
             correct = excluded.correct, total = excluded.total, done_at = excluded.done_at`,
          [key, sessionId, session.score, session.correct, session.total, now],
        );
        await bumpDailyStreak(t, key);
      }
    });
  }

  const profile = await get<{ xp: number }>("SELECT xp FROM profile WHERE id = 1");
  const xp = profile?.xp ?? 0;
  const { level, progress } = levelFromXp(xp);

  const breakdown = await all<{ topic: string; category: string; correct: number; total: number }>(
    `SELECT topic, category, SUM(correct) AS correct, COUNT(*) AS total
     FROM attempts WHERE session_id = ? AND level = 1 GROUP BY category, topic ORDER BY total DESC`,
    [sessionId],
  );

  const missed = await all<{
    id: string; prompt: string; options: string; answer: string; explanation: string; topic: string;
  }>(
    `SELECT q.id, q.prompt, q.options, q.answer, q.explanation, q.topic
     FROM attempts a JOIN questions q ON q.id = a.question_id
     WHERE a.session_id = ? AND a.level = 1 AND a.correct = 0`,
    [sessionId],
  );

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
    xp,
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

async function bumpDailyStreak(t: Tx, dateKey: string): Promise<void> {
  const profile = await t.get<{ daily_streak: number; last_daily: string | null }>(
    "SELECT daily_streak, last_daily FROM profile WHERE id = 1",
  );
  if (!profile || profile.last_daily === dateKey) return;
  const yesterday = new Date(`${dateKey}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = todayKey(yesterday);
  const streak = profile.last_daily === yKey ? profile.daily_streak + 1 : 1;
  await t.run("UPDATE profile SET daily_streak = ?, last_daily = ? WHERE id = 1", [streak, dateKey]);
}

export async function dailyDone(): Promise<boolean> {
  await ready();
  const row = await get("SELECT date FROM daily WHERE date = ?", [todayKey()]);
  return Boolean(row);
}
