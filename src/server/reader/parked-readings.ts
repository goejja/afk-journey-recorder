import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import sharp from 'sharp';
import { distance as heroDistance, HERO_FEATURES_VERSION, heroFeatures } from '../../vision/hero-read.js';
import type { ParkedList, ParkedReading, ParkKind } from '../../shared/api.js';
import { parkedReadingsContract } from '../../shared/contracts/reader.js';
import { fail, revalidated, serve } from '../contract.js';
import { heroNameSet } from '../db-helpers.js';
import { limitParam } from '../params.js';
import type { SideReading, TileCrop } from './import-feedback.js';
import { lookExamples, SAME_TILE_DISTANCE } from './look-examples.js';
import { removeFiles, saveImage } from './saved-image.js';

/** The most readings kept of each kind. A full kind parks no more and drops nothing; a crop is about 32 KB, so the queue stays under 7 MB. */
export const PARK_CAPS: Record<ParkKind, number> = { difference: 150, unsure: 50 };

/** How many readings the list gives at a time. */
const PAGE_SIZE = 20;

/** A tile of a Battle import that could not be learnt from by itself, before it is checked against the caps and the readings already parked. */
export interface Parkable {
  kind: ParkKind;
  side: 'A' | 'B';
  readHero: string | null;
  keptHero: string | null;
  candidates: string[];
  png: Buffer;
}

/**
 * What a side leaves for the player to confirm (ADR 0040). A tile the player's heroes did not match is a `difference` when it could not be
 * paired with the hero that replaced it: more than one tile was wrong or more than one hero was added. The one-wrong, one-added case is learnt
 * by `learnable` and parks nothing, and nothing is parked when no hero was added (a hero only removed has nothing to pair with). The candidates
 * are the heroes the player added, then the Agent's own guesses for the tile. A tile the Agent was not sure of that the player kept is `unsure`.
 */
export function parkable(read: SideReading, final: SideReading, tiles: TileCrop[], side: 'A' | 'B'): Parkable[] {
  const kept = new Set(final.heroes.map((h) => h.hero));
  const seen = new Set(read.heroes.map((h) => h.hero));
  const wrong = tiles.filter((t) => t.hero === null || !kept.has(t.hero));
  const added = final.heroes.filter((h) => !seen.has(h.hero)).map((h) => h.hero);
  const parked: Parkable[] = [];
  if (wrong.length > 0 && added.length > 0 && !(wrong.length === 1 && added.length === 1)) {
    for (const t of wrong) parked.push({ kind: 'difference', side, readHero: t.hero, keptHero: null, candidates: [...new Set([...added, ...(t.candidates ?? [])])], png: t.png });
  }
  for (const t of tiles) {
    if (t.unsure && t.hero !== null && kept.has(t.hero)) parked.push({ kind: 'unsure', side, readHero: t.hero, keptHero: t.hero, candidates: t.candidates ?? [], png: t.png });
  }
  return parked;
}

export interface ParkSave extends Parkable {
  features: Float32Array;
}

const vectorOf = (blob: Buffer) => new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));

/**
 * The readings to park, checked against the caps and against each other and the ones already parked: a kind that is full parks no more, and
 * a tile nearly identical to one parked (`SAME_TILE_DISTANCE`) is not parked twice. Vectors made with another version of the extractor are not
 * compared. A tile that cannot be decoded is left out. The kinds that turned a reading away because they are full are returned too.
 */
export async function prepareParking(db: Database.Database, entries: Parkable[], known: ReadonlySet<string>): Promise<{ saves: ParkSave[]; full: ParkKind[] }> {
  const taken: Record<ParkKind, number> = { difference: 0, unsure: 0 };
  for (const kind of Object.keys(taken) as ParkKind[]) taken[kind] = Number(db.prepare('SELECT count(*) FROM parked_reading WHERE kind = ?').pluck().get(kind));
  const vectors = (db.prepare('SELECT vector FROM parked_reading WHERE version = ?').all(HERO_FEATURES_VERSION) as { vector: Buffer }[]).map((r) => vectorOf(r.vector));
  const saves: ParkSave[] = [];
  const full = new Set<ParkKind>();
  for (const entry of entries) {
    if (taken[entry.kind] >= PARK_CAPS[entry.kind]) {
      full.add(entry.kind);
      continue;
    }
    const png = await sharp(entry.png).png().toBuffer().catch(() => null);
    if (!png) continue;
    const features = await heroFeatures(png);
    if (vectors.some((v) => heroDistance(v, features) < SAME_TILE_DISTANCE)) continue;
    vectors.push(features);
    taken[entry.kind]++;
    saves.push({ ...entry, candidates: entry.candidates.filter((c) => known.has(c)), png, features });
  }
  return { saves, full: [...full] };
}

/** Adds the rows and writes the pictures; call it inside a transaction, with the list of paths for `removeFiles` after a failure (as `saveImage`). */
export function saveParked(db: Database.Database, mode: string | null, saves: ParkSave[], dir: string, written: string[]): void {
  const insert = db.prepare('INSERT INTO parked_reading (id, kind, side, mode, read_hero, kept_hero, candidates, file, version, vector) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const next = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 FROM parked_reading').pluck();
  for (const s of saves) {
    const id = next.get() as number;
    insert.run(id, s.kind, s.side, mode, s.readHero, s.keptHero, JSON.stringify(s.candidates), `${id}.png`, HERO_FEATURES_VERSION, Buffer.from(s.features.buffer, s.features.byteOffset, s.features.byteLength));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}.png`);
    written.push(path);
    writeFileSync(path, s.png);
  }
}

interface Row {
  id: number;
  kind: ParkKind;
  side: 'A' | 'B';
  mode: string | null;
  readHero: string | null;
  keptHero: string | null;
  candidates: string;
  file: string;
  createdAt: string;
}

/** The review of the readings that were parked: the list with their pictures, confirming one as a hero example, and putting one aside. */
export function parkedReadingRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const root = join(resolve(options.imagesDir ?? 'images'), 'custom');
  const dir = join(root, 'parked-reading');

  const rows = () => db.prepare('SELECT id, kind, side, mode, read_hero AS readHero, kept_hero AS keptHero, candidates, file, created_at AS createdAt FROM parked_reading ORDER BY id').all() as Row[];
  const forget = (ids: number[]) => {
    db.transaction(() => {
      for (const id of ids) db.prepare('DELETE FROM parked_reading WHERE id = ?').run(id);
    })();
  };

  serve(app, parkedReadingsContract.list, (_, c) => {
    // a reading whose picture is gone (a backup restored without the images folder) cannot be reviewed
    const all = rows();
    const gone = all.filter((r) => !existsSync(join(dir, r.file)));
    if (gone.length > 0) forget(gone.map((r) => r.id));
    const present = all.filter((r) => !gone.includes(r));
    const offset = Math.max(0, Math.floor(Number(c.req.query('offset'))) || 0);
    const limit = limitParam(c, 100) ?? PAGE_SIZE;
    const counts: Record<ParkKind, number> = { difference: 0, unsure: 0 };
    for (const r of present) counts[r.kind]++;
    // a kind that is not one asks for all of them
    const asked = c.req.query('kind');
    const shown = asked === 'difference' || asked === 'unsure' ? present.filter((r) => r.kind === asked) : present;
    const entries: ParkedReading[] = shown.slice(offset, offset + limit).map(({ file: _file, candidates, ...r }) => ({ ...r, candidates: JSON.parse(candidates) as string[] }));
    return { entries, total: shown.length, counts, caps: PARK_CAPS } satisfies ParkedList;
  });

  serve(app, parkedReadingsContract.image, ({ params }, c) => {
    const row = db.prepare('SELECT file FROM parked_reading WHERE id = ?').get(Number(params.id)) as { file: string } | undefined;
    const path = row && join(dir, row.file);
    if (!path || !existsSync(path)) return fail(404, 'No picture');
    return revalidated(c, path, 'image/png');
  });

  serve(app, parkedReadingsContract.confirm, async ({ params, body: given }) => {
    const id = Number(params.id);
    const row = db.prepare('SELECT id, file FROM parked_reading WHERE id = ?').get(id) as { id: number; file: string } | undefined;
    if (!row) return fail(404, 'No such parked reading');
    const hero = (given as { hero?: unknown } | null)?.hero;
    if (typeof hero !== 'string' || !heroNameSet(db).has(hero)) return fail(400, 'Choose a hero');
    const path = join(dir, row.file);
    if (!existsSync(path)) {
      forget([id]);
      return fail(404, 'No picture');
    }
    const png = await sharp(readFileSync(path)).png().toBuffer();
    const features = await heroFeatures(png);
    // a tile just like one the hero reader has for this hero would teach it nothing
    const alike = (await lookExamples(db, resolve(options.imagesDir ?? 'images')).heroExamples()).some((e) => e.hero === hero && heroDistance(e.features, features) < SAME_TILE_DISTANCE);
    const written: string[] = [];
    try {
      db.transaction(() => {
        if (!alike) saveImage(db, 'hero_example', { hero_name: hero }, join(root, 'hero-example'), png, written, 'review');
        db.prepare('DELETE FROM parked_reading WHERE id = ?').run(id);
      })();
    } catch (e) {
      removeFiles(written);
      throw e;
    }
    unlinkSync(path);
    return { learnt: !alike };
  });

  serve(app, parkedReadingsContract.dismiss, ({ params }) => {
    const id = Number(params.id);
    const row = db.prepare('SELECT file FROM parked_reading WHERE id = ?').get(id) as { file: string } | undefined;
    if (!row) return fail(404, 'No such parked reading');
    forget([id]);
    try {
      unlinkSync(join(dir, row.file));
    } catch {
      // already gone
    }
  });

  return app;
}
