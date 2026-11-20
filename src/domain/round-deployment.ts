import { TILE_COUNT } from './map.js';
import { checkFactionRequirement, checkUnits, heroCount, isSummon, PAIR_PHANTIMALS, partOf } from './units.js';

/**
 * A Round Deployment: the teams one Player fields for a whole Round of a Super League Tournament (ADR 0020). Tiles are kept as Side A
 * stands (the player's zone); a picture where the Player is on Side B is matched with the board turned upside down.
 */
export const TEAMS_IN_ROUND = 5;

export interface RoundHero {
  /** Where the hero stands, or null until a saved Battle of the Round shows it: the pictures give no tiles (ADR 0020). */
  tile: number | null;
  hero: string;
  /** '' for a hero standing alone, as in a saved formation. */
  part: string;
  rank: string | null;
  equipmentLevel: number | null;
}

interface RoundPhantimal {
  name: string;
  tile: number | null;
  partnerTile?: number | null;
}

export interface RoundTeam {
  heroes: RoundHero[];
  phantimal: RoundPhantimal | null;
  artifact: string | null;
  /** The Map the tiles were placed on, when the player placed them: a Battle on another Map does not reuse them (ADR 0021). */
  mapName?: string;
  /**
   * The pictures' readings the player corrected when confirming this team (a hero the reader keeps misnaming, a rank it cannot tell). A
   * later picture that reads the same is this team, not a change; the readings are never evidence.
   */
  seenAs?: ReadSide[];
}

/** One entry per team number (index 0 is team 1); null for a team nobody confirmed yet. */
export type RoundDeployment = (RoundTeam | null)[];

/** What a picture says of one side. A rank or equipment level is set only where the picture was sure of it. */
interface ReadHero {
  hero: string;
  rank: string | null;
  equipmentLevel: number | null;
}

export interface ReadSide {
  heroes: ReadHero[];
  artifact: string | null;
  phantimal: string | null;
  /** The tiles that show a hero nobody could name. */
  unread: number;
}

export type Change =
  | { kind: 'hero'; gone: string[]; added: string[] }
  | { kind: 'rank'; hero: string; from: string; to: string }
  | { kind: 'equipment'; hero: string; from: number; to: number }
  | { kind: 'artifact'; from: string; to: string }
  | { kind: 'phantimal'; from: string; to: string };

/**
 * How a picture's side compares with the Player's team in the Round Deployment. A hero the picture named that is not in the Deployment, or
 * a rank, equipment level, artifact or phantimal it was sure of that differs, is a change: shown to the player, never replaced silently.
 */
export type TeamMatch =
  | { state: 'none' }
  | { state: 'fits'; team: RoundTeam }
  /** `team` has the picture's values over the Deployment's, `unplaced` the heroes it named that the Deployment has no tile for, `deployment` the team as confirmed. */
  | { state: 'changed'; team: RoundTeam; unplaced: ReadHero[]; deployment: RoundTeam; changes: Change[] };

const turn = <T extends number | null | undefined>(tile: T): T => (typeof tile === 'number' ? ((TILE_COUNT - 1 - tile) as T) : tile);

/** The team with the whole board turned upside down (tile `i` becomes `TILE_COUNT - 1 - i`). */
/** Whether two pictures said the same of a side: the same heroes with the same ranks and equipment, artifact, phantimal and unread tiles. */
export function sameReading(a: ReadSide, b: ReadSide): boolean {
  const key = (r: ReadSide) =>
    JSON.stringify([
      r.heroes.map((h) => [h.hero, h.rank, h.equipmentLevel]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
      r.artifact,
      r.phantimal === null ? null : phantimalKey(r.phantimal),
      r.unread,
    ]);
  return key(a) === key(b);
}

/** The most readings kept with a team. */
const MAX_SEEN_AS = 8;

/** The readings of `team` with `more` added: the same reading once, the latest kept. */
export function withSeenAs(team: RoundTeam, more: ReadSide[]): RoundTeam {
  const all: ReadSide[] = [];
  for (const read of [...(team.seenAs ?? []), ...more]) if (!all.some((r) => sameReading(r, read))) all.push(read);
  return all.length === 0 ? team : { ...team, seenAs: all.slice(-MAX_SEEN_AS) };
}

export function turnTeam(team: RoundTeam): RoundTeam {
  return {
    ...team,
    heroes: team.heroes.map((h) => ({ ...h, tile: turn(h.tile) })),
    phantimal: team.phantimal
      ? { ...team.phantimal, tile: turn(team.phantimal.tile), ...(team.phantimal.partnerTile !== undefined ? { partnerTile: turn(team.phantimal.partnerTile) } : {}) }
      : null,
  };
}

/** The names of the heroes of a team: a pair counts once, summons not at all. */
export const heroNamesOf = (team: RoundTeam): string[] => [...new Set(team.heroes.filter((h) => !isSummon(h)).map((h) => h.hero))];

/** The name a phantimal is kept under: a pair is kept under its first part, whichever part the picture showed. */
const phantimalKey = (name: string): string => Object.entries(PAIR_PHANTIMALS).find(([, partner]) => partner === name)?.[0] ?? name;

/** A team can be told "none"-state for: no confirmed team, or one with nothing on it. */
const isEmptyTeam = (team: RoundTeam | null | undefined): team is null | undefined => !team || (team.heroes.length === 0 && team.phantimal === null);

export function matchTeam(deployed: RoundTeam | null | undefined, read: ReadSide, side: 'A' | 'B'): TeamMatch {
  if (isEmptyTeam(deployed)) return { state: 'none' };
  const confirmed = side === 'A' ? deployed : turnTeam(deployed);
  // a reading the player already corrected into this team is no change
  if (confirmed.seenAs?.some((seen) => sameReading(seen, read))) return { state: 'fits', team: confirmed };
  const seen = new Map(read.heroes.map((h) => [h.hero, h]));
  const known = new Set(heroNamesOf(confirmed));
  const gone = [...known].filter((hero) => !seen.has(hero));
  const added = [...seen.keys()].filter((hero) => !known.has(hero));
  const changes: Change[] = [];
  // Tiles nobody could name stand for deployed heroes the picture did not name; only a named hero that is not deployed is a change.
  const swapped = added.length > 0 || gone.length > read.unread;
  if (swapped) changes.push({ kind: 'hero', gone, added });

  const heroes = confirmed.heroes
    .filter((h) => !(swapped && gone.includes(h.hero)))
    .map((h) => {
      const picture = seen.get(h.hero);
      if (!picture || isSummon(h)) return h;
      let { rank, equipmentLevel } = h;
      if (picture.rank !== null) {
        if (rank === null) rank = picture.rank;
        else if (rank !== picture.rank) {
          changes.push({ kind: 'rank', hero: h.hero, from: rank, to: picture.rank });
          rank = picture.rank;
        }
      }
      if (picture.equipmentLevel !== null) {
        if (equipmentLevel === null) equipmentLevel = picture.equipmentLevel;
        else if (equipmentLevel !== picture.equipmentLevel) {
          changes.push({ kind: 'equipment', hero: h.hero, from: equipmentLevel, to: picture.equipmentLevel });
          equipmentLevel = picture.equipmentLevel;
        }
      }
      return { ...h, rank, equipmentLevel };
    });

  let artifact = confirmed.artifact;
  if (read.artifact !== null) {
    if (artifact !== null && artifact !== read.artifact) changes.push({ kind: 'artifact', from: artifact, to: read.artifact });
    artifact = read.artifact;
  }
  // A different phantimal is reported but not put on the team: the picture gives no tile for it. A picture that shows one where the
  // Deployment has none is not a change, since the player may not have confirmed the phantimal.
  const phantimal = confirmed.phantimal;
  if (read.phantimal !== null && phantimal !== null && phantimalKey(read.phantimal) !== phantimalKey(phantimal.name)) {
    changes.push({ kind: 'phantimal', from: phantimal.name, to: read.phantimal });
  }

  const team: RoundTeam = { heroes, phantimal, artifact };
  if (changes.length === 0) return { state: 'fits', team };
  return { state: 'changed', team, unplaced: added.map((hero) => seen.get(hero)!), deployment: confirmed, changes };
}

/** Everything the faction check of a Round Deployment needs; omitted means it cannot be checked. */
export interface RoundFactions {
  heroFactions: Map<string, string | null>;
  phantimalFactions: Map<string, string | null>;
}

/** Returns an error message when a Round Deployment breaks the rules of the game, else null. */
export function roundDeploymentProblem(deployment: RoundDeployment, factions?: RoundFactions): string | null {
  if (deployment.length !== TEAMS_IN_ROUND) return `A Round Deployment has ${TEAMS_IN_ROUND} teams (empty ones are null)`;
  const heroOn = new Map<string, number>();
  const artifactOn = new Map<string, number>();
  for (const [index, team] of deployment.entries()) {
    if (isEmptyTeam(team)) continue;
    const label = `Team ${index + 1}`;
    // a tile still unknown (null) is allowed; the ones given must be on the board and apart
    const tiles = [...team.heroes.map((h) => h.tile), ...(team.phantimal ? [team.phantimal.tile, team.phantimal.partnerTile] : [])].filter((t): t is number => t !== null && t !== undefined);
    if (tiles.some((t) => !Number.isInteger(t) || t < 0 || t >= TILE_COUNT)) return `${label}: a tile is off the board`;
    if (new Set(tiles).size !== tiles.length) return `${label}: two units are on one tile`;
    const units = checkUnits(team.heroes.map((h) => ({ hero: h.hero, part: partOf(h) })));
    if (units) return `${label}: ${units}`;
    if (heroCount(team.heroes) > 5) return `${label}: a team has at most 5 heroes`;
    if (team.phantimal && factions) {
      const factionError = checkFactionRequirement(team.heroes, team.phantimal.name, factions.phantimalFactions.get(team.phantimal.name), factions.heroFactions);
      if (factionError) return `${label}: ${factionError}`;
    }
    for (const hero of heroNamesOf(team)) {
      const earlier = heroOn.get(hero);
      if (earlier !== undefined) return `${hero} is on teams ${earlier} and ${index + 1}: a hero plays on one team only`;
      heroOn.set(hero, index + 1);
    }
    if (team.artifact !== null) {
      const earlier = artifactOn.get(team.artifact);
      if (earlier !== undefined) return `${team.artifact} is on teams ${earlier} and ${index + 1}: an artifact goes on one team only`;
      artifactOn.set(team.artifact, index + 1);
    }
  }
  return null;
}

/**
 * Puts the tiles of a saved Battle's side into the Round Deployment's team that has the same heroes and no tiles yet (ADR 0020): the first
 * Battle saved for a Player and team gives the Deployment its tiles, and the later ones reuse them. `placed` is the saved side with Side A's
 * tiles. A tile the Deployment already has is never replaced, and a team with other heroes is left as it is (null).
 */
export function withPlacement(deployed: RoundTeam, placed: RoundTeam, mapName?: string): RoundTeam | null {
  const same = (a: RoundTeam, b: RoundTeam) => heroNamesOf(a).sort().join('|') === heroNamesOf(b).sort().join('|');
  if (!same(deployed, placed)) return null;
  const heroes = deployed.heroes.map((h) => {
    if (h.tile !== null) return h;
    const found = placed.heroes.find((p) => p.hero === h.hero && p.part === h.part);
    return found?.tile != null ? { ...h, tile: found.tile } : h;
  });
  const phantimal = deployed.phantimal && deployed.phantimal.tile === null && placed.phantimal && phantimalKey(placed.phantimal.name) === phantimalKey(deployed.phantimal.name)
    ? { ...deployed.phantimal, tile: placed.phantimal.tile, ...(placed.phantimal.partnerTile != null ? { partnerTile: placed.phantimal.partnerTile } : {}) }
    : deployed.phantimal;
  // the tiles come from a Battle on a Map: the team now belongs to that Map (ADR 0021)
  const filled = heroes.some((h, i) => h.tile !== deployed.heroes[i]!.tile) || phantimal?.tile !== deployed.phantimal?.tile;
  return { ...deployed, heroes, phantimal, ...(filled && mapName ? { mapName } : {}) };
}
