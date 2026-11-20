import type Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { LEARNED_PICTURES, pictureDir, type PictureTable } from './learned-pictures.js';
import { join } from 'node:path';

/** Where a picture came from: a Roster import, a Battle import saved from its form, a reading the player confirmed in Admin > Reader, or `npm run learn:ranks`. */
export type ImageSource = 'roster' | 'battle' | 'offline' | 'review';

/**
 * Adds a row for a picture and writes the file it names, `<id>.png` in the folder of its table under `root`. Call it inside a transaction: the row is then undone when
 * the file cannot be written or anything later fails. Every path written goes into `written`, for `removeFiles` after a failure,
 * since a rolled-back transaction does not take the files back.
 */
export function saveImage<T extends PictureTable>(db: Database.Database, root: string, table: T, values: Record<(typeof LEARNED_PICTURES)[T]['columns'][number], string>, bytes: Buffer, written: string[], source: ImageSource): number {
  const columns = LEARNED_PICTURES[table].columns as readonly string[];
  const dir = pictureDir(root, table);
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
