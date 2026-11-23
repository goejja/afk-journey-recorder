import type { Migration } from './index.js';

/**
 * 37 -> 38: `enemy.category` becomes `enemy.kind` (#269). The column holds Common, Elite or Boss, the Kind the screens show
 * (#266); the code, the API and the database now use one word. SQLite rewrites the CHECK of the column with its new name.
 * A database that already has `kind` is left alone.
 */
export const migration: Migration = (db) => {
  const columns = db.prepare("SELECT name FROM pragma_table_info('enemy')").pluck().all() as string[];
  if (!columns.includes('category')) return;
  db.exec('ALTER TABLE enemy RENAME COLUMN category TO kind');
};
