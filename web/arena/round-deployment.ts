import { TILE } from '../../src/domain/map.js';
import type { ReadSide, RoundHero, RoundTeam } from '../../src/domain/round-deployment.js';
import { heroNamesOf } from '../../src/domain/round-deployment.js';
import { isSummon } from '../../src/domain/units.js';
import { TEAMS_IN_ROUND, turnTeam, withSeenAs, type RoundDeployment } from '../../src/domain/round-deployment.js';
import type { ArenaBattle, BattleDraftSide, Profile, RoundDeploymentEntry } from '../backend.js';
import { placeOpponent, placeOwn } from '../reader/battle-import.js';
import { emptyFormation, withHeroState, type FormationState } from '../FormationEditor.js';
import type { OpponentState } from './OpponentEditor.js';

/** Moves between the form's sides and the Round Deployment's teams (ADR 0020). Teams are Side A's: a Side B team is turned with `turnTeam`. */

const heroOf = (row: { tile: number; hero: string; part?: string }, rank: string | null, equipmentLevel: number | null): RoundHero => ({
  tile: row.tile,
  hero: row.hero,
  part: row.part ?? '',
  rank: isSummon(row) ? null : rank,
  equipmentLevel: isSummon(row) ? null : equipmentLevel,
});

/** The team of a form's Side A, or null when no hero is placed. */
export function teamOfOwn(formation: FormationState): RoundTeam | null {
  if (formation.placed.length === 0) return null;
  return {
    heroes: formation.placed.map((p) => heroOf(p, formation.snapshots[p.hero]?.rank ?? null, formation.snapshots[p.hero]?.equipmentLevel ?? null)),
    phantimal: formation.phantimal ? { name: formation.phantimal.name, tile: formation.phantimal.tile, ...(formation.phantimal.partnerTile != null ? { partnerTile: formation.phantimal.partnerTile } : {}) } : null,
    artifact: formation.artifact || null,
  };
}

/** The team of a form's Side B, with its tiles as they stand (the caller turns it for the Deployment). */
export function teamOfOpponent(opponent: OpponentState): RoundTeam | null {
  if (opponent.placed.length === 0) return null;
  return {
    heroes: opponent.placed.map((p) => heroOf(p, p.rank || null, p.equipment === '' ? null : Number(p.equipment))),
    phantimal: opponent.phantimal ? { name: opponent.phantimal.name, tile: opponent.phantimal.tile, ...(opponent.phantimal.partnerTile != null ? { partnerTile: opponent.phantimal.partnerTile } : {}) } : null,
    artifact: opponent.artifact || null,
  };
}

/** What a side of a picture says, for `matchTeam`: its heroes (a hero once), the artifact and phantimal named, and the tiles nobody could name. */
export function readSideOf(side: BattleDraftSide): ReadSide {
  const heroes = new Map<string, ReadSide['heroes'][number]>();
  for (const h of side.heroes) heroes.set(h.hero, { hero: h.hero, rank: h.rank, equipmentLevel: h.equipmentLevel });
  return { heroes: [...heroes.values()], artifact: side.artifact?.name ?? null, phantimal: side.phantimal ?? null, unread: side.unread?.length ?? 0 };
}

/** What a team already in the form says, for comparing it with the Deployment. */
export function readSideOfTeam(team: RoundTeam): ReadSide {
  const heroes = new Map<string, ReadSide['heroes'][number]>();
  for (const h of team.heroes) if (!isSummon(h)) heroes.set(h.hero, { hero: h.hero, rank: h.rank, equipmentLevel: h.equipmentLevel });
  return { heroes: [...heroes.values()], artifact: team.artifact, phantimal: team.phantimal?.name ?? null, unread: 0 };
}

/** True when every tile of the team is known and on the zone of the map the side stands in. */
export function standsOn(team: RoundTeam, cells: number[], zone: number): boolean {
  const tiles = [...team.heroes.map((h) => h.tile), ...(team.phantimal ? [team.phantimal.tile, team.phantimal.partnerTile ?? undefined] : [])];
  return tiles.every((t) => t === undefined || (t !== null && cells[t] === zone));
}

/**
 * A Team change the player confirmed (ADR 0021): one team of the Deployment replaced for the rest of the Round, and the team it replaced
 * kept with it as a reading, so the picture that showed the old one is not flagged again. The other teams stand as they were.
 */
export function applyTeamChange(deployment: RoundDeployment, slot: number, team: RoundTeam): RoundDeployment {
  return deployment.map((old, i) => (i === slot ? withSeenAs(team, old ? [readSideOfTeam(old)] : []) : old));
}

/** How a Unit is named in a guess: its hero and its part, never the hero alone (a pair and a summon share the hero). */
const unitKey = (p: { hero: string; part?: string | null }) => `${p.hero}|${p.part ?? ''}`;

/** The tiles the form placed by itself, because a picture shows none: a guess, not a placement (ADR 0021). */
export interface GuessTiles {
  mapName: string;
  /** By Unit (`hero|part`), every tile that Unit was put on: Zanie's two turrets are two guesses of one name (ADR 0028). */
  heroes: Record<string, number[]>;
  phantimal: { tile: number; partnerTile?: number | null } | null;
}

export const guessOf = (mapName: string, placed: { tile: number; hero: string; part?: string }[], phantimal: { tile: number; partnerTile?: number | null } | null): GuessTiles => {
  const heroes: Record<string, number[]> = {};
  for (const p of placed) heroes[unitKey(p)] = [...(heroes[unitKey(p)] ?? []), p.tile];
  return {
    mapName,
    heroes,
    phantimal: phantimal ? { tile: phantimal.tile, ...(phantimal.partnerTile != null ? { partnerTile: phantimal.partnerTile } : {}) } : null,
  };
};

/**
 * The guess with the tiles the Deployment already knows taken out: a known tile is a placement even when the form put a Unit there by
 * itself too (ADR 0021).
 */
export function pruneGuess(guess: GuessTiles, team: RoundTeam): GuessTiles {
  const known = new Set(team.heroes.filter((h) => h.tile !== null).map((h) => `${unitKey(h)}|${h.tile}`));
  return {
    ...guess,
    heroes: Object.fromEntries(Object.entries(guess.heroes).map(([unit, tiles]) => [unit, tiles.filter((tile) => !known.has(`${unit}|${tile}`))])),
    phantimal: team.phantimal && guess.phantimal && team.phantimal.tile === guess.phantimal.tile ? null : guess.phantimal,
  };
}

/**
 * A team before it is stored in a Round Deployment: every tile the form only guessed becomes unknown (ADR 0021). A Unit the player moved,
 * one the form placed on a map it changed to, and a Phantimal that moved keep their tiles. A guess is never taken for a placement just
 * because another Unit of the same hero was placed.
 */
export function withoutGuess(team: RoundTeam, guess: GuessTiles, mapName: string): RoundTeam {
  if (guess.mapName !== mapName) return { ...team, heroes: team.heroes.map((h) => ({ ...h, tile: null })), phantimal: team.phantimal ? { ...team.phantimal, tile: null, partnerTile: null } : null };
  // One guessed tile clears one stored Unit of that name: Zanie's two turrets are two guesses, and one moved turret keeps its tile.
  const left = new Map(Object.entries(guess.heroes).map(([unit, tiles]) => [unit, [...tiles]]));
  const heroes = team.heroes.map((h) => {
    const tiles = left.get(unitKey(h));
    if (h.tile === null || !tiles) return h;
    const at = tiles.indexOf(h.tile);
    if (at === -1) return h;
    tiles.splice(at, 1);
    return { ...h, tile: null };
  });
  return {
    ...team,
    heroes,
    phantimal:
      team.phantimal && guess.phantimal && guess.phantimal.tile === team.phantimal.tile
        ? { ...team.phantimal, tile: null, ...(guess.phantimal.partnerTile != null && guess.phantimal.partnerTile === team.phantimal.partnerTile ? { partnerTile: null } : {}) }
        : team.phantimal,
  };
}

/** The heroes of a team as a picture would give them: each hero once, with its state. */
const readHeroes = (team: RoundTeam): BattleDraftSide['heroes'] =>
  heroNamesOf(team).map((hero) => {
    const h = team.heroes.find((x) => x.hero === hero)!;
    return { tile: '', hero, rank: h.rank, equipmentLevel: h.equipmentLevel };
  });

const extrasOf = (team: RoundTeam): Pick<BattleDraftSide, 'artifact' | 'phantimal'> => ({ artifact: team.artifact ? { name: team.artifact, level: null } : null, phantimal: team.phantimal?.name ?? null });

/** Whether a placement holds exactly the team's units, pair parts and summons: only then are its tiles worth keeping. */
const sameUnits = (placed: { hero: string; part?: string }[], team: RoundTeam): boolean => {
  const key = (p: { hero: string; part?: string }) => `${p.hero}|${p.part ?? ''}`;
  const here = placed.map(key).sort();
  const wanted = team.heroes.map(key).sort();
  return here.length === wanted.length && here.every((unit, i) => unit === wanted[i]);
};

/**
 * Side A's form state for a team: where the Deployment says when it knows every tile and they fit the map, else its heroes on the tiles of
 * `current` when that placement holds the same units, and on free tiles otherwise (ADR 0021). A picture read with the same hero twice
 * therefore becomes the Deployment's team, never the invalid read.
 */
export function ownFromTeam(team: RoundTeam, cells: number[], current?: FormationState): FormationState {
  if (!standsOn(team, cells, TILE.PLAYER)) {
    const base = current && sameUnits(current.placed, team) ? current : placeOwn(cells, readHeroes(team), extrasOf(team));
    return ownWithKnownTiles(base, team, cells);
  }
  let formation: FormationState = {
    ...emptyFormation(),
    placed: team.heroes.map((h) => ({ tile: h.tile!, hero: h.hero, ...(h.part ? { part: h.part } : {}) })),
    phantimal: team.phantimal ? { name: team.phantimal.name, tile: team.phantimal.tile!, ...(team.phantimal.partnerTile != null ? { partnerTile: team.phantimal.partnerTile } : {}) } : null,
    artifact: team.artifact ?? '',
  };
  for (const h of team.heroes) if (!isSummon(h) && h.rank !== null) formation = withHeroState(formation, h.hero, h.rank, h.equipmentLevel === null ? '' : String(h.equipmentLevel));
  return formation;
}

/** Side B's form state for a team, likewise (the team already turned for Side B). */
export function opponentFromTeam(team: RoundTeam, cells: number[], current?: OpponentState): OpponentState {
  if (!standsOn(team, cells, TILE.ENEMY)) {
    const base = current && sameUnits(current.placed, team) ? current : placeOpponent(cells, readHeroes(team), extrasOf(team));
    return opponentWithKnownTiles(base, team, cells);
  }
  const opponent = placeOpponent(cells, [], { artifact: null, phantimal: null });
  return {
    ...opponent,
    placed: team.heroes.map((h) => ({ tile: h.tile!, hero: h.hero, ...(h.part ? { part: h.part } : {}), rank: h.rank ?? '', equipment: h.equipmentLevel === null ? '' : String(h.equipmentLevel) })),
    phantimal: team.phantimal ? { name: team.phantimal.name, tile: team.phantimal.tile!, ...(team.phantimal.partnerTile != null ? { partnerTile: team.phantimal.partnerTile } : {}) } : null,
    artifact: team.artifact ?? '',
  };
}

/** Side A's ranks, equipment levels and artifact from a team, over the tiles the form already has. */
function ownWithStates(current: FormationState, team: RoundTeam): FormationState {
  let formation: FormationState = { ...current, artifact: team.artifact ?? current.artifact };
  for (const h of team.heroes) if (!isSummon(h) && h.rank !== null) formation = withHeroState(formation, h.hero, h.rank, h.equipmentLevel === null ? '' : String(h.equipmentLevel));
  return formation;
}

/** Side B's likewise. */
function opponentWithStates(current: OpponentState, team: RoundTeam): OpponentState {
  return {
    ...current,
    artifact: team.artifact ?? current.artifact,
    placed: current.placed.map((p) => {
      const h = team.heroes.find((x) => x.hero === p.hero && !isSummon(x));
      return h && h.rank !== null && !isSummon(p) ? { ...p, rank: h.rank, equipment: h.equipmentLevel === null ? '' : String(h.equipmentLevel) } : p;
    }),
  };
}

/**
 * A matched Deployment team put on Side A of the form: a team whose tiles are all known and fit the map stands exactly as the Deployment
 * says; otherwise its ranks, equipment and artifact are applied and the tiles it knows are moved onto the form's placement, where this map
 * allows them and the tile is free (ADR 0021). A team with partly-known tiles therefore keeps them instead of losing the whole layout.
 */
export const applyToOwn = (current: FormationState, team: RoundTeam, cells: number[]): FormationState => ownFromTeam(team, cells, current);

/** The Deployment's known tiles put over the form's placement, where the map allows them and the tile is free. */
function ownWithKnownTiles(current: FormationState, team: RoundTeam, cells: number[]): FormationState {
  let formation = ownWithStates(current, team);
  for (const h of team.heroes) {
    if (h.tile === null || cells[h.tile] !== TILE.PLAYER) continue;
    const tile = h.tile;
    if (formation.placed.some((p) => p.tile === tile && !(p.hero === h.hero && (p.part ?? '') === (h.part ?? '')))) continue;
    formation = { ...formation, placed: formation.placed.map((p) => (p.hero === h.hero && (p.part ?? '') === (h.part ?? '') ? { ...p, tile } : p)) };
  }
  const phantimal = team.phantimal;
  if (phantimal && phantimal.tile !== null && cells[phantimal.tile] === TILE.PLAYER && !formation.placed.some((p) => p.tile === phantimal.tile)) {
    const partner = phantimal.partnerTile != null && phantimal.partnerTile !== phantimal.tile && cells[phantimal.partnerTile] === TILE.PLAYER && !formation.placed.some((p) => p.tile === phantimal.partnerTile) ? phantimal.partnerTile : undefined;
    formation = { ...formation, phantimal: { name: formation.phantimal?.name ?? phantimal.name, tile: phantimal.tile, ...(partner != null ? { partnerTile: partner } : {}) } };
  }
  return formation;
}

export const applyToOpponent = (current: OpponentState, team: RoundTeam, cells: number[]): OpponentState => opponentFromTeam(team, cells, current);

/** The Deployment's known tiles put over the form's Side B placement, likewise. */
function opponentWithKnownTiles(current: OpponentState, team: RoundTeam, cells: number[]): OpponentState {
  let opponent = opponentWithStates(current, team);
  for (const h of team.heroes) {
    if (h.tile === null || cells[h.tile] !== TILE.ENEMY) continue;
    const tile = h.tile;
    if (opponent.placed.some((p) => p.tile === tile && !(p.hero === h.hero && (p.part ?? '') === (h.part ?? '')))) continue;
    opponent = { ...opponent, placed: opponent.placed.map((p) => (p.hero === h.hero && (p.part ?? '') === (h.part ?? '') ? { ...p, tile } : p)) };
  }
  const phantimal = team.phantimal;
  if (phantimal && phantimal.tile !== null && cells[phantimal.tile] === TILE.ENEMY && !opponent.placed.some((p) => p.tile === phantimal.tile)) {
    const partner = phantimal.partnerTile != null && phantimal.partnerTile !== phantimal.tile && cells[phantimal.partnerTile] === TILE.ENEMY && !opponent.placed.some((p) => p.tile === phantimal.partnerTile) ? phantimal.partnerTile : undefined;
    opponent = { ...opponent, phantimal: { name: opponent.phantimal?.name ?? phantimal.name, tile: phantimal.tile, ...(partner != null ? { partnerTile: partner } : {}) } };
  }
  return opponent;
}

/** The team a Player fielded in a saved fight, with Side A's tiles: a Player who stood on Side B has the board turned back. */
function teamOfRecord(fight: ArenaBattle, side: 'A' | 'B'): RoundTeam {
  const recorded = side === 'A' ? fight.formation : fight.opponent;
  const team: RoundTeam = {
    heroes: recorded.heroes.map((h) => {
      const row = { tile: h.tile, hero: h.name, part: h.part ?? '' };
      return { ...row, rank: isSummon(row) ? null : h.rank, equipmentLevel: isSummon(row) ? null : h.equipmentLevel };
    }),
    phantimal: recorded.phantimal ? { name: recorded.phantimal.name, tile: recorded.phantimal.tile, ...(recorded.phantimal.partnerTile != null ? { partnerTile: recorded.phantimal.partnerTile } : {}) } : null,
    artifact: recorded.artifact || null,
  };
  return side === 'B' ? turnTeam(team) : team;
}

/**
 * The Round Deployments the saved Battles of a Round already show (ADR 0020): for each Profile, by Player ID, and each team number, the
 * EARLIEST saved fight in which the Player stood on either side (ADR 0021: once known, a team is not replaced by a later record). A Player
 * seen on Side A in one Battle and on Side B in the next has one Deployment: the Side B team is turned back.
 * `fights` must be those of one Tournament and Round.
 */
export function deploymentsFromRecords(fights: ArenaBattle[], profiles: Profile[]): RoundDeploymentEntry[] {
  const entries = new Map<number, RoundDeploymentEntry>();
  for (const fight of [...fights].sort((a, b) => a.id - b.id)) {
    if (fight.battlePosition === null) continue;
    for (const side of ['A', 'B'] as const) {
      const playerId = side === 'A' ? fight.playerIdA : fight.playerIdB;
      const profile = playerId ? profiles.find((p) => p.playerId?.toLowerCase() === playerId.toLowerCase()) : undefined;
      if (!profile) continue;
      const slot = fight.battlePosition - 1;
      const entry: RoundDeploymentEntry = entries.get(profile.id) ?? { profileId: profile.id, name: profile.name, playerId: profile.playerId, teams: Array(TEAMS_IN_ROUND).fill(null), recorded: [] };
      entries.set(profile.id, entry);
      if (entry.teams[slot]) continue; // the earliest fight of that team is the first met
      entry.teams[slot] = { ...teamOfRecord(fight, side), mapName: fight.mapName };
      entry.recorded!.push(slot);
    }
  }
  return [...entries.values()];
}

/** Confirmed Deployments over the ones the saved Battles show: a confirmed team always wins, a team only a saved Battle shows fills in. */
export function mergeDeployments(confirmed: RoundDeploymentEntry[], recorded: RoundDeploymentEntry[]): RoundDeploymentEntry[] {
  const merged = new Map<number, RoundDeploymentEntry>(confirmed.map((e) => [e.profileId, { ...e, recorded: [] as number[], confirmed: true }]));
  for (const from of recorded) {
    const entry: RoundDeploymentEntry = merged.get(from.profileId) ?? { ...from, teams: Array(TEAMS_IN_ROUND).fill(null), recorded: [], confirmed: false };
    merged.set(from.profileId, entry);
    for (const slot of from.recorded ?? []) {
      if (entry.teams[slot]) continue;
      entry.teams = entry.teams.map((t, i) => (i === slot ? from.teams[slot]! : t));
      entry.recorded!.push(slot);
    }
  }
  return [...merged.values()];
}
