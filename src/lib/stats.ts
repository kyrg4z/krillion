import { db } from "./db";
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

export function overview(): Overview {
  ready();
  const conn = db();
  const profile = conn.prepare("SELECT * FROM profile WHERE id = 1").get() as {
    xp: number; games: number; best_streak: number; daily_streak: number; last_daily: string | null;
  };
  const totals = conn
    .prepare("SELECT COUNT(*) AS n, SUM(correct) AS c, AVG(ms) AS avg FROM attempts WHERE level = 1")
    .get() as { n: number; c: number | null; avg: number | null };
  const seen = (conn.prepare("SELECT COUNT(*) AS n FROM question_state WHERE seen > 0").get() as { n: number }).n;
  const bank = (conn.prepare("SELECT COUNT(*) AS n FROM questions").get() as { n: number }).n;
  const due = (
    conn.prepare("SELECT COUNT(*) AS n FROM question_state WHERE next_due IS NOT NULL AND next_due <= ?").get(Date.now()) as { n: number }
  ).n;
  const { level, progress } = levelFromXp(profile.xp);

  return {
    xp: profile.xp,
    level,
    levelProgress: progress,
    games: profile.games,
    bestStreak: profile.best_streak,
    dailyStreak: profile.daily_streak,
    dailyDoneToday: profile.last_daily === todayKey(),
    answered: totals.n,
    accuracy: totals.n ? (totals.c ?? 0) / totals.n : 0,
    avgMs: Math.round(totals.avg ?? 0),
    questionsSeen: seen,
    questionsTotal: bank,
    dueNow: due,
  };
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

export function categoryStats(): CategoryStat[] {
  ready();
  const conn = db();
  const rows = conn
    .prepare(
      `SELECT q.category AS id,
              COUNT(q.id) AS bankSize,
              SUM(CASE WHEN s.seen > 0 THEN 1 ELSE 0 END) AS seen
       FROM questions q LEFT JOIN question_state s ON s.question_id = q.id
       GROUP BY q.category`,
    )
    .all() as { id: string; bankSize: number; seen: number | null }[];
  const attempts = conn
    .prepare(
      `SELECT category AS id, COUNT(*) AS answered, SUM(correct) AS correct
       FROM attempts WHERE level = 1 GROUP BY category`,
    )
    .all() as { id: string; answered: number; correct: number }[];
  const strengths = conn
    .prepare("SELECT category AS id, AVG(strength) AS strength FROM mastery GROUP BY category")
    .all() as { id: string; strength: number }[];

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

export function topicStats(order: "weak" | "strong" = "weak", limit = 8): TopicStat[] {
  ready();
  const rows = db()
    .prepare(
      `SELECT category, topic, seen, correct, strength FROM mastery
       WHERE seen >= 2 ORDER BY strength ${order === "weak" ? "ASC" : "DESC"} LIMIT ?`,
    )
    .all(limit) as { category: string; topic: string; seen: number; correct: number; strength: number }[];
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

export function recentSessions(limit = 8): RecentSession[] {
  ready();
  const rows = db()
    .prepare(
      `SELECT id, mode, category, score, correct, total, started_at AS startedAt, avg_ms AS avgMs
       FROM sessions WHERE ended_at IS NOT NULL ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit) as RecentSession[];
  return rows;
}

/** Answers per day for the last n days, oldest first — drives the activity strip. */
export function activity(days = 28): { date: string; answered: number; correct: number }[] {
  ready();
  const out: { date: string; answered: number; correct: number }[] = [];
  const rows = db()
    .prepare(
      `SELECT date(at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS answered, SUM(correct) AS correct
       FROM attempts WHERE level = 1 GROUP BY day`,
    )
    .all() as { day: string; answered: number; correct: number }[];
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

export function weakTopicAvailable(): boolean {
  ready();
  const row = db().prepare("SELECT COUNT(*) AS n FROM mastery WHERE seen >= 2").get() as { n: number };
  return row.n > 0;
}
