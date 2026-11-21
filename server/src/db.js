import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, definition_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(
      id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, event_id TEXT,
      status TEXT NOT NULL, step_index INTEGER NOT NULL DEFAULT 0,
      context_json TEXT NOT NULL, wake_at INTEGER NOT NULL,
      lease_owner TEXT, lease_expires INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS runs_idem ON runs(workflow_id, event_id);
    CREATE INDEX IF NOT EXISTS runs_due ON runs(status, wake_at);
    CREATE TABLE IF NOT EXISTS step_log(
      run_id TEXT NOT NULL, step_index INTEGER NOT NULL, type TEXT NOT NULL,
      result TEXT, at INTEGER NOT NULL, engine TEXT, PRIMARY KEY(run_id, step_index));
    CREATE TABLE IF NOT EXISTS deliveries(
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, step_index INTEGER NOT NULL,
      channel TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(run_id, step_index));
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  // Migration for DBs created before step_log.engine existed.
  if (!db.prepare('PRAGMA table_info(step_log)').all().some((c) => c.name === 'engine')) {
    db.exec('ALTER TABLE step_log ADD COLUMN engine TEXT');
  }
  return db;
}
