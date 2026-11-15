import type Database from 'better-sqlite3';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { MIN_EXAMPLES, rankFeatures, readRank, type RankExample } from '../../vision/rank-read.js';
import type { LearnedAccuracy, LearnedLook, LearnedRank, LearnedUnit, LearnedView, LookSource } from '../../shared/api.js';
import { fileCache } from '../file-cache.js';
import { learnedContract } from '../../shared/contracts/reader.js';
import { fail, file, serve } from '../contract.js';

/** The tables of learned pictures the review reaches, and the folder of each under `images/custom`. */
const TABLES = { hero_example: 'hero-example', hero_look: 'look', rank_look: 'rank-look', unit_look: 'unit-look' } as const;
type Table = keyof typeof TABLES;
const SOURCES: LookSource[] = ['roster', 'battle', 'offline'];
const KINDS = { rank: 'rank_look', unit: 'unit_look' } as const;
const isKind = (value: string): value is keyof typeof KINDS => value in KINDS;

/** How many looks the rank reader names wrong when each is read from all the others (ADR 0012 measured it this way). */
export function wrongReadings(looks: RankExample[], measure?: (a: RankExample['features'], b: RankExample['features']) => number): number {
  let wrong = 0;
  for (const [i, look] of looks.entries()) {
    const reading = readRank(look.features, looks.filter((_, j) => j !== i), measure);
    if (reading?.confident && reading.rank !== look.rank) wrong++;
  }
  return wrong;
}

/**
 * The review of what the readers learnt besides the hero tiles (those are in `reader-examples.ts`): the Rank Looks and Unit Looks with where
 * each came from, the accuracy of the readings, and the fixes: move a look to the right rank or name, delete it, or delete a whole source.
 */
export function learnedRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const root = join(resolve(options.imagesDir ?? 'images'), 'custom');
  const fileOf = (table: Table, file: string) => join(root, TABLES[table], file);
  const features = fileCache<Promise<RankExample['features']>>();

  const rankRows = () => db.prepare('SELECT id, rank, file, created_at AS createdAt, source FROM rank_look ORDER BY id').all() as { id: number; rank: string; file: string; createdAt: string; source: LookSource | null }[];
  const examplesOf = async (rows: { rank: string; file: string }[]): Promise<(RankExample | null)[]> =>
    Promise.all(rows.map(async (r) => (existsSync(fileOf('rank_look', r.file)) ? { rank: r.rank, features: await features(fileOf('rank_look', r.file), rankFeatures) } : null)));

  serve(app, learnedContract.view, async () => {
    const rows = rankRows();
    const examples = await examplesOf(rows);
    const present = rows.flatMap((r, i) => (examples[i] ? [{ row: r, example: examples[i]! }] : []));
    const byRank = new Map<string, LearnedLook[]>();
    for (const [i, { row, example }] of present.entries()) {
      // the look is read against every other, as the reader would read it when it first met it
      const reading = readRank(example.features, present.filter((_, j) => j !== i).map((p) => p.example));
      const looks = byRank.get(row.rank) ?? [];
      looks.push({ id: row.id, createdAt: row.createdAt, source: row.source, looksLike: reading?.confident && reading.rank !== row.rank ? reading.rank : null });
      byRank.set(row.rank, looks);
    }
    const ranks: LearnedRank[] = [...byRank.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([rank, looks]) => ({ rank, looks, readable: looks.length >= MIN_EXAMPLES }));
    const unitRows = db.prepare('SELECT id, kind, name, file, created_at AS createdAt, source FROM unit_look ORDER BY kind, name, id').all() as { id: number; kind: 'artifact' | 'phantimal'; name: string; file: string; createdAt: string; source: LookSource | null }[];
    const units: LearnedUnit[] = [];
    for (const r of unitRows) {
      if (!existsSync(fileOf('unit_look', r.file))) continue;
      let unit = units.find((u) => u.kind === r.kind && u.name === r.name);
      if (!unit) units.push((unit = { kind: r.kind, name: r.name, looks: [] }));
      unit.looks.push({ id: r.id, createdAt: r.createdAt, source: r.source, looksLike: null });
    }
    const accuracy = (db.prepare('SELECT source, screen, field, readings, agreed, agreed_percent AS agreedPercent FROM v_import_accuracy ORDER BY source, screen, field').all() as LearnedAccuracy[]);
    const sources = SOURCES.map((source) => ({
      source,
      count: (Object.keys(TABLES) as Table[]).reduce((sum, table) => sum + Number(db.prepare(`SELECT count(*) FROM ${table} WHERE source = ?`).pluck().get(source)), 0),
    })).filter((s) => s.count > 0);
    const names = (sql: string) => db.prepare(sql).pluck().all() as string[];
    const choices = { heroes: names('SELECT name FROM hero ORDER BY name'), ranks: names('SELECT name FROM rank ORDER BY position'), artifacts: names('SELECT name FROM artifact ORDER BY name'), phantimals: names('SELECT name FROM phantimal ORDER BY name') };
    const view: LearnedView = { ranks, units, accuracy, sources, choices };
    return view;
  });

  serve(app, learnedContract.image, ({ params }) => {
    const kind = params.kind;
    if (!isKind(kind)) return fail(404, 'Unknown kind of look');
    const row = db.prepare(`SELECT file FROM ${KINDS[kind]} WHERE id = ?`).get(Number(params.id)) as { file: string } | undefined;
    const path = row && fileOf(KINDS[kind], row.file);
    if (!path || !existsSync(path)) return fail(404, 'No picture');
    return file(new Uint8Array(readFileSync(path)), 'image/png', { 'cache-control': 'no-cache' });
  });

  serve(app, learnedContract.moveRank, async ({ params, body: given }) => {
    const id = Number(params.id);
    if (!db.prepare('SELECT 1 FROM rank_look WHERE id = ?').get(id)) return fail(404, 'No such look');
    const body = given as { rank?: unknown } | null;
    if (typeof body?.rank !== 'string' || !db.prepare('SELECT 1 FROM rank WHERE name = ?').get(body.rank)) return fail(400, 'Unknown rank');
    const looks = async () => (await examplesOf(rankRows())).filter((e): e is RankExample => e !== null);
    const wrongBefore = wrongReadings(await looks());
    db.prepare('UPDATE rank_look SET rank = ? WHERE id = ?').run(body.rank, id);
    return { wrongBefore, wrongAfter: wrongReadings(await looks()) };
  });

  serve(app, learnedContract.moveUnit, ({ params, body: given }) => {
    const id = Number(params.id);
    const row = db.prepare('SELECT kind FROM unit_look WHERE id = ?').get(id) as { kind: 'artifact' | 'phantimal' } | undefined;
    if (!row) return fail(404, 'No such look');
    const body = given as { name?: unknown } | null;
    if (typeof body?.name !== 'string' || !db.prepare(`SELECT 1 FROM ${row.kind} WHERE name = ?`).get(body.name)) return fail(400, `Unknown ${row.kind}`);
    db.prepare('UPDATE unit_look SET name = ? WHERE id = ?').run(body.name, id);
  });

  /** Removes rows and their pictures; a picture already gone is nothing to undo. */
  const remove = (table: Table, rows: { id: number; file: string }[]) => {
    db.transaction(() => {
      for (const r of rows) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(r.id);
    })();
    for (const r of rows) {
      try {
        unlinkSync(fileOf(table, r.file));
      } catch {
        // not there
      }
    }
  };

  serve(app, learnedContract.removeSource, ({ params }) => {
    const source = params.source as LookSource;
    if (!SOURCES.includes(source)) return fail(400, 'Unknown source');
    let deleted = 0;
    for (const table of Object.keys(TABLES) as Table[]) {
      const rows = db.prepare(`SELECT id, file FROM ${table} WHERE source = ?`).all(source) as { id: number; file: string }[];
      remove(table, rows);
      deleted += rows.length;
    }
    return { deleted };
  });

  serve(app, learnedContract.remove, ({ params }) => {
    const kind = params.kind;
    if (!isKind(kind)) return fail(404, 'Unknown kind of look');
    const id = Number(params.id);
    const row = db.prepare(`SELECT id, file FROM ${KINDS[kind]} WHERE id = ?`).get(id) as { id: number; file: string } | undefined;
    if (!row) return fail(404, 'No such look');
    remove(KINDS[kind], [row]);
  });

  return app;
}


