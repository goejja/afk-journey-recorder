import { allowedEquipmentLevels, allowedRanks, type HeroStateRules } from './hero-state.js';
import { matchProfile, matchSeenName, type SeenName } from './name-match.js';
import { rosterChanges, type HeroStateValue, type RecordedHero } from './roster-sync.js';

/** What the local rank reader saw in a tile: the closest example's rank and how sure that is. */
export interface RankReading {
  /** The rank of the closest example. */
  rank: string;
  /** The distance to the closest example of that rank. */
  distance: number;
  /** How much farther the closest example of any other rank is, as a share of its distance (1 when there is no other rank). */
  margin: number;
  /** How many examples of that rank there are. */
  support: number;
  /** The reader trusts its answer: enough examples, a close one, and clearly closer than any other rank. */
  confident: boolean;
}

/**
 * Roster import: the Agent reads one picture of the game and says, for each hero tile, which hero it is and its rank; code
 * reads the stars (the equipment level). This turns that into a proposal for the review screen, by the rules of Roster sync:
 * new and upgraded heroes ticked, downgrades unticked, a hero the pictures do not show left alone. Nothing here saves anything.
 */

/** `report` is the battle report of a PvP mode, read for a Battle import: the same layout as `battle`, with the fight number, the result and the Union Levels. */
export type ImportScreen = 'info' | 'battle' | 'hall' | 'recap' | 'suggestion' | 'report';

/** Tiles of these screens are small, and the star counter is not yet proven on pictures it was not tuned on: a changed equipment level read from them is left unticked. */
const SMALL_TILE_SCREENS: ImportScreen[] = ['info', 'battle', 'recap', 'suggestion', 'report'];

/** What the Agent said about one tile. */
export interface ParsedTile {
  /** The crop the tile is in and its place in the crop, left to right (top to bottom for stacked tiles). */
  crop: string;
  index: number;
  /** A hero name from the game's list, or null when the Agent could not tell. */
  hero: string | null;
  /** When the hero is null: up to 3 heroes it might be. */
  candidates: string[];
  rank: string | null;
  /** The Agent is sure of the hero. */
  confident: boolean;
  /** The Agent is sure of the rank: the frame colour alone cannot tell the ranks from Supreme up apart, so it often is not. */
  rankConfident: boolean;
  /** The tile is marked "Not Owned" (a hero the viewer does not own, in a Treasure Rush list): it shows no stars, so its equipment cannot be read. */
  notOwned: boolean;
}

/** An artifact as a battle report shows it beside a player's name: its name and the level after the "+", each null when the Agent could not read it. */
interface ParsedArtifact {
  name: string | null;
  level: number | null;
}

export interface ParsedPlayer {
  /** The name as the game shows it, or null when the picture has none (the Resonating Hall). */
  name: string | null;
  tiles: ParsedTile[];
  /** From a battle report: the side's artifact, and its phantimal (the round tile under the five heroes), null when the picture shows none or it was not named. */
  artifact?: ParsedArtifact | null;
  phantimal?: string | null;
}

/** What the Agent read of a PvP battle report besides the tiles. */
export interface ParsedFight {
  /** The fight's number in its battle (the highlighted tab), or null when the report has none (an Arena fight). */
  number: number | null;
  /** The ally (left) side won this fight; null when the Agent could not tell. */
  allyWon: boolean | null;
  unionLevelAlly: number | null;
  unionLevelEnemy: number | null;
}

/** The crops the Agent was given: for each player, the ids of their crops. */
export type ExpectedCrops = string[][];

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** The JSON object in the Agent's reply: it may be wrapped in a code fence or in a sentence. */
function jsonObject(reply: string): unknown {
  // The first balanced `{ ... }` that parses and holds the players: a sentence before or after the JSON, with braces of its own, does not hide it.
  for (let start = reply.indexOf('{'); start >= 0; start = reply.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < reply.length; i++) {
      const c = reply[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const found = JSON.parse(reply.slice(start, i + 1));
          if (found && typeof found === 'object' && Array.isArray((found as { players?: unknown }).players)) return found;
        } catch {
          // not JSON: look from the next brace
        }
        break;
      }
    }
  }
  return null;
}

/**
 * The players and tiles in an Agent's reply, checked against the hero and rank lists. A hero or rank that is not in the lists is
 * dropped (a hero then counts as unknown). Returns an error when the reply is not the expected JSON.
 */
export function parseImportReply(reply: string, expected: ExpectedCrops, heroNames: string[], ranks: string[], extras?: { artifacts: string[]; phantimals: string[] }): { players: ParsedPlayer[]; fight: ParsedFight | null } | { error: string } {
  const root = jsonObject(reply) as { players?: unknown; fight?: unknown } | null;
  if (!root || !Array.isArray(root.players)) return { error: `The agent did not reply with the players it read${reply === '' ? ' (an empty reply)' : ` (it said: ${reply.replace(/\s+/g, ' ').slice(0, 120)})`}` };
  const heroByLowerName = new Map(heroNames.map((name) => [name.toLowerCase(), name]));
  const rankByLowerName = new Map(ranks.map((name) => [name.toLowerCase(), name]));
  const hero = (value: unknown) => heroByLowerName.get(text(value)?.toLowerCase() ?? '') ?? null;
  const listed = (names: string[]) => {
    const byLowerName = new Map(names.map((name) => [name.toLowerCase(), name]));
    return (value: unknown) => byLowerName.get(text(value)?.toLowerCase() ?? '') ?? null;
  };
  const artifactName = listed(extras?.artifacts ?? []);
  const phantimalName = listed(extras?.phantimals ?? []);
  const players: ParsedPlayer[] = [];
  // The Agent sometimes lists a strip under the other player: a strip is found by its id wherever it was put.
  const crops = new Map<string, unknown>();
  for (const given of root.players as { crops?: Record<string, unknown> }[]) {
    for (const [id, list] of Object.entries(given?.crops ?? {})) if (!crops.has(id)) crops.set(id, list);
  }
  for (const [position, cropIds] of expected.entries()) {
    const given = root.players[position] as { name?: unknown; crops?: Record<string, unknown>; artifact?: { name?: unknown; level?: unknown } | null; phantimal?: unknown } | undefined;
    if (!given || typeof given !== 'object') return { error: `The agent did not reply for player ${position + 1}` };
    const tiles: ParsedTile[] = [];
    for (const crop of cropIds) {
      const list = given.crops?.[crop] ?? crops.get(crop);
      if (!Array.isArray(list)) return { error: `The agent did not reply for ${crop}` };
      list.forEach((entry: any, index) => {
        const named = hero(entry?.hero);
        const candidates = (Array.isArray(entry?.candidates) ? entry.candidates : []).map(hero).filter((h: string | null): h is string => h !== null).slice(0, 3);
        tiles.push({
          crop,
          index,
          hero: named,
          candidates: named ? [] : candidates,
          rank: rankByLowerName.get(text(entry?.rank)?.toLowerCase() ?? '') ?? null,
          confident: named !== null && entry?.confident !== false,
          rankConfident: entry?.rankSure !== false,
          notOwned: entry?.notOwned === true,
        });
      });
    }
    const artifact = extras && given.artifact && typeof given.artifact === 'object' ? { name: artifactName(given.artifact.name), level: wholeNumber(given.artifact.level, 0, 99) } : null;
    players.push({ name: text(given.name), tiles, ...(extras ? { artifact: artifact && (artifact.name !== null || artifact.level !== null) ? artifact : null, phantimal: phantimalName(given.phantimal) } : {}) });
  }
  return { players, fight: parseFight(root.fight) };
}

/** What the star counter said about a tile: no reading when the tile could not be cut from the picture. */
interface StarsReading {
  state: 'present' | 'absent' | 'unsure';
  level: number | null;
}

const wholeNumber = (value: unknown, min: number, max: number): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null);

function parseFight(value: unknown): ParsedFight | null {
  if (!value || typeof value !== 'object') return null;
  const given = value as Record<string, unknown>;
  const result = typeof given['ally'] === 'string' ? given['ally'].toLowerCase() : null;
  return {
    number: wholeNumber(given['number'], 1, 5),
    allyWon: result === 'won' ? true : result === 'lost' ? false : null,
    unionLevelAlly: wholeNumber(given['unionLevelAlly'], 0, 999),
    unionLevelEnemy: wholeNumber(given['unionLevelEnemy'], 0, 999),
  };
}

export interface TileReading extends ParsedTile {
  /** A key for this tile within the import, used to fetch its crop. */
  key: string;
  /** What the rank reader said of the tile's frame top; null without examples or for a Not Owned tile. */
  rankRead?: RankReading | null;
  /** Set when the hero reader was sure of the hero (a saved look): the hero it gave, and whether that is not what the Agent said. */
  heroRead?: { hero: string; changed: boolean } | null;
  stars: StarsReading | null;
  /** Set when the tile shows no picture at all, an empty slot: nothing to name. */
  blank?: boolean;
}

export interface ImportPlayer {
  name: string | null;
  tiles: TileReading[];
  artifact?: ParsedArtifact | null;
  phantimal?: string | null;
  /** The keys of the crops of its artifact and phantimal, as for the tiles (`/api/roster-import/:id/tile/:key`). */
  crops?: { artifact: string; phantimal: string };
}

export interface ImportProfile {
  id: number;
  name: string;
  heroes: Map<string, HeroStateValue>;
}

interface ProposalRow {
  tile: string;
  hero: string;
  direction: 'new' | 'upgrade' | 'downgrade';
  from: HeroStateValue;
  to: HeroStateValue;
  /** Ticked in the review: new and upgraded heroes whose tile was read with confidence. */
  selected: boolean;
  /** What the rank reader said, when it was sure: its rank and how many examples of that rank it has. The row's rank is its rank. */
  reader: { rank: string; support: number; agrees: boolean } | null;
  /** The hero came from a saved look, the hero reader being sure; `agrees` is whether the Agent named the same hero. */
  look: { agrees: boolean } | null;
  /** What the player should look at before applying: the hero, the rank or the stars may have been read wrongly. */
  check: ('hero' | 'rank' | 'stars' | 'not-owned')[];
}

interface UnknownTile {
  tile: string;
  candidates: string[];
  rank: string | null;
}

export interface ProposalSection {
  /** The name as the game shows it. */
  playerName: string | null;
  /** The profile the heroes go to; null when a new one will be created (`create`) or none is chosen yet. */
  profile: { id: number; name: string } | null;
  /** Rename the profile to this, the in-game spelling, when it is spelled differently now. */
  rename: string | null;
  /** The name of the profile to create, when the player matches none. */
  create: string | null;
  rows: ProposalRow[];
  unknown: UnknownTile[];
  /** Tiles whose hero is known but whose rank is not, so they cannot be added or changed. */
  withoutRank: { tile: string; hero: string }[];
}

export interface ProposalContext {
  screen: ImportScreen;
  profiles: ImportProfile[];
  /** The spellings resolved to Profiles before (ADR 0021); a spelling found there wins over the profile's own name. */
  seenNames?: SeenName[];
  rules: HeroStateRules;
  /** Hero name to tier. */
  tiers: Map<string, string | null>;
}

/** Where the heroes of a section go: the profile matched by name, a chosen one, or a new one. */
export type Target = { kind: 'match' } | { kind: 'profile'; id: number } | { kind: 'new' };

/** The rank the rank reader gives a tile, when it is sure. */
const readerRank = (tile: TileReading): string | null => (tile.rankRead?.confident ? tile.rankRead.rank : null);

export function buildSection(player: ImportPlayer, context: ProposalContext, target: Target): ProposalSection {
  const { rules } = context;
  let profile: ImportProfile | null = null;
  let rename: string | null = null;
  let create: string | null = null;
  if (target.kind === 'profile') {
    profile = context.profiles.find((p) => p.id === target.id) ?? null;
  } else if (target.kind === 'match' && player.name !== null) {
    // a spelling resolved to a Profile before wins over the profile's own name (ADR 0021)
    const seenId = matchSeenName(player.name, context.seenNames ?? []);
    const match = seenId === null ? matchProfile(player.name, context.profiles) : null;
    profile = seenId !== null ? (context.profiles.find((p) => p.id === seenId) ?? null) : match ? (context.profiles.find((p) => p.id === match.profile.id) ?? null) : null;
    if (match?.spelledDifferently) rename = player.name;
    if (!profile) create = player.name;
  } else if (target.kind === 'new') {
    create = player.name;
  }

  const rows: ProposalRow[] = [];
  const unknown: UnknownTile[] = [];
  const withoutRank: { tile: string; hero: string }[] = [];
  const recorded: RecordedHero[] = [];
  const byHero = new Map<string, TileReading>();
  const roster = profile?.heroes ?? new Map<string, HeroStateValue>();

  for (const tile of player.tiles) {
    if (tile.hero === null) {
      // a hero the Agent could not name and had no candidates for is still a hero: the player names it, unless the tile is an empty slot
      if (tile.candidates.length > 0 || !tile.blank) unknown.push({ tile: tile.key, candidates: tile.candidates, rank: tile.rank });
      continue;
    }
    const known = roster.get(tile.hero);
    const tileRank = readerRank(tile) ?? tile.rank;
    // A Not Owned tile shows the hero as the viewer's own game draws one they lack, not the state of the player: a hero the Profile has is left as it is.
    if (tile.notOwned && known) continue;
    const rank = tileRank ?? known?.rank ?? null;
    if (rank === null) {
      withoutRank.push({ tile: tile.key, hero: tile.hero });
      continue;
    }
    // A level only counts where the rank allows equipment at all, and where it is one the rank allows.
    const allowed = allowedEquipmentLevels(rank, rules);
    const read = tile.stars?.state === 'present' ? tile.stars.level : null;
    const level = read !== null && allowed.includes(read) ? read : null;
    if (!byHero.has(tile.hero)) byHero.set(tile.hero, tile);
    recorded.push({ name: tile.hero, rank, equipmentLevel: level });
  }

  for (const change of rosterChanges(recorded, roster, rules.ranks)) {
    const tile = byHero.get(change.hero)!;
    const check: ProposalRow['check'][number][] = [];
    if (!tile.confident) check.push('hero');
    const reader = tile.rankRead?.confident ? tile.rankRead : null;
    const tileRank = reader?.rank ?? tile.rank;
    // When the rank reader is sure, the Agent only has to agree with it; otherwise the Agent's own doubt counts
    if (reader && tile.rank !== null && tile.rank !== reader.rank) check.push('rank');
    else if (!reader && tileRank !== null && !tile.rankConfident) check.push('rank');
    else if (tileRank !== null && !allowedRanks(context.tiers.get(change.hero) ?? null, rules.ranks).includes(tileRank)) check.push('rank');
    const allowed = allowedEquipmentLevels(change.to.rank, rules);
    const read = tile.stars?.state === 'present' ? tile.stars.level : null;
    const equipmentChanged = change.to.equipmentLevel !== change.from.equipmentLevel;
    const starsDoubtful =
      allowed.length > 0 && (tile.stars === null || tile.stars.state === 'unsure' || (read !== null && !allowed.includes(read)) || (equipmentChanged && SMALL_TILE_SCREENS.includes(context.screen)));
    if (tile.notOwned) check.push('not-owned');
    else if (starsDoubtful) check.push('stars');
    rows.push({ tile: tile.key, hero: change.hero, direction: change.direction, from: change.from, to: change.to, selected: change.direction !== 'downgrade' && check.length === 0, check, reader: reader && { rank: reader.rank, support: reader.support, agrees: tile.rank === reader.rank }, look: tile.heroRead ? { agrees: !tile.heroRead.changed } : null });
  }
  return { playerName: player.name, profile: profile && { id: profile.id, name: profile.name }, rename, create, rows, unknown, withoutRank };
}
