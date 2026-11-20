import type Database from 'better-sqlite3';
import { unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LookSource } from '../../shared/api.js';

/**
 * The tables of learned pictures, the folder of each under `images/custom`, the columns that say what a picture shows, and what the
 * column the review can move a picture to (`moves`) must exist in: a table, or `kind` for the table the row's own `kind` names.
 * Other folders of `images/custom` hold pictures kept for a purpose, and are not learned pictures.
 */
export const LEARNED_PICTURES = {
  hero_example: { folder: 'hero-example', columns: ['hero_name'], moves: { column: 'hero_name', in: 'hero' } },
  hero_look: { folder: 'look', columns: ['hero_name'], moves: { column: 'hero_name', in: 'hero' } },
  rank_look: { folder: 'rank-look', columns: ['rank'], moves: { column: 'rank', in: 'rank' } },
  unit_look: { folder: 'unit-look', columns: ['kind', 'name'], moves: { column: 'name', in: 'kind' } },
} as const;

export type PictureTable = keyof typeof LEARNED_PICTURES;
export const PICTURE_TABLES = Object.keys(LEARNED_PICTURES) as PictureTable[];
/** `Object.hasOwn`, not `in`: a name such as `constructor` is not a table. */
export const isPictureTable = (value: string): value is PictureTable => Object.hasOwn(LEARNED_PICTURES, value);

/** Where a learned picture came from. */
export const LOOK_SOURCES: LookSource[] = ['roster', 'battle', 'offline', 'review'];

/** `images/custom`, where the pictures the readers learn from and keep are. */
export const learnedPicturesRoot = (imagesDir?: string): string => join(resolve(imagesDir ?? 'images'), 'custom');
export const pictureDir = (root: string, table: PictureTable): string => join(root, LEARNED_PICTURES[table].folder);
export const picturePath = (root: string, table: PictureTable, file: string): string => join(pictureDir(root, table), file);

/** What `removeFile` did: a file that was already gone is `missing`, which is as good as removed. */
export type Removal = 'removed' | 'missing' | 'failed';

export function removeFile(path: string): Removal {
  try {
    unlinkSync(path);
    return 'removed';
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'failed';
  }
}

/** Removes rows and then their pictures; the rows go in one transaction, and a picture already gone is nothing to undo. */
export function removeLooks(db: Database.Database, root: string, table: PictureTable, rows: { id: number; file: string }[]): void {
  db.transaction(() => {
    for (const r of rows) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(r.id);
  })();
  for (const r of rows) removeFile(picturePath(root, table, r.file));
}
