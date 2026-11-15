import type { Migration } from './index.js';

/**
 * 7 -> 8: a finding the player dismissed stays hidden until its message changes (ADR 0032).
 */
export const migration: Migration = (db) => {
  db.exec('CREATE TABLE review_dismissal (code TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, PRIMARY KEY (code, subject, message))');
};
