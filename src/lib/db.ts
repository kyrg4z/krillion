import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.KRILLION_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "krillion.db");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS questions (
  id           TEXT PRIMARY KEY,
  category     TEXT NOT NULL,
  topic        TEXT NOT NULL,
  difficulty   INTEGER NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'mc',
  prompt       TEXT NOT NULL,
  options      TEXT NOT NULL DEFAULT '[]',
  answer       TEXT NOT NULL,
  aliases      TEXT NOT NULL DEFAULT '[]',
  explanation  TEXT NOT NULL DEFAULT '',
  deeper       TEXT NOT NULL DEFAULT '[]',
  source_id    TEXT,
  source_ref   TEXT,
  origin       TEXT NOT NULL DEFAULT 'seed',
  fingerprint  TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_questions_category ON questions(category);
CREATE INDEX IF NOT EXISTS ix_questions_topic ON questions(category, topic);
CREATE INDEX IF NOT EXISTS ix_questions_source ON questions(source_id);
CREATE INDEX IF NOT EXISTS ix_questions_fingerprint ON questions(fingerprint);

CREATE TABLE IF NOT EXISTS question_state (
  question_id  TEXT PRIMARY KEY,
  seen         INTEGER NOT NULL DEFAULT 0,
  correct      INTEGER NOT NULL DEFAULT 0,
  lapses       INTEGER NOT NULL DEFAULT 0,
  last_seen    INTEGER,
  next_due     INTEGER,
  interval_h   REAL NOT NULL DEFAULT 0,
  ease         REAL NOT NULL DEFAULT 2.3,
  best_ms      INTEGER
);

CREATE TABLE IF NOT EXISTS mastery (
  key        TEXT PRIMARY KEY,
  category   TEXT NOT NULL,
  topic      TEXT NOT NULL,
  seen       INTEGER NOT NULL DEFAULT 0,
  correct    INTEGER NOT NULL DEFAULT 0,
  total_ms   INTEGER NOT NULL DEFAULT 0,
  strength   REAL NOT NULL DEFAULT 0.5,
  last_seen  INTEGER
);
CREATE INDEX IF NOT EXISTS ix_mastery_category ON mastery(category);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  mode        TEXT NOT NULL,
  category    TEXT,
  source_id   TEXT,
  seed        TEXT,
  length      INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  total       INTEGER NOT NULL DEFAULT 0,
  correct     INTEGER NOT NULL DEFAULT 0,
  score       INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  avg_ms      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_sessions_started ON sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS session_queue (
  session_id  TEXT NOT NULL,
  idx         INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  layout      TEXT NOT NULL DEFAULT '[]',
  answered_at INTEGER,
  PRIMARY KEY (session_id, idx)
);

CREATE TABLE IF NOT EXISTS attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT,
  question_id TEXT NOT NULL,
  category    TEXT NOT NULL,
  topic       TEXT NOT NULL,
  difficulty  INTEGER NOT NULL,
  level       INTEGER NOT NULL DEFAULT 1,
  correct     INTEGER NOT NULL,
  ms          INTEGER NOT NULL,
  given       TEXT,
  points      INTEGER NOT NULL DEFAULT 0,
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_attempts_at ON attempts(at DESC);
CREATE INDEX IF NOT EXISTS ix_attempts_question ON attempts(question_id);

CREATE TABLE IF NOT EXISTS sources (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  filename   TEXT,
  added_at   INTEGER NOT NULL,
  chars      INTEGER NOT NULL DEFAULT 0,
  chunks     INTEGER NOT NULL DEFAULT 0,
  questions  INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'ready',
  note       TEXT
);

CREATE TABLE IF NOT EXISTS chunks (
  id        TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  idx       INTEGER NOT NULL,
  ref       TEXT,
  text      TEXT NOT NULL,
  used      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_chunks_source ON chunks(source_id, idx);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, chunk_id UNINDEXED, source_id UNINDEXED);

CREATE TABLE IF NOT EXISTS daily (
  date       TEXT PRIMARY KEY,
  session_id TEXT,
  score      INTEGER NOT NULL DEFAULT 0,
  correct    INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL DEFAULT 0,
  done_at    INTEGER
);

CREATE TABLE IF NOT EXISTS profile (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  xp           INTEGER NOT NULL DEFAULT 0,
  games        INTEGER NOT NULL DEFAULT 0,
  best_streak  INTEGER NOT NULL DEFAULT 0,
  daily_streak INTEGER NOT NULL DEFAULT 0,
  last_daily   TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO profile (id) VALUES (1);
`;

type Conn = Database.Database;

const g = globalThis as unknown as { __krillionDb?: Conn };

function open(): Conn {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const conn = new Database(DB_PATH);
  conn.pragma("busy_timeout = 5000");
  conn.exec(SCHEMA);
  return conn;
}

export function db(): Conn {
  if (!g.__krillionDb) g.__krillionDb = open();
  return g.__krillionDb;
}

export function getMeta(key: string): string | null {
  const row = db().prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db()
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export const DATA_DIRECTORY = DATA_DIR;
