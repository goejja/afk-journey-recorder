import sharp from 'sharp';
import type { ImportPlayer, ParsedFight, ParsedPlayer, ParsedTile, TileReading } from '../../domain/roster-import.js';
import { readStars } from '../../vision/star-count.js';
import { isBlank, tileBand, type TileBox } from '../../vision/tile-image.js';
import { rankFeatures, readRank, RANK_MAX_DISTANCE, type RankExample } from '../../vision/rank-read.js';
import { heroFeatures, HERO_MAX_DISTANCE, readHero, type HeroExample } from '../../vision/hero-read.js';
import { wholeTile, withFrameTop, type PicturePlan } from './import-pictures.js';

/** A tile is read locally only when both readers are well inside their own limits: this share of the distance they accept. */
const LOCAL_SURE = 0.5;

/** One tile cut from the picture, with the frame's top, as PNG bytes. */
export const tileCrop = (picture: Buffer, box: TileBox) => sharp(picture).extract(withFrameTop(box)).png().toBuffer();

/**
 * The tiles of a picture that the local readers name (hero and rank) with a margin to spare, by strip id and tile index. A tile that is
 * not sure, or whose rank is not one of the game's is left to the Agent; the tiles around it are not. A blank tile is an empty slot.
 */
export async function knownTiles(plan: PicturePlan, picture: Buffer, rankSamples: RankExample[], heroSamples: HeroExample[], ranks: string[]): Promise<Map<string, Map<number, ParsedTile>>> {
  const known = new Map<string, Map<number, ParsedTile>>();
  if (rankSamples.length === 0 || heroSamples.length === 0) return known;
  for (const crops of plan.players) {
    for (const crop of crops) {
      const tiles = new Map<number, ParsedTile>();
      for (const [index, box] of crop.boxes.entries()) {
        const cut = await tileCrop(picture, box);
        // an empty slot is known too: the pixels say so, as they do for a tile the Agent left unnamed
        if (await isBlank(cut)) {
          tiles.set(index, { crop: crop.id, index, hero: null, candidates: [], rank: null, confident: false, rankConfident: false, notOwned: false });
          continue;
        }
        const hero = readHero(await heroFeatures(cut), heroSamples);
        const rank = readRank(await rankFeatures(cut), rankSamples);
        if (!hero?.confident || hero.distance > HERO_MAX_DISTANCE * LOCAL_SURE || !rank?.confident || rank.distance > RANK_MAX_DISTANCE * LOCAL_SURE || !ranks.includes(rank.rank)) continue;
        tiles.set(index, { crop: crop.id, index, hero: hero.hero, candidates: [], rank: rank.rank, confident: true, rankConfident: true, notOwned: false });
      }
      if (tiles.size > 0) known.set(crop.id, tiles);
    }
  }
  return known;
}

/**
 * Puts the Agent's reply for the tiles it was given back with the tiles read locally, each at its place in the strip. `toRead` lists the
 * positions in a strip that the Agent was asked about; `known` the strips it was not given at all.
 */
export function withKnownTiles(
  result: { players: ParsedPlayer[]; fight: ParsedFight | null },
  plan: PicturePlan,
  knownBy: Map<string, Map<number, ParsedTile>>,
  known: Set<string>,
  toRead: (crop: { id: string; boxes: TileBox[] }) => number[],
): { players: ParsedPlayer[]; fight: ParsedFight | null } | { error: string } {
  // the Agent counted the tiles it was given: they go back to their places in the strip, with the tiles read locally
  for (const [p, crops] of plan.players.entries()) {
    for (const c of crops) {
      const given = result.players[p]!.tiles.filter((t) => t.crop === c.id);
      if (!known.has(c.id) && given.length < toRead(c).length) return { error: `The agent did not reply for every tile of ${c.id}` };
    }
  }
  return {
    ...result,
    players: result.players.map((player, p) => ({
      ...player,
      tiles: plan.players[p]!.flatMap((c) => {
        const unread = toRead(c);
        const read = player.tiles.filter((t) => t.crop === c.id).slice(0, unread.length).map((t, i) => ({ ...t, index: unread[i]! }));
        return [...(knownBy.get(c.id)?.values() ?? []), ...read].sort((a, b) => a.index - b.index);
      }),
    })),
  };
}

/**
 * The players as the review shows them: each tile cut from the picture (kept in `tiles` for saving as a Hero Look and in `views` for the
 * review), read by the local readers for its rank, its hero and its stars, with a hero the player confirmed on a look-alike tile winning
 * over the Agent's reading.
 */
export async function readPlayers(input: {
  plan: PicturePlan;
  picture: Buffer;
  parsed: ParsedPlayer[];
  /** The artifact the local reader named for a side, by player. */
  artifactBy: Map<number, string>;
  rankSamples: RankExample[];
  heroSamples: HeroExample[];
  tiles: Map<string, Buffer>;
  views: Map<string, Buffer>;
}): Promise<ImportPlayer[]> {
  const { plan, picture, parsed, artifactBy, rankSamples, heroSamples, tiles: cuts, views } = input;
  const players: ImportPlayer[] = [];
  for (const [p, player] of parsed.entries()) {
    const tiles: TileReading[] = [];
    for (let tile of player.tiles) {
      const box: TileBox | undefined = plan.players[p]!.find((c) => c.id === tile.crop)?.boxes[tile.index];
      const key = `${p}.${tile.crop}.${tile.index}`;
      let stars: TileReading['stars'] = null;
      let rankRead: TileReading['rankRead'] = null;
      let heroRead: TileReading['heroRead'] = null;
      let blank = false;
      if (box) {
        const crop = await tileCrop(picture, box);
        cuts.set(key, crop);
        views.set(key, await wholeTile(picture, box));
        // a Not Owned tile is drawn as the viewer's game draws a hero they lack: its frame says nothing of the player's rank
        if (!tile.notOwned && rankSamples.length > 0) rankRead = readRank(await rankFeatures(crop), rankSamples);
        // a hero the player confirmed on a tile that looks the same wins over the Agent's reading, and names a tile the Agent
        // left unnamed (an empty slot, which has no picture, stays empty)
        const unnamed = tile.hero === null && tile.candidates.length === 0;
        if (unnamed) blank = await isBlank(crop);
        if (!tile.notOwned && !blank && heroSamples.length > 0) {
          const seen = readHero(await heroFeatures(crop), heroSamples);
          if (seen?.confident) {
            heroRead = { hero: seen.hero, changed: tile.hero !== seen.hero };
            tile = { ...tile, hero: seen.hero, candidates: [], confident: true };
          }
        }
        // a tile that is neither named nor a candidate is not used, so its stars are not counted
        if (tile.hero !== null || tile.candidates.length > 0) {
          const read = readStars(await tileBand(picture, box));
          stars = { state: read.stars, level: read.level };
        }
      }
      tiles.push({ ...tile, key, stars, rankRead, heroRead, ...(blank ? { blank } : {}) });
    }
    // a side whose artifact the local reader named keeps that name; its level is not read (ADR 0014)
    const localArtifact = artifactBy.get(p);
    const artifact = localArtifact ? { name: localArtifact, level: null } : player.artifact;
    players.push({ name: player.name, tiles, ...(artifact !== undefined ? { artifact } : {}), ...(player.phantimal !== undefined ? { phantimal: player.phantimal } : {}) });
  }
  for (const [p, side] of (plan.extras ?? []).entries()) {
    if (!players[p]) continue;
    const keys = { artifact: `${p}.artifact`, phantimal: `${p}.phantimal` };
    views.set(keys.artifact, await sharp(picture).extract(side.artifact).png().toBuffer());
    views.set(keys.phantimal, await sharp(picture).extract(side.phantimal).png().toBuffer());
    players[p] = { ...players[p]!, crops: keys };
  }
  return players;
}
