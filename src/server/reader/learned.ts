import type Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { MIN_EXAMPLES, readRank, type RankExample } from '../../vision/rank-read.js';
import type { LearnedAccuracy, LearnedLook, LearnedRank, LearnedUnit, LearnedView, LookSource } from '../../shared/api.js';
import { rankFeaturesFor, rankMeasure } from './rank-looks.js';
import { learnedContract } from '../../shared/contracts/reader.js';
import { serve } from '../contract.js';
import { learnedPicturesRoot, LOOK_SOURCES, PICTURE_TABLES, pictureDir, picturePath } from './learned-pictures.js';

/** How many looks the rank reader names wrong when each is read from all the others (ADR 0012 measured it this way). */
export function wrongReadings(looks: RankExample[], measure: (a: RankExample['features'], b: RankExample['features']) => number = rankMeasure(looks.map((l) => l.features))): number {
  let wrong = 0;
  for (const [i, look] of looks.entries()) {
    const reading = readRank(look.features, looks.filter((_, j) => j !== i), measure);
    if (reading?.confident && reading.rank !== look.rank) wrong++;
  }
  return wrong;
}

type RankRow = { id: number; rank: string; file: string; createdAt: string; source: LookSource | null };
const rankRows = (db: Database.Database) => db.prepare('SELECT id, rank, file, created_at AS createdAt, source FROM rank_look ORDER BY id').all() as RankRow[];
/** The rows with the features of their pictures; null for a row whose picture is missing or cannot be read. */
const rankExamplesOf = async (db: Database.Database, root: string, rows: { id: number; rank: string; file: string }[]): Promise<(RankExample | null)[]> => {
  const { features } = await rankFeaturesFor(db, rows, pictureDir(root, 'rank_look'));
  return rows.map((r) => (features.has(r.id) ? { rank: r.rank, features: features.get(r.id)! } : null));
};

/** Does `move` (a change to a Rank Look) and says how many looks the rank reader names wrong before and after, measured the same way. */
export async function rankMoveReport(db: Database.Database, root: string, move: () => void): Promise<{ wrongBefore: number; wrongAfter: number }> {
  const looks = async () => (await rankExamplesOf(db, root, rankRows(db))).filter((e): e is RankExample => e !== null);
  const before = await looks();
  const measure = rankMeasure(before.map((e) => e.features));
  const wrongBefore = wrongReadings(before, measure);
  move();
  return { wrongBefore, wrongAfter: wrongReadings(await looks(), measure) };
}

/**
 * The review of what the readers learnt besides the hero tiles (those are in `reader-examples.ts`): the Rank Looks and Unit Looks with where
 * each came from, the accuracy of the readings, and the fixes: move a look to the right rank or name, delete it, or delete a whole source.
 */
export function learnedRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const root = learnedPicturesRoot(options.imagesDir);

  serve(app, learnedContract.view, async () => {
    const rows = rankRows(db);
    const examples = await rankExamplesOf(db, root, rows);
    const present = rows.flatMap((r, i) => (examples[i] ? [{ row: r, example: examples[i]! }] : []));
    const byRank = new Map<string, LearnedLook[]>();
    const measure = rankMeasure(present.map((p) => p.example.features));
    for (const [i, { row, example }] of present.entries()) {
      // the look is read against every other, as the reader would read it when it first met it
      const reading = readRank(example.features, present.filter((_, j) => j !== i).map((p) => p.example), measure);
      const looks = byRank.get(row.rank) ?? [];
      looks.push({ id: row.id, createdAt: row.createdAt, source: row.source, looksLike: reading?.confident && reading.rank !== row.rank ? reading.rank : null });
      byRank.set(row.rank, looks);
    }
    const ranks: LearnedRank[] = [...byRank.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([rank, looks]) => ({ rank, looks, readable: looks.length >= MIN_EXAMPLES }));
    const unitRows = db.prepare('SELECT id, kind, name, file, created_at AS createdAt, source FROM unit_look ORDER BY kind, name, id').all() as { id: number; kind: 'artifact' | 'phantimal'; name: string; file: string; createdAt: string; source: LookSource | null }[];
    const units: LearnedUnit[] = [];
    for (const r of unitRows) {
      if (!existsSync(picturePath(root, 'unit_look', r.file))) continue;
      let unit = units.find((u) => u.kind === r.kind && u.name === r.name);
      if (!unit) units.push((unit = { kind: r.kind, name: r.name, looks: [] }));
      unit.looks.push({ id: r.id, createdAt: r.createdAt, source: r.source, looksLike: null });
    }
    const accuracy = (db.prepare('SELECT source, screen, field, readings, agreed, agreed_percent AS agreedPercent FROM v_import_accuracy ORDER BY source, screen, field').all() as LearnedAccuracy[]);
    const sources = LOOK_SOURCES.map((source) => ({
      source,
      count: PICTURE_TABLES.reduce((sum, table) => sum + Number(db.prepare(`SELECT count(*) FROM ${table} WHERE source = ?`).pluck().get(source)), 0),
    })).filter((s) => s.count > 0);
    const names = (sql: string) => db.prepare(sql).pluck().all() as string[];
    const choices = { heroes: names('SELECT name FROM hero ORDER BY name'), ranks: names('SELECT name FROM rank ORDER BY position'), artifacts: names('SELECT name FROM artifact ORDER BY name'), phantimals: names('SELECT name FROM phantimal ORDER BY name') };
    const view: LearnedView = { ranks, units, accuracy, sources, choices };
    return view;
  });

  return app;
}


