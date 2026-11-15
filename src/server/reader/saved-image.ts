import type Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The tables that keep a picture of something the player confirmed, with the columns that say what it shows. */
const IMAGE_TABLES = {
  hero_look: ['hero_name'],
  hero_example: ['hero_name'],
  rank_look: ['rank'],
  unit_look: ['kind', 'name'],
} as const;

type ImageTable = keyof typeof IMAGE_TABLES;

/** Where a picture came from: a Roster import, a Battle import saved from its form, or `npm run learn:ranks`. */
export type ImageSource = 'roster' | 'battle' | 'offline';

/**
 * Adds a row for a picture and writes the file it names, `<id>.png` in `dir`. Call it inside a transaction: the row is then undone when
 * the file cannot be written or anything later fails. Every path written goes into `written`, for `removeFiles` after a failure,
 * since a rolled-back transaction does not take the files back.
 */
export function saveImage<T extends ImageTable>(db: Database.Database, table: T, values: Record<(typeof IMAGE_TABLES)[T][number], string>, dir: string, bytes: Buffer, written: string[], source: ImageSource): number {
  const columns = IMAGE_TABLES[table] as readonly string[];
  const id = db.prepare(`SELECT COALESCE(MAX(id), 0) + 1 FROM ${table}`).pluck().get() as number;
  db.prepare(`INSERT INTO ${table} (id, ${columns.join(', ')}, file, source) VALUES (?, ${columns.map(() => '?').join(', ')}, ?, ?)`).run(id, ...columns.map((c) => (values as Record<string, string>)[c]), `${id}.png`, source);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.png`);
  written.push(path);
  writeFileSync(path, bytes);
  return id;
}

/** Removes files `saveImage` wrote for a transaction that failed. */
export function removeFiles(paths: string[]): void {
  for (const path of paths) rmSync(path, { force: true });
}
