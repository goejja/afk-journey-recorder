import type Database from 'better-sqlite3';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import sharp from 'sharp';
import { distance as heroDistance, heroFeatures } from '../../vision/hero-read.js';
import { distance as rankDistance, rankFeatures } from '../../vision/rank-read.js';
import { lookExamples, SAME_TILE_DISTANCE } from './look-examples.js';
import { heroNameSet } from '../db-helpers.js';
import { importFeedbackContract } from '../../shared/contracts/reader.js';
import { fail, serve } from '../contract.js';
import { parkable, prepareParking, saveParked } from './parked-readings.js';
import { removeFiles, saveImage } from './saved-image.js';

/** The most looks kept of one artifact or phantimal: more would only fill the Agent's reference sheets. */
export const MAX_LOOKS_PER_UNIT = 4;

/** What was read of one side of a battle report, or what the player kept of it. Rank and equipment are by hero. */
export interface SideReading {
  heroes: { hero: string; rank: string | null; equipmentLevel: number | null }[];
  artifact: { name: string | null; level: number | null } | null;
  phantimal: string | null;
}

export interface ReadingRow {
  field: 'hero' | 'rank' | 'equipment' | 'artifact' | 'phantimal';
  subject: string;
  read: string | null;
  final: string | null;
}

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

/**
 * One row for each thing a side's reading said, set against what was kept. A hero is compared by name wherever it ended up (the
 * player moves heroes about, so their order says nothing): a hero read but not kept has no final value, a hero kept but not read has
 * no read value. Rank and equipment are compared only for heroes on both sides of the comparison.
 */
export function compareReadings(read: SideReading, final: SideReading): ReadingRow[] {
  const rows: ReadingRow[] = [];
  const kept = new Map(final.heroes.map((h) => [h.hero, h]));
  const seen = new Map(read.heroes.map((h) => [h.hero, h]));
  for (const hero of read.heroes) {
    rows.push({ field: 'hero', subject: '', read: hero.hero, final: kept.has(hero.hero) ? hero.hero : null });
    const same = kept.get(hero.hero);
    if (!same) continue;
    // a rank or equipment level the reading did not give is not a reading, so it is not counted as a mistake
    if (hero.rank !== null) rows.push({ field: 'rank', subject: hero.hero, read: hero.rank, final: same.rank });
    if (hero.equipmentLevel !== null) rows.push({ field: 'equipment', subject: hero.hero, read: text(hero.equipmentLevel), final: text(same.equipmentLevel) });
  }
  for (const hero of final.heroes) if (!seen.has(hero.hero)) rows.push({ field: 'hero', subject: '', read: null, final: hero.hero });
  if (read.artifact?.name || final.artifact?.name) rows.push({ field: 'artifact', subject: '', read: read.artifact?.name ?? null, final: final.artifact?.name ?? null });
  if (read.phantimal || final.phantimal) rows.push({ field: 'phantimal', subject: '', read: read.phantimal, final: final.phantimal });
  return rows;
}

/** A tile of the report as the readers learn it: the hero the reading named for it (null when it named none) and its picture. */
export interface TileCrop {
  hero: string | null;
  png: Buffer;
  /** The Agent was not sure of this hero, and what else it might be (ADR 0040). */
  unsure?: boolean;
  candidates?: string[];
}

/**
 * What a side's corrections teach the hero and rank readers. Only a change the player made is evidence, so a reading that was kept as it was
 * teaches nothing. A hero is learnt when exactly one tile was wrong (read as another hero, or not named) and exactly one hero was added,
 * which pairs them; with more of either, which tile is which hero is not known. A rank is learnt when the reading gave one for a hero the
 * player kept and the player changed it, or when the reading gave none and the player typed one, or when the player kept it and the rank has
 * few looks (`sparse`). A rank a roster would have filled in (`skipRank`) is never learnt: it may not be what the picture shows.
 */
export function learnable(read: SideReading, final: SideReading, tiles: TileCrop[], skipRank: ReadonlySet<string>, sparse: ReadonlySet<string> = new Set()): { heroes: { hero: string; png: Buffer }[]; ranks: { rank: string; hero: string; png: Buffer }[] } {
  const kept = new Map(final.heroes.map((h) => [h.hero, h]));
  const seen = new Set(read.heroes.map((h) => h.hero));
  const wrong = tiles.filter((t) => t.hero === null || !kept.has(t.hero));
  const added = final.heroes.filter((h) => !seen.has(h.hero));
  const heroes = wrong.length === 1 && added.length === 1 ? [{ hero: added[0]!.hero, png: wrong[0]!.png }] : [];
  const ranks: { rank: string; hero: string; png: Buffer }[] = [];
  for (const tile of tiles) {
    if (tile.hero === null) continue;
    const before = read.heroes.find((h) => h.hero === tile.hero)?.rank ?? null;
    const after = kept.get(tile.hero)?.rank ?? null;
    if (after === null || skipRank.has(tile.hero)) continue;
    if (before !== after || sparse.has(after)) ranks.push({ rank: after, hero: tile.hero, png: tile.png });
  }
  return { heroes, ranks };
}

/** A rank with fewer looks than this still learns from a reading the player kept. */
const SPARSE_RANK_LOOKS = 10;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function sideReading(value: unknown): SideReading | null {
  if (!isRecord(value) || !Array.isArray(value['heroes'])) return null;
  const heroes: SideReading['heroes'] = [];
  for (const h of value['heroes']) {
    if (!isRecord(h) || typeof h['hero'] !== 'string') return null;
    heroes.push({ hero: h['hero'], rank: typeof h['rank'] === 'string' ? h['rank'] : null, equipmentLevel: typeof h['equipmentLevel'] === 'number' ? h['equipmentLevel'] : null });
  }
  const a = value['artifact'];
  const artifact = isRecord(a) ? { name: typeof a['name'] === 'string' && a['name'] !== '' ? a['name'] : null, level: typeof a['level'] === 'number' ? a['level'] : null } : null;
  return { heroes, artifact, phantimal: typeof value['phantimal'] === 'string' && value['phantimal'] !== '' ? value['phantimal'] : null };
}

const PNG = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

/**
 * Routes that take what a player kept of a Battle import. The form that opened the import holds what the Agent read and the crops of
 * the artifact and phantimal; saving the records sends them here with the final values. Nothing here changes a record.
 */
export function importFeedbackRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const lookDir = join(resolve(options.imagesDir ?? 'images'), 'custom', 'unit-look');

  serve(app, importFeedbackContract.send, async ({ body: given }) => {
    const body = given as any; // checked below
    const mode = typeof body?.mode === 'string' ? body.mode : null;
    if (!Array.isArray(body?.sides) || body.sides.length > 20) return fail(400, 'Send the sides that were read');
    const artifactNames = new Set(db.prepare('SELECT name FROM artifact').pluck().all() as string[]);
    const phantimalNames = new Set(db.prepare('SELECT name FROM phantimal').pluck().all() as string[]);
    const sides: { read: SideReading; final: SideReading; side: 'A' | 'B'; crops: { artifact: Buffer | null; phantimal: Buffer | null }; tiles: TileCrop[]; skipRank: Set<string> }[] = [];
    for (const given of body.sides) {
      const read = sideReading(given?.read);
      const final = sideReading(given?.final);
      if (!read || !final) return fail(400, 'A side needs what was read and what was kept');
      const crop = (value: unknown) => {
        const match = typeof value === 'string' ? PNG.exec(value) : null;
        return match ? Buffer.from(match[1]!, 'base64') : null;
      };
      const tiles: TileCrop[] = [];
      for (const t of Array.isArray(given?.crops?.tiles) ? given.crops.tiles.slice(0, 10) : []) {
        const png = crop(t?.png);
        if (png) tiles.push({ hero: typeof t.hero === 'string' ? t.hero : null, png, unsure: t.unsure === true, candidates: Array.isArray(t.candidates) ? t.candidates.filter((c: unknown): c is string => typeof c === 'string').slice(0, 5) : [] });
      }
      const skipRank = new Set<string>(Array.isArray(given?.skipRank) ? given.skipRank.filter((h: unknown): h is string => typeof h === 'string') : []);
      sides.push({ read, final, side: given?.side === 'B' ? 'B' : 'A', crops: { artifact: crop(given?.crops?.artifact), phantimal: crop(given?.crops?.phantimal) }, tiles, skipRank });
    }

    let logged = 0;
    let looks = 0;
    const saves: { kind: 'artifact' | 'phantimal'; name: string; bytes: Buffer }[] = [];
    db.transaction(() => {
      const insert = db.prepare("INSERT INTO import_reading (source, screen, mode, field, subject, read_value, final_value) VALUES ('battle-form', 'report', ?, ?, ?, ?, ?)");
      const looksOf = db.prepare('SELECT count(*) FROM unit_look WHERE kind = ? AND name = ?').pluck();
      for (const { read, final, crops } of sides) {
        for (const row of compareReadings(read, final)) {
          insert.run(mode, row.field, row.subject, row.read, row.final);
          logged++;
        }
        // A crop is kept as a look under the name the player kept; a side with no such artifact or phantimal gives nothing to learn.
        const kept = [
          { kind: 'artifact' as const, name: final.artifact?.name ?? null, known: artifactNames, bytes: crops.artifact },
          { kind: 'phantimal' as const, name: final.phantimal, known: phantimalNames, bytes: crops.phantimal },
        ];
        for (const { kind, name, known, bytes } of kept) {
          if (!name || !bytes || !known.has(name)) continue;
          const have = Number(looksOf.get(kind, name)) + saves.filter((s) => s.kind === kind && s.name === name).length;
          if (have < MAX_LOOKS_PER_UNIT) saves.push({ kind, name, bytes });
        }
      }
    })();
    // What the corrections teach the hero and rank readers, unless they have a tile just like it already.
    const heroNames = heroNameSet(db);
    const rankNames = new Set(db.prepare('SELECT name FROM rank').pluck().all() as string[]);
    const examples = lookExamples(db, resolve(options.imagesDir ?? 'images'));
    const knownHeroes = await examples.heroExamples();
    const knownRanks = await examples.rankExamples();
    const looksOf = new Map<string, number>();
    for (const e of knownRanks) looksOf.set(e.rank, (looksOf.get(e.rank) ?? 0) + 1);
    const sparseRanks = new Set([...rankNames].filter((r) => (looksOf.get(r) ?? 0) < SPARSE_RANK_LOOKS));
    const heroSaves: { hero: string; png: Buffer }[] = [];
    const rankSaves: { rank: string; png: Buffer }[] = [];
    for (const side of sides) {
      const learnt = learnable(side.read, side.final, side.tiles, side.skipRank, sparseRanks);
      for (const { hero, png: raw } of learnt.heroes) {
        if (!heroNames.has(hero)) continue;
        const png = await sharp(raw).png().toBuffer().catch(() => null);
        if (!png) continue;
        const features = await heroFeatures(png);
        if (knownHeroes.some((e) => e.hero === hero && heroDistance(e.features, features) < SAME_TILE_DISTANCE)) continue;
        knownHeroes.push({ hero, features });
        heroSaves.push({ hero, png });
      }
      for (const { rank, png: raw } of learnt.ranks) {
        if (!rankNames.has(rank)) continue;
        const png = await sharp(raw).png().toBuffer().catch(() => null);
        if (!png) continue;
        const features = await rankFeatures(png);
        if (knownRanks.some((e) => e.rank === rank && rankDistance(e.features, features) < SAME_TILE_DISTANCE)) continue;
        knownRanks.push({ rank, features });
        rankSaves.push({ rank, png });
      }
    }
    // what the corrections left unpaired, and the readings the Agent was not sure of, wait for the player to confirm (ADR 0040)
    const parking = await prepareParking(db, sides.flatMap((s) => parkable(s.read, s.final, s.tiles, s.side)), heroNames);
    const root = join(resolve(options.imagesDir ?? 'images'), 'custom');
    // the crops are decoded by sharp before they are written, so the file is a real PNG whatever was sent; an unreadable crop is a look not kept
    const lookPictures: { kind: 'artifact' | 'phantimal'; name: string; png: Buffer }[] = [];
    for (const save of saves) {
      try {
        lookPictures.push({ kind: save.kind, name: save.name, png: await sharp(save.bytes).resize({ width: 240, withoutEnlargement: true }).png().toBuffer() });
      } catch {
        // not kept
      }
    }
    // rows and files go in together: a file that cannot be written takes its row, and the files already written, back
    const written: string[] = [];
    try {
      db.transaction(() => {
        for (const save of heroSaves) saveImage(db, 'hero_example', { hero_name: save.hero }, join(root, 'hero-example'), save.png, written, 'battle');
        for (const save of rankSaves) saveImage(db, 'rank_look', { rank: save.rank }, join(root, 'rank-look'), save.png, written, 'battle');
        for (const save of lookPictures) saveImage(db, 'unit_look', { kind: save.kind, name: save.name }, lookDir, save.png, written, 'battle');
        saveParked(db, mode, parking.saves, join(root, 'parked-reading'), written);
      })();
    } catch (e) {
      removeFiles(written);
      throw e;
    }
    looks = lookPictures.length;
    return { logged, looks, heroExamples: heroSaves.length, rankLooks: rankSaves.length, parked: parking.saves.length, full: parking.full };
  });

  return app;
}
