import type Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { pairTiles, type SkipReason } from '../../import/rank-learning.js';
import { heroFeatures, readHero } from '../../vision/hero-read.js';
import { findBattleSides } from '../../vision/tile-detect.js';
import { isBlank } from '../../vision/tile-image.js';
import { rankFeatures, distance as rankDistance, type RankExample } from '../../vision/rank-read.js';
import { lookExamples, SAME_TILE_DISTANCE } from './look-examples.js';
import { tileCrop } from './roster-import-tiles.js';

export interface ProposedLook {
  rank: string;
  hero: string;
  attemptId: number;
  png: Buffer;
  features: RankExample['features'];
}

export interface Harvest {
  pictures: number;
  unreadable: number;
  tiles: number;
  proposed: ProposedLook[];
  skipped: Map<SkipReason | 'conflict' | 'known', number>;
}

interface SideRow {
  hero: string;
  rank: string | null;
}

/** The ranks a side's player has in a roster: the profile of the Player behind the side, or for Side A the default profile. */
function rosterRanks(db: Database.Database, attemptId: number, side: 'A' | 'B'): Map<string, string> {
  const profile = db
    .prepare(
      `SELECT p.id FROM attempt_player ap JOIN profile p ON p.player_id = ap.player_id COLLATE NOCASE WHERE ap.attempt_id = ? AND ap.side = ?
       UNION ALL SELECT id FROM profile WHERE is_default = 1 AND ? = 'A' AND NOT EXISTS (SELECT 1 FROM attempt_player WHERE attempt_id = ? AND side = 'A')`,
    )
    .pluck()
    .get(attemptId, side, side, attemptId) as number | undefined;
  if (profile === undefined) return new Map();
  return new Map((db.prepare('SELECT hero_name AS hero, rank FROM roster WHERE profile_id = ? AND rank IS NOT NULL').all(profile) as { hero: string; rank: string }[]).map((r) => [r.hero, r.rank]));
}

/**
 * Cuts the tiles of every kept battle report picture and pairs them with the hero and rank of the saved record (ADR 0026). The local hero reader names
 * a tile; the tile is paired only when that hero is on the record's side exactly once, and its rank is not one a roster may have filled in. Nothing
 * is saved here. A look too close to a known one, or to one already proposed, is left out, and so is a tile the records of one picture disagree on.
 */
export async function harvestRankLooks(db: Database.Database, imagesDir: string, known: RankExample[]): Promise<Harvest> {
  const heroSamples = await lookExamples(db, imagesDir).heroExamples();
  const ranks = new Set(db.prepare('SELECT name FROM rank').pluck().all() as string[]);
  const result: Harvest = { pictures: 0, unreadable: 0, tiles: 0, proposed: [], skipped: new Map() };
  const skip = (reason: Harvest['skipped'] extends Map<infer K, number> ? K : never, count = 1) => result.skipped.set(reason, (result.skipped.get(reason) ?? 0) + count);
  const rows = db.prepare("SELECT attempt_id AS attemptId, hash, file FROM import_picture WHERE screen = 'report' ORDER BY attempt_id").all() as { attemptId: number; hash: string; file: string }[];
  const bySlot = new Map<string, ProposedLook[] | 'conflict'>();
  const sides = db.prepare('SELECT hero, rank FROM v_side_hero WHERE attempt_id = ? AND side = ?');
  for (const row of rows) {
    let picture: Buffer;
    try {
      picture = await readFile(join(resolve(imagesDir), 'imports', 'report', row.file));
    } catch {
      result.unreadable++;
      continue;
    }
    const { height = 0 } = await sharp(picture).metadata();
    const found = (await findBattleSides(picture)).sort((a, b) => a.boxes[0]!.top - b.boxes[0]!.top);
    result.pictures++;
    for (const found1 of found) {
      const side = found1.boxes[0]!.top < height * 0.4 ? 'A' : 'B';
      const named: (string | null)[] = [];
      const cuts: Buffer[] = [];
      for (const box of found1.boxes) {
        const cut = await tileCrop(picture, box);
        cuts.push(cut);
        const reading = (await isBlank(cut)) ? null : readHero(await heroFeatures(cut), heroSamples);
        named.push(reading?.confident ? reading.hero : null);
      }
      result.tiles += named.length;
      const record = (sides.all(row.attemptId, side) as SideRow[]).filter((h) => h.rank === null || ranks.has(h.rank));
      const { paired, skipped } = pairTiles(named, record, rosterRanks(db, row.attemptId, side));
      for (const [reason, count] of skipped) skip(reason, count);
      for (const tile of paired) {
        const slot = `${row.hash}:${side}:${tile.index}`;
        const look: ProposedLook = { rank: tile.rank, hero: tile.hero, attemptId: row.attemptId, png: cuts[tile.index]!, features: await rankFeatures(cuts[tile.index]!) };
        const held = bySlot.get(slot);
        if (held === undefined) bySlot.set(slot, [look]);
        else if (held !== 'conflict' && held[0]!.rank === look.rank && held[0]!.hero === look.hero) continue; // the same picture kept for another fight of the battle
        else {
          bySlot.set(slot, 'conflict');
          skip('conflict');
        }
      }
    }
  }
  const taken = [...known];
  for (const held of bySlot.values()) {
    if (held === 'conflict') continue;
    const look = held[0]!;
    if (taken.some((e) => e.rank === look.rank && rankDistance(e.features, look.features) < SAME_TILE_DISTANCE)) {
      skip('known');
      continue;
    }
    taken.push({ rank: look.rank, features: look.features });
    result.proposed.push(look);
  }
  return result;
}
