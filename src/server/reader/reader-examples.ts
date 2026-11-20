import type Database from 'better-sqlite3';
import { existsSync, statSync } from 'node:fs';
import { Hono } from 'hono';
import { readHero, type HeroExample } from '../../vision/hero-read.js';
import { HERO_EXAMPLES, HERO_LOOKS, storedFeaturesFor } from './stored-features.js';
import type { LookSource, ReaderExample, ReaderHero } from '../../shared/api.js';
import { readerExamplesContract } from '../../shared/contracts/reader.js';
import { serve } from '../contract.js';
import { learnedPicturesRoot, pictureDir, picturePath } from './learned-pictures.js';

/** Where the two kinds of hero tile live: a Hero Example (from a confirmed import or a correction) and a Hero Look (also shown to the Agent). */
const KINDS = {
  example: { table: 'hero_example', spec: HERO_EXAMPLES },
  look: { table: 'hero_look', spec: HERO_LOOKS },
} as const;
type Kind = keyof typeof KINDS;

/** The review of what the hero reader learnt: every hero's examples (moving or deleting one is in `picture-routes.ts`). */
export function readerExampleRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const root = learnedPicturesRoot(options.imagesDir);
  const fileOf = (kind: Kind, file: string) => picturePath(root, KINDS[kind].table, file);

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

  async function readExamples(all: { kind: Kind; id: number; hero: string; file: string; createdAt: string; source: LookSource | null }[]): Promise<ReaderHero[]> {
    // each kind keeps its vectors (`storedFeaturesFor`); an example whose picture cannot be decoded is left out
    const found = new Map(await Promise.all((Object.keys(KINDS) as Kind[]).map(async (kind) => [kind, (await storedFeaturesFor(db, KINDS[kind].spec, all.filter((r) => r.kind === kind), pictureDir(root, KINDS[kind].table))).features] as const)));
    const rows = all.filter((r) => found.get(r.kind)!.has(r.id));
    const samples = rows.map((r): HeroExample & { kind: Kind; id: number } => ({ hero: r.hero, kind: r.kind, id: r.id, features: found.get(r.kind)!.get(r.id)! }));
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

  return app;
}
