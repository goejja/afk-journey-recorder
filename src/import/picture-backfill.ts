import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { keepPicture, picturesDir } from './picture-store.js';

/** A battle report folder is named after its mode: `Guild_Duel_Battle_Report` holds the pictures of the Guild Duel. */
const REPORT_FOLDER = /^(.+)_Battle_Report$/;

interface PictureFile {
  /** The path of the file under the folder searched. */
  path: string;
  /** The mode the folder name says, or null for a folder that does not hold battle reports. */
  mode: string | null;
  hash: string;
}

export interface LabelMatch {
  label: string;
  /** Saved records whose note names this picture. */
  records: { attemptId: number; battleId: number | null; mode: string }[];
  /** `unique`: one file (or copies with the same bytes) in a battle report folder whose mode agrees with the records. */
  status: 'unique' | 'missing' | 'ambiguous' | 'mode-differs' | 'not-a-report';
  files: PictureFile[];
  /** Why the status is not `unique`, in words. */
  detail?: string;
}

/** The picture a record's note names: "Imported from IMG_0001.jpeg: Brin against Edda KOR". */
export const labelOfNote = (note: string): string | null => /^Imported from (.+?): .* against .*$/s.exec(note)?.[1] ?? null;

/** Every file one folder down from `root`, by file name (lower case), with its hash and the mode of its folder. */
function pictureFiles(root: string): Map<string, PictureFile[]> {
  const found = new Map<string, PictureFile[]>();
  if (!existsSync(root)) return found;
  for (const folder of readdirSync(root)) {
    const dir = join(root, folder);
    if (!statSync(dir).isDirectory()) continue;
    const mode = REPORT_FOLDER.exec(folder)?.[1]?.replace(/_/g, ' ') ?? null;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (!statSync(path).isFile() || !/\.(jpe?g|png|webp)$/i.test(name)) continue;
      const list = found.get(name.toLowerCase()) ?? [];
      list.push({ path: join(folder, name), mode, hash: createHash('sha256').update(readFileSync(path)).digest('hex') });
      found.set(name.toLowerCase(), list);
    }
  }
  return found;
}

/** Matches the pictures named by the notes of saved records to the files under `root`, without changing anything. */
export function planBackfill(db: Database.Database, root: string): LabelMatch[] {
  const rows = db
    .prepare("SELECT a.id AS attemptId, a.battle_id AS battleId, COALESCE(b.mode, a.mode) AS mode, a.note FROM attempt a LEFT JOIN battle b ON b.id = a.battle_id WHERE a.note LIKE 'Imported from %' ORDER BY a.id")
    .all() as { attemptId: number; battleId: number | null; mode: string; note: string }[];
  const byLabel = new Map<string, LabelMatch['records']>();
  for (const { note, ...record } of rows) {
    const label = labelOfNote(note);
    if (label) byLabel.set(label, [...(byLabel.get(label) ?? []), record]);
  }
  const files = pictureFiles(root);
  return [...byLabel.entries()].map(([label, records]): LabelMatch => {
    const candidates = files.get(label.toLowerCase()) ?? [];
    const reports = candidates.filter((f) => f.mode !== null);
    const modes = new Set(records.map((r) => r.mode));
    if (candidates.length === 0) return { label, records, status: 'missing', files: [], detail: 'no file with this name' };
    if (reports.length === 0) return { label, records, status: 'not-a-report', files: candidates, detail: 'only in folders that are not battle reports' };
    if (new Set(reports.map((f) => f.hash)).size > 1) return { label, records, status: 'ambiguous', files: reports, detail: 'several different files with this name' };
    const wrong = reports.filter((f) => !modes.has(f.mode!));
    if (wrong.length > 0) return { label, records, status: 'mode-differs', files: reports, detail: `folder says ${[...new Set(reports.map((f) => f.mode))].join('/')}, records say ${[...modes].join('/')}` };
    return { label, records, status: 'unique', files: reports };
  });
}

/**
 * Keeps the picture of every `unique` match with each record that names it, as a save from the form would (ADR 0016). Running it again
 * changes nothing: a picture already kept is stored once, and a record already linked is linked to the same file.
 *
 * With `move`, the files in `root` are then removed, so that the folder holds only what is not kept yet. A file is removed only after the
 * stored copy has been read back and its hash equals the file's; identical copies of it in other folders go too, and any file that differs stays.
 */
export async function applyBackfill(db: Database.Database, root: string, imagesDir: string, matches: LabelMatch[], options: { move?: boolean } = {}): Promise<{ pictures: number; records: number; failed: string[]; removed: string[] }> {
  let pictures = 0;
  let records = 0;
  const failed: string[] = [];
  const removed: string[] = [];
  for (const match of matches.filter((m) => m.status === 'unique')) {
    const bytes = readFileSync(join(root, match.files[0]!.path));
    let stored: { hash: string; file: string } | null = null;
    for (const record of match.records) {
      const result = await keepPicture(db, imagesDir, bytes, { attemptId: record.attemptId, label: match.label });
      if (result) {
        records++;
        stored = result;
      }
    }
    if (!stored) {
      failed.push(match.label);
      continue;
    }
    pictures++;
    if (!options.move) continue;
    const copy = join(picturesDir(imagesDir), stored.file);
    if (!existsSync(copy) || createHash('sha256').update(readFileSync(copy)).digest('hex') !== stored.hash) continue;
    for (const file of match.files.filter((f) => f.hash === stored!.hash)) {
      unlinkSync(join(root, file.path));
      removed.push(file.path);
    }
  }
  return { pictures, records, failed, removed };
}
