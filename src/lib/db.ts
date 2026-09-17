import { createClient, type Client, type InArgs, type Transaction } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

/**
 * Storage is libSQL. In production that is a hosted Turso database reached over
 * HTTP — serverless hosts give each request a read-only filesystem, so a local
 * SQLite file cannot hold progress there. Local development falls back to a
 * plain file so nothing extra is needed to run the app.
 */
const REMOTE_URL = process.env.TURSO_DATABASE_URL ?? "";
const AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN ?? "";
const DATA_DIR = process.env.KRILLION_DATA_DIR ?? path.join(process.cwd(), "data");

// PRAGMAs are deliberately absent: the hosted server owns journalling, and the
// schema declares no foreign keys.
const SCHEMA = `
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

const g = globalThis as unknown as {
  __krillionClient?: Client;
  __krillionSchema?: Promise<void>;
};

function client(): Client {
  if (g.__krillionClient) return g.__krillionClient;

  if (REMOTE_URL) {
    g.__krillionClient = createClient({ url: REMOTE_URL, authToken: AUTH_TOKEN || undefined });
    return g.__krillionClient;
  }

  // Falling back to a file on a serverless host would fail later, deep in a
  // request, with an unreadable EROFS. Say what is actually missing instead.
  if (process.env.VERCEL) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. A deployed build stores progress in a hosted " +
        "libSQL database; set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the project's " +
        "environment variables and redeploy.",
    );
  }

  // Local file mode, for development, where the working directory is writable.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  g.__krillionClient = createClient({ url: `file:${path.join(DATA_DIR, "krillion.db")}` });
  return g.__krillionClient;
}

/** Applies the schema once per process, and retries on the next call if it fails. */
async function migrated(conn: Client): Promise<void> {
  if (!g.__krillionSchema) {
    g.__krillionSchema = conn.executeMultiple(SCHEMA).catch((error: unknown) => {
      g.__krillionSchema = undefined;
      throw error;
    });
  }
  await g.__krillionSchema;
}

export async function db(): Promise<Client> {
  const conn = client();
  await migrated(conn);
  return conn;
}

/** Every row of a query. */
export async function all<T>(sql: string, args: InArgs = []): Promise<T[]> {
  const conn = await db();
  const result = await conn.execute({ sql, args });
  return result.rows as unknown as T[];
}

/** The first row, or undefined. */
export async function get<T>(sql: string, args: InArgs = []): Promise<T | undefined> {
  const rows = await all<T>(sql, args);
  return rows[0];
}

/** A statement whose rows are not needed. */
export async function run(sql: string, args: InArgs = []): Promise<void> {
  const conn = await db();
  await conn.execute({ sql, args });
}

/** The same three helpers, bound to an open transaction. */
export type Tx = {
  all<T>(sql: string, args?: InArgs): Promise<T[]>;
  get<T>(sql: string, args?: InArgs): Promise<T | undefined>;
  run(sql: string, args?: InArgs): Promise<void>;
};

function bind(tx: Transaction): Tx {
  const rows = async <T>(sql: string, args: InArgs = []) =>
    (await tx.execute({ sql, args })).rows as unknown as T[];
  return {
    all: rows,
    get: async <T>(sql: string, args: InArgs = []) => (await rows<T>(sql, args))[0],
    run: async (sql: string, args: InArgs = []) => {
      await tx.execute({ sql, args });
    },
  };
}

/** Runs a write transaction, rolling back if the body throws. */
export async function tx<T>(body: (t: Tx) => Promise<T>): Promise<T> {
  const conn = await db();
  const transaction = await conn.transaction("write");
  try {
    const out = await body(bind(transaction));
    await transaction.commit();
    return out;
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await get<{ value: string }>("SELECT value FROM meta WHERE key = ?", [key]);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await run(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}
