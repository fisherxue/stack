import Database from 'better-sqlite3';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stack      TEXT NOT NULL,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS tasks_stack ON tasks (stack, id);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  stack   TEXT NOT NULL,
  type    TEXT NOT NULL CHECK (type IN ('push', 'pop', 'rm')),
  actor   TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_stack ON events (stack, id);

CREATE TABLE IF NOT EXISTS channel_defaults (
  channel_id TEXT PRIMARY KEY,
  stack      TEXT NOT NULL
);
`;

export function openDb(path = process.env.DB_PATH ?? './stack.db') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(MIGRATION);
  return db;
}
