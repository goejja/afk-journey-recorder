import type { Migration } from './index.js';

/**
 * 42 -> 43: `sync_runs` keeps what each sync of outside data and assets did (#377, ADR 0045): which source, when it started and finished,
 * how it ended, what it printed and what went wrong. It is a log, not a record of a battle.
 */
export const migration: Migration = (db) => {
  db.exec(`CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
    refresh INTEGER NOT NULL DEFAULT 0 CHECK (refresh IN (0, 1)),
    overwrite INTEGER NOT NULL DEFAULT 0 CHECK (overwrite IN (0, 1)),
    lines TEXT NOT NULL DEFAULT '[]',
    warnings TEXT NOT NULL DEFAULT '[]',
    error TEXT
  )`);
};
