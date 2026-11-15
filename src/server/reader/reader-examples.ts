import type Database from 'better-sqlite3';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { fileCache } from '../file-cache.js';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { heroFeatures, readHero, type Features, type HeroExample } from '../../vision/hero-read.js';
import type { LookSource, ReaderExample, ReaderHero } from '../../shared/api.js';
import { readerExamplesContract } from '../../shared/contracts/reader.js';
import { fail, file, serve } from '../contract.js';

/** Where the two kinds of hero tile live: a Hero Example (from a confirmed import or a correction) and a Hero Look (also shown to the Agent). */
const KINDS = {
  example: { table: 'hero_example', dir: 'hero-example' },
  look: { table: 'hero_look', dir: 'look' },
} as const;
type Kind = keyof typeof KINDS;
const isKind = (value: string): value is Kind => value in KINDS;

/** The review of what the hero reader learnt: every hero's examples, and the delete of one that was assigned to the wrong hero. */
export function readerExampleRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const root = join(resolve(options.imagesDir ?? 'images'), 'custom');
  const fileOf = (kind: Kind, file: string) => join(root, KINDS[kind].dir, file);

  /** The features of a file, kept while the file is unchanged. */
  const cached = fileCache<Promise<Features>>();
  const featuresFor = (file: string): Promise<Features> => cached(file, heroFeatures);

  /**
   * Every hero's examples with the hint of a wrong assignment. Each tile is read against all the others, which takes time
   * that grows with the square of the examples, so the answer is kept while the examples (rows and picture files) are the same.
   */
  let kept: { key: string; heroes: Promise<ReaderHero[]> } | null = null;
  const heroesWithExamples = (): Promise<ReaderHero[]> => {
    const rows: { kind: Kind; id: number; hero: string; file: string; createdAt: string; source: LookSource | null }[] = [];
    for (const kind of Object.keys(KINDS) as Kind[]) {
      for (const r of db.prepare(`SELECT id, hero_name AS hero, file, created_at AS createdAt, source FROM ${KINDS[kind].table} ORDER BY id`).all() as { id: number; hero: string; file: string; createdAt: string; source: LookSource | null }[]) {
        if (existsSync(fileOf(kind, r.file))) rows.push({ kind, ...r });
      }
    }
    const key = rows
      .map((r) => {
        const { size, mtimeMs } = statSync(fileOf(r.kind, r.file));
        return `${r.kind}:${r.id}:${r.hero}:${r.file}:${r.createdAt}:${r.source}:${size}:${mtimeMs}`;
      })
      .join('|');
    if (kept?.key === key) return kept.heroes;
    const heroes = readExamples(rows);
    const entry = { key, heroes };
    kept = entry;
    // a failed read is not kept
    heroes.catch(() => {
      if (kept === entry) kept = null;
    });
    return heroes;
  };

  async function readExamples(rows: { kind: Kind; id: number; hero: string; file: string; createdAt: string; source: LookSource | null }[]): Promise<ReaderHero[]> {
    const samples = await Promise.all(rows.map(async (r): Promise<HeroExample & { kind: Kind; id: number }> => ({ hero: r.hero, kind: r.kind, id: r.id, features: await featuresFor(fileOf(r.kind, r.file)) })));
    const byHero = new Map<string, ReaderExample[]>();
    for (const [i, r] of rows.entries()) {
      // the tile is read against every other example, as the reader would read it when it first met it
      const others = samples.filter((_, j) => j !== i);
      const read = others.some((o) => o.hero === r.hero) ? readHero(samples[i]!.features, others) : null;
      const list = byHero.get(r.hero) ?? [];
      list.push({ kind: r.kind, id: r.id, createdAt: r.createdAt, source: r.source, looksLike: read && read.hero !== r.hero ? read.hero : null });
      byHero.set(r.hero, list);
    }
    return [...byHero.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([hero, examples]) => ({ hero, examples }));
  }

  serve(app, readerExamplesContract.view, async () => {
    const heroes = await heroesWithExamples();
    const total = Number(db.prepare('SELECT count(*) FROM hero').pluck().get());
    return { heroes, withoutExamples: total - heroes.length };
  });

  serve(app, readerExamplesContract.image, ({ params }) => {
    const kind = params.kind;
    if (!isKind(kind)) return fail(404, 'Unknown kind of example');
    const row = db.prepare(`SELECT file FROM ${KINDS[kind].table} WHERE id = ?`).get(Number(params.id)) as { file: string } | undefined;
    const path = row && fileOf(kind, row.file);
    if (!path || !existsSync(path)) return fail(404, 'No picture');
    return file(new Uint8Array(readFileSync(path)), 'image/png', { 'cache-control': 'no-cache' });
  });

  serve(app, readerExamplesContract.move, ({ params, body: given }) => {
    const kind = params.kind;
    if (!isKind(kind)) return fail(404, 'Unknown kind of example');
    const id = Number(params.id);
    if (!db.prepare(`SELECT 1 FROM ${KINDS[kind].table} WHERE id = ?`).get(id)) return fail(404, 'No such example');
    const body = given as { hero?: unknown } | null;
    if (typeof body?.hero !== 'string' || !db.prepare('SELECT 1 FROM hero WHERE name = ?').get(body.hero)) return fail(400, 'Unknown hero');
    db.prepare(`UPDATE ${KINDS[kind].table} SET hero_name = ? WHERE id = ?`).run(body.hero, id);
  });

  serve(app, readerExamplesContract.remove, ({ params }) => {
    const kind = params.kind;
    if (!isKind(kind)) return fail(404, 'Unknown kind of example');
    const id = Number(params.id);
    const row = db.prepare(`SELECT file FROM ${KINDS[kind].table} WHERE id = ?`).get(id) as { file: string } | undefined;
    if (!row) return fail(404, 'No such example');
    db.prepare(`DELETE FROM ${KINDS[kind].table} WHERE id = ?`).run(id);
    // the picture goes with its row; one already gone is nothing to undo
    try {
      unlinkSync(fileOf(kind, row.file));
    } catch {
      // not there
    }
  });

  return app;
}
