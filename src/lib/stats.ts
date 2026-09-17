import type { InArgs } from "@libsql/client";
import { all, get } from "./db";
import { ready } from "./seed-loader";
import { levelFromXp } from "./engine";
import { CATEGORIES } from "./categories";
import { todayKey } from "./rng";

export type Overview = {
  xp: number;
  level: number;
  levelProgress: number;
  games: number;
  bestStreak: number;
  dailyStreak: number;
  dailyDoneToday: boolean;
  answered: number;
  accuracy: number;
  avgMs: number;
  questionsSeen: number;
  questionsTotal: number;
  dueNow: number;
};

export async function overview(): Promise<Overview> {
  await ready();
  const profile = await get<{
    xp: number; games: number; best_streak: number; daily_streak: number; last_daily: string | null;
  }>("SELECT * FROM profile WHERE id = 1");
  const totals = await get<{ n: number; c: number | null; avg: number | null }>(
    "SELECT COUNT(*) AS n, SUM(correct) AS c, AVG(ms) AS avg FROM attempts WHERE level = 1",
  );
  const seen = await count("SELECT COUNT(*) AS n FROM question_state WHERE seen > 0");
  const bank = await count("SELECT COUNT(*) AS n FROM questions");
  const due = await count(
    "SELECT COUNT(*) AS n FROM question_state WHERE next_due IS NOT NULL AND next_due <= ?",
    [Date.now()],
  );
  const xp = profile?.xp ?? 0;
  const answered = totals?.n ?? 0;
  const { level, progress } = levelFromXp(xp);

  return {
    xp,
    level,
    levelProgress: progress,
    games: profile?.games ?? 0,
    bestStreak: profile?.best_streak ?? 0,
    dailyStreak: profile?.daily_streak ?? 0,
    dailyDoneToday: profile?.last_daily === todayKey(),
    answered,
    accuracy: answered ? (totals?.c ?? 0) / answered : 0,
    avgMs: Math.round(totals?.avg ?? 0),
    questionsSeen: seen,
    questionsTotal: bank,
    dueNow: due,
  };
}

async function count(sql: string, args: InArgs = []): Promise<number> {
  const row = await get<{ n: number }>(sql, args);
  return row?.n ?? 0;
}

export type CategoryStat = {
  id: string;
  name: string;
  hue: number;
  answered: number;
  accuracy: number;
  strength: number;
  bankSize: number;
  seen: number;
};

export async function categoryStats(): Promise<CategoryStat[]> {
  await ready();
  const rows = await all<{ id: string; bankSize: number; seen: number | null }>(
    `SELECT q.category AS id,
            COUNT(q.id) AS bankSize,
            SUM(CASE WHEN s.seen > 0 THEN 1 ELSE 0 END) AS seen
     FROM questions q LEFT JOIN question_state s ON s.question_id = q.id
     GROUP BY q.category`,
  );
  const attempts = await all<{ id: string; answered: number; correct: number }>(
    `SELECT category AS id, COUNT(*) AS answered, SUM(correct) AS correct
     FROM attempts WHERE level = 1 GROUP BY category`,
  );
  const strengths = await all<{ id: string; strength: number }>(
    "SELECT category AS id, AVG(strength) AS strength FROM mastery GROUP BY category",
  );

  const bankBy = new Map(rows.map((r) => [r.id, r]));
  const attemptBy = new Map(attempts.map((r) => [r.id, r]));
  const strengthBy = new Map(strengths.map((r) => [r.id, r.strength]));

  return CATEGORIES.map((c) => {
    const bank = bankBy.get(c.id);
    const att = attemptBy.get(c.id);
    return {
      id: c.id,
      name: c.name,
      hue: c.hue,
      bankSize: bank?.bankSize ?? 0,
      seen: bank?.seen ?? 0,
      answered: att?.answered ?? 0,
      accuracy: att && att.answered ? att.correct / att.answered : 0,
      strength: strengthBy.get(c.id) ?? 0,
    };
  });
}

export type TopicStat = { category: string; topic: string; seen: number; accuracy: number; strength: number };

export async function topicStats(order: "weak" | "strong" = "weak", limit = 8): Promise<TopicStat[]> {
  await ready();
  const rows = await all<{ category: string; topic: string; seen: number; correct: number; strength: number }>(
    `SELECT category, topic, seen, correct, strength FROM mastery
     WHERE seen >= 2 ORDER BY strength ${order === "weak" ? "ASC" : "DESC"} LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    category: r.category,
    topic: r.topic,
    seen: r.seen,
    accuracy: r.seen ? r.correct / r.seen : 0,
    strength: r.strength,
  }));
}

export type RecentSession = {
  id: string; mode: string; category: string | null; score: number;
  correct: number; total: number; startedAt: number; avgMs: number;
};

export async function recentSessions(limit = 8): Promise<RecentSession[]> {
  await ready();
  return all<RecentSession>(
    `SELECT id, mode, category, score, correct, total, started_at AS startedAt, avg_ms AS avgMs
     FROM sessions WHERE ended_at IS NOT NULL ORDER BY started_at DESC LIMIT ?`,
    [limit],
  );
}

/** Answers per day for the last n days, oldest first — drives the activity strip. */
export async function activity(days = 28): Promise<{ date: string; answered: number; correct: number }[]> {
  await ready();
  const out: { date: string; answered: number; correct: number }[] = [];
  const rows = await all<{ day: string; answered: number; correct: number }>(
    `SELECT date(at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS answered, SUM(correct) AS correct
     FROM attempts WHERE level = 1 GROUP BY day`,
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = todayKey(d);
    const row = byDay.get(key);
    out.push({ date: key, answered: row?.answered ?? 0, correct: row?.correct ?? 0 });
  }
  return out;
}

export async function weakTopicAvailable(): Promise<boolean> {
  await ready();
  return (await count("SELECT COUNT(*) AS n FROM mastery WHERE seen >= 2")) > 0;
}
