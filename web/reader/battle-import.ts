import { urlOf } from '../../src/shared/contract.js';
import { rosterImportContract } from '../../src/shared/contracts/roster-import.js';
import { TEAMS_PER_MODE } from '../../src/domain/arena.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { PAIR_HEROES, PAIR_PHANTIMALS, SUMMONS } from '../../src/domain/units.js';
import { layoutFrom } from '../../src/domain/layout.js';
import { knewHomelessPlacement, resolveSavedPlacement, type PlacementTarget, type SavedPlacement } from '../../src/domain/placement-reuse.js';
import type { ArenaBattle, ArenaMode, BattleDraft, BattleDraftSide, BattleImportPicture, Hero, ImportFeedbackSide, ImportReading } from '../backend.js';
import { emptyFormation, formationFromRecord, placeHero, withHeroState, type FormationState } from '../FormationEditor.js';
import { emptyOpponent, opponentFromRecord, type OpponentState } from '../arena/OpponentEditor.js';
import { isSummon } from '../../src/domain/units.js';
import { addUnit, firstFreeTile, missingPart, missingPhantimalPart, phantimalParts, withPartnerOn, withPhantimalPart, type PlacedPhantimal } from '../units.js';

/** The pictures of a Battle import that belong to one battle: the same two players, one fight each. */
export interface ImportGroup {
  key: string;
  mode: ArenaMode;
  pictures: (BattleImportPicture & { draft: BattleDraft })[];
}

/** What identifies a picture across restarts (a hash of it), to keep the player's edits with it; the id only when the server sent no key. */
export const pictureKey = (picture: { id: number; key?: string }): string => picture.key ?? String(picture.id);

const folded = (name: string | null) => (name ?? '').trim().toLowerCase();

/** The key a picture goes under when the player has not moved it: the mode and the two names, and for a mode of one fight a battle (Arena, Treasure Rush) the picture itself. */
function autoKey(picture: BattleImportPicture & { draft: BattleDraft }): string {
  const { draft } = picture;
  if (TEAMS_PER_MODE[draft.mode] === 1 || !draft.sideA.name || !draft.sideB.name) return `picture-${pictureKey(picture)}`;
  return `${draft.mode}|${folded(draft.sideA.name)}|${folded(draft.sideB.name)}`;
}

/** Groups the pictures that were read, in the order given; `moved` maps a picture's key to the key of the group the player put it in. */
export function groupPictures(pictures: BattleImportPicture[], moved: Record<string, string> = {}): ImportGroup[] {
  const groups = new Map<string, ImportGroup>();
  for (const picture of pictures) {
    if (picture.state !== 'done' || !picture.draft) continue;
    const readyPicture = picture as BattleImportPicture & { draft: BattleDraft };
    const key = moved[pictureKey(picture)] ?? autoKey(readyPicture);
    const group = groups.get(key) ?? { key, mode: readyPicture.draft.mode, pictures: [] };
    group.pictures.push(readyPicture);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.pictures.sort((a, b) => (a.draft.number ?? 99) - (b.draft.number ?? 99));
  return [...groups.values()];
}

/** Which fights of a battle the pictures of a group cover: how many it should have, the numbers nobody has, the ones two pictures have, and the pictures with none. */
export function fightCoverage(group: ImportGroup): { expected: number; missing: number[]; duplicated: number[]; unnumbered: number } {
  const expected = TEAMS_PER_MODE[group.mode];
  const counts = new Map<number, number>();
  let unnumbered = 0;
  for (const { draft } of group.pictures) {
    if (draft.number === null) unnumbered++;
    else counts.set(draft.number, (counts.get(draft.number) ?? 0) + 1);
  }
  return {
    expected,
    missing: Array.from({ length: expected }, (_, i) => i + 1).filter((n) => !counts.has(n)),
    duplicated: [...counts].filter(([, n]) => n > 1).map(([number]) => number).sort((a, b) => a - b),
    unnumbered,
  };
}

/** The parts a hero stands as: both parts of a pair on their own tiles, else the hero itself. Summons are not on a report. */
const partsOf = (hero: string): string[] => (PAIR_HEROES[hero] ? [...PAIR_HEROES[hero]] : [hero]);

/** The unit a side still has to have placed by hand after the heroes were placed: a part of a pair, a summon, or the phantimal the report showed. Null when the side is whole. */
export function unplacedUnit(placed: { tile: number; hero: string; part?: string }[], phantimal: PlacedPhantimal | null, shown: string | null | undefined): string | null {
  return missingPart(placed) ?? missingPhantimalPart(phantimal) ?? (shown && !phantimal ? shown : null);
}

/** The name a phantimal is kept under: a pair is kept under its first part, whichever part the report showed. */
const phantimalKey = (name: string): string => Object.entries(PAIR_PHANTIMALS).find(([, partner]) => partner === name)?.[0] ?? name;

/** The phantimal of a report on free tiles of a zone after the heroes (both parts of a pair, each on its own), or null when the report showed
 * none or the zone has no room for both parts: a Phantimal is never placed in part (ADR 0028). */
function placePhantimal(cells: number[], zone: number, taken: Set<number>, name: string | null | undefined): PlacedPhantimal | null {
  if (!name) return null;
  const wanted = withPhantimalPart(null, phantimalKey(name), 0);
  const parts = missingPhantimalPart(wanted) === null ? 1 : 2;
  const free = cells.filter((cell, tile) => cell === zone && !taken.has(tile)).length;
  if (free < parts) return null;
  const tile = firstFreeTile(cells, zone, (t) => taken.has(t));
  if (tile === null) return null;
  taken.add(tile);
  const placed = withPhantimalPart(null, phantimalKey(name), tile);
  const partner = missingPhantimalPart(placed) === null ? null : firstFreeTile(cells, zone, (t) => taken.has(t));
  if (partner !== null) taken.add(partner);
  return partner === null && missingPhantimalPart(placed) !== null ? null : withPartnerOn(placed, partner);
}

/** The artifact fields of the form: its name, and its level when the report gave one. */
const artifactFields = (artifact: BattleDraftSide['artifact']) => (artifact?.name ? { artifact: artifact.name } : null);

/** One side of a saved fight, as the record keeps it (the formation of Side A or the opponent of Side B). */
export type SavedSide = Omit<ArenaBattle['opponent'], 'formationId' | 'phantimal'> & { phantimal?: ArenaBattle['opponent']['phantimal'] };

/** A saved side with the whole board turned upside down (tile `i` becomes `TILE_COUNT - 1 - i`), as it would stand on the other side of the map. */
function turnedOver(saved: SavedSide): SavedSide {
  const turn = (tile: number) => TILE_COUNT - 1 - tile;
  return {
    ...saved,
    heroes: saved.heroes.map((h) => ({ ...h, tile: turn(h.tile) })),
    phantimal: saved.phantimal ? { ...saved.phantimal, tile: turn(saved.phantimal.tile), ...(saved.phantimal.partnerTile != null ? { partnerTile: turn(saved.phantimal.partnerTile) } : {}) } : saved.phantimal,
  };
}

/**
 * The saved sides that a side of a picture can stand like, latest first: the fights of the same mode and team number in which the same
 * Player (by Player ID) stood on this side, as saved, or on the other side, turned upside down. It tells which teams the Player is known
 * to field, for `correctHeroes`; where a team stood is the resolver's question (`reusedSide`).
 */
export function savedSides(fights: ArenaBattle[], mode: ArenaMode, position: number, side: 'A' | 'B', playerId: string | null | undefined, mapName?: string | null): SavedSide[] {
  if (!playerId) return [];
  const who = playerId.toLowerCase();
  const stoodOn = (f: ArenaBattle, s: 'A' | 'B') => (s === 'A' ? f.playerIdA : f.playerIdB)?.toLowerCase() === who;
  const other = side === 'A' ? 'B' : 'A';
  const sideOf = (f: ArenaBattle, s: 'A' | 'B'): SavedSide => (s === 'A' ? f.formation : f.opponent);
  return fights
    .filter((f) => f.mode === mode && (TEAMS_PER_MODE[mode] === 1 || f.battlePosition === position) && sameMap(f, mapName))
    .sort((a, b) => b.id - a.id)
    .flatMap((f) => [...(stoodOn(f, side) ? [sideOf(f, side)] : []), ...(stoodOn(f, other) ? [turnedOver(sideOf(f, other))] : [])]);
}

/** A record is about the same Map as the one being placed on; without a Map to compare, any record counts. */
const sameMap = (fight: ArenaBattle, mapName: string | null | undefined): boolean => mapName === undefined || mapName === null || fight.mapName === mapName;

/** The most heroes of a team a Battle import replaces (ADR 0013). */
const MAX_CORRECTED_HEROES = 2;

const heroNames = (side: SavedSide) => [...new Set(side.heroes.filter((h) => !isSummon({ hero: h.name, part: h.part })).map((h) => h.name))].sort();

/** A team the Player is known to field, as hero names: where it was seen is only for the note. */
export interface KnownTeam {
  heroes: string[];
  from: string;
}

/** The teams of the saved sides, for `correctHeroes`. */
export const knownTeams = (sides: SavedSide[], from: string): KnownTeam[] => sides.map((side) => ({ heroes: heroNames(side), from }));

/**
 * A side of a picture with its misread heroes replaced by those of the closest team the Player is known to field (ADR 0013), or null when
 * the picture is to be kept as read. A hero no reader could name is filled in from a team that has all the others. A hero that was named
 * but differs is replaced only when two known teams agree on the same heroes, so that a formation the Player really changed is kept.
 * At most `MAX_CORRECTED_HEROES` change, the closest team must be alone at its distance, and a team that is exactly the picture's needs no correction.
 */
export function correctHeroes(side: BattleDraftSide, known: KnownTeam[]): { heroes: BattleDraftSide['heroes']; unread: string[]; corrected: { from: string | null; to: string }[]; because: string } | null {
  const read = [...new Set(side.heroes.map((h) => h.hero))].sort();
  const unread = side.unread ?? [];
  if (read.length === 0 || known.length === 0) return null;
  const scored = known
    .map((team) => ({ team, extra: read.filter((h) => !team.heroes.includes(h)), missing: team.heroes.filter((h) => !read.includes(h)) }))
    // the picture has as many tiles as the team: what it lacks is what it could not name, plus what it named wrongly
    .filter(({ team, extra, missing }) => team.heroes.length === read.length + unread.length && missing.length === extra.length + unread.length && extra.length + unread.length <= MAX_CORRECTED_HEROES);
  if (scored.length === 0) return null;
  const distance = ({ extra, missing }: (typeof scored)[number]) => extra.length + missing.length;
  const best = Math.min(...scored.map(distance));
  if (best === 0) return null;
  const closest = scored.filter((c) => distance(c) === best);
  const sets = new Set(closest.map((c) => c.team.heroes.join('|')));
  if (sets.size !== 1) return null;
  const chosen = closest[0]!;
  const support = known.filter((t) => t.heroes.join('|') === chosen.team.heroes.join('|')).length;
  if (chosen.extra.length > 0 && support < 2) return null;
  const replaced = new Map(chosen.extra.map((hero, i) => [hero, chosen.missing[i]!]));
  const added = chosen.missing.slice(chosen.extra.length);
  const heroes = side.heroes.map((h) => (replaced.has(h.hero) ? { tile: h.tile, hero: replaced.get(h.hero)!, rank: null, equipmentLevel: null } : h));
  for (const hero of added) heroes.push({ tile: '', hero, rank: null, equipmentLevel: null });
  return {
    heroes,
    unread: [],
    corrected: [...chosen.extra.map((from) => ({ from, to: replaced.get(from)! })), ...added.map((to) => ({ from: null, to }))],
    because: chosen.team.from,
  };
}

/**
 * The saved sides of the same mode and team number as placements for the resolver (ADR 0030), each as it would stand on `side`'s zone:
 * a side of the fight that stood there as saved, the other turned upside down. Every Player's sides are listed, with the Player behind
 * each; the resolver prefers the Player's own and then the newest.
 */
export function savedPlacements(fights: ArenaBattle[], mode: ArenaMode, position: number, side: 'A' | 'B'): SavedPlacement<SavedSide>[] {
  const other = side === 'A' ? 'B' : 'A';
  const sideOf = (f: ArenaBattle, s: 'A' | 'B'): SavedSide => (s === 'A' ? f.formation : f.opponent);
  const placement = (f: ArenaBattle, s: 'A' | 'B', saved: SavedSide): SavedPlacement<SavedSide> => ({
    attemptId: f.id,
    mapName: f.mapName ?? null,
    playerId: s === 'A' ? f.playerIdA : f.playerIdB,
    units: layoutFrom({ heroes: saved.heroes.map((h) => ({ tile: h.tile, hero: h.name, part: h.part })), phantimal: saved.phantimal }).units,
    artifact: saved.artifact ?? null,
    source: saved,
  });
  return fights
    .filter((f) => f.mode === mode && (TEAMS_PER_MODE[mode] === 1 || f.battlePosition === position))
    .flatMap((f) => [placement(f, side, sideOf(f, side)), placement(f, other, turnedOver(sideOf(f, other)))]);
}

/** What the resolver is asked for a picture's side: its heroes, the map and zone, and the Player behind it. A phantimal the picture shows must be the saved one too. */
function targetOf(heroes: BattleDraftSide['heroes'], cells: number[], zone: number, mapName: string | null | undefined, playerId: string | null | undefined): PlacementTarget {
  return { mapName: mapName ?? null, cells, zone, heroes: [...new Set(heroes.map((h) => h.hero))], playerId: playerId ?? null };
}

/** The placements that show the phantimal the picture shows (a pair is the same whichever part it names); a picture with none accepts any. */
const withPhantimal = (placements: SavedPlacement<SavedSide>[], extras: Pick<BattleDraftSide, 'artifact' | 'phantimal'>) =>
  extras.phantimal ? placements.filter((p) => p.source?.phantimal != null && phantimalKey(extras.phantimal!) === phantimalKey(p.source.phantimal.name)) : placements;

/**
 * The saved side that says where the picture's team stood (the resolver's tiers `profile`, then `any`, ADR 0030), or null when the team
 * was never placed on this map by a record that fits, or when no Player ID says whose team it is.
 */
export function reusedSide(placements: SavedPlacement<SavedSide>[], heroes: BattleDraftSide['heroes'], extras: Pick<BattleDraftSide, 'artifact' | 'phantimal'>, cells: number[], zone: number, mapName: string | null | undefined, playerId: string | null | undefined): SavedSide | null {
  return resolveSavedPlacement(targetOf(heroes, cells, zone, mapName, playerId), withPhantimal(placements, extras)).source;
}

/** True when the picture's team was placed on this map before, by a Player whose team it could be, but no saved placement of it fits the map. */
export const misfitsMap = (placements: SavedPlacement<SavedSide>[], heroes: BattleDraftSide['heroes'], extras: Pick<BattleDraftSide, 'artifact' | 'phantimal'>, cells: number[], zone: number, mapName: string | null | undefined, playerId: string | null | undefined): boolean =>
  !!playerId && reusedSide(placements, heroes, extras, cells, zone, mapName, playerId) === null && knewHomelessPlacement(targetOf(heroes, cells, zone, mapName, playerId), withPhantimal(placements, extras));

const unitsKey = (placed: { tile: number; hero: string; part?: string }[], phantimal: PlacedPhantimal | null, artifact: string) =>
  JSON.stringify([placed.map((p) => [p.hero, p.part ?? '', p.tile]).sort(), phantimal ? [phantimal.name, phantimal.tile, phantimal.partnerTile ?? null] : null, artifact]);

/** What differs between the two sides when a saved placement is looked for: the letter and zone, how the heroes read off the form, and how the side is placed. */
export interface PlacedSide<S extends { placed: { tile: number; hero: string; part?: string }[]; phantimal: PlacedPhantimal | null; artifact: string }> {
  letter: 'A' | 'B';
  zone: number;
  heroesOf: (current: S, hero: string) => Omit<BattleDraftSide['heroes'][number], 'tile'>;
  place: (cells: number[], heroes: BattleDraftSide['heroes'], extras: Pick<BattleDraftSide, 'artifact' | 'phantimal'>, saved: SavedSide) => S;
}

/**
 * The side with the placement (tiles, artifact, phantimal) of a saved side that has exactly its heroes, or null when none has or the saved
 * one is where the heroes already stand. The Player's own saved sides come first, then other Players'; ranks and equipment stay.
 */
function knownPlacement<S extends { placed: { tile: number; hero: string; part?: string }[]; phantimal: PlacedPhantimal | null; artifact: string }>(
  kind: PlacedSide<S>,
  fights: ArenaBattle[],
  mode: ArenaMode,
  position: number,
  playerId: string | null | undefined,
  current: S,
  cells: number[],
  mapName?: string | null,
): S | null {
  const heroes = [...new Set(current.placed.filter((p) => !isSummon({ hero: p.hero, part: p.part })).map((p) => p.hero))].map((hero) => ({ tile: '', ...kind.heroesOf(current, hero) }));
  if (heroes.length === 0) return null;
  const extras = { artifact: null, phantimal: current.phantimal?.name ?? null };
  const found = reusedSide(savedPlacements(fights, mode, position, kind.letter), heroes, extras, cells, kind.zone, mapName, playerId);
  if (!found) return null;
  const next = kind.place(cells, heroes, extras, found);
  return unitsKey(next.placed, next.phantimal, next.artifact) === unitsKey(current.placed, current.phantimal, current.artifact) ? null : next;
}

export const OWN_SIDE: PlacedSide<FormationState> = {
  letter: 'A',
  zone: TILE.PLAYER,
  heroesOf: (current, hero) => ({ hero, rank: current.snapshots[hero]?.rank ?? null, equipmentLevel: current.snapshots[hero]?.equipmentLevel ?? null }),
  place: placeOwn,
};

export const OPPONENT_SIDE: PlacedSide<OpponentState> = {
  letter: 'B',
  zone: TILE.ENEMY,
  heroesOf: (current, hero) => {
    const placed = current.placed.find((p) => p.hero === hero)!;
    return { hero, rank: placed.rank === '' ? null : placed.rank, equipmentLevel: placed.equipment === '' ? null : Number(placed.equipment) };
  },
  place: placeOpponent,
};

/** Your side with the placement of a saved side that has exactly its heroes (see `knownPlacement`). */
export const knownPlacementOwn = (fights: ArenaBattle[], mode: ArenaMode, position: number, playerId: string | null | undefined, current: FormationState, cells: number[], mapName?: string | null): FormationState | null =>
  knownPlacement(OWN_SIDE, fights, mode, position, playerId, current, cells, mapName);

/** The other side likewise. */
export const knownPlacementOpponent = (fights: ArenaBattle[], mode: ArenaMode, position: number, playerId: string | null | undefined, current: OpponentState, cells: number[], mapName?: string | null): OpponentState | null =>
  knownPlacement(OPPONENT_SIDE, fights, mode, position, playerId, current, cells, mapName);

/** The artifact the picture showed over the saved one. */
const artifactOver = (saved: SavedSide, artifact: BattleDraftSide['artifact']) =>
  artifact?.name ? { artifact: artifact.name } : { artifact: saved.artifact ?? '' };

/** Your side as it stood in the saved fight, with the ranks and equipment the picture was sure of over the saved ones. Only a Phantimal the
 * picture showed is kept: a report with none means the team brought none (ADR 0029). */
function reusedOwn(saved: SavedSide, heroes: BattleDraftSide['heroes'], extras: Pick<BattleDraftSide, 'artifact' | 'phantimal'>): FormationState {
  const phantimal = extras.phantimal ? (saved.phantimal ?? null) : null;
  let formation: FormationState = { ...formationFromRecord({ ...saved, phantimal, formationId: null }), formationId: '', ...artifactOver(saved, extras.artifact) };
  for (const { hero, rank, equipmentLevel } of heroes) if (rank !== null) formation = withHeroState(formation, hero, rank, equipmentLevel === null ? '' : String(equipmentLevel));
  return formation;
}

/** The other side as it stood in the saved fight, likewise. */
function reusedOpponent(saved: SavedSide, heroes: BattleDraftSide['heroes'], extras: Pick<BattleDraftSide, 'artifact' | 'phantimal'>): OpponentState {
  const phantimal = extras.phantimal ? (saved.phantimal ?? null) : null;
  const opponent = opponentFromRecord({ ...saved, phantimal, formationId: null });
  const states = new Map(heroes.filter((h) => h.rank !== null).map((h) => [h.hero, h]));
  return {
    ...opponent,
    placed: opponent.placed.map((p) => {
      const read = states.get(p.hero);
      return read ? { ...p, rank: read.rank!, equipment: read.equipmentLevel === null ? '' : String(read.equipmentLevel) } : p;
    }),
    ...artifactOver(saved, extras.artifact),
  };
}

/**
 * Lays the heroes of a report on the first free tiles of a zone, in the order of the picture, then the summons of the heroes (Zanie's
 * turrets, Phraesto's clone), which stand on tiles of their own though no report shows them. `put` adds one unit to the side and says
 * whether it did: a hero listed twice is refused, as in every PvP side, and does not use up a tile. The phantimal is placed between the
 * heroes and the summons, by `phantimalAt`, which is given the tiles taken and returns it.
 */
function layOut(
  cells: number[],
  zone: number,
  heroes: BattleDraftSide['heroes'],
  put: (unit: string, tile: number, hero: BattleDraftSide['heroes'][number] | null) => boolean,
  phantimalAt: (taken: Set<number>) => PlacedPhantimal | null,
): PlacedPhantimal | null {
  const taken = new Set<number>();
  for (const read of heroes) {
    for (const part of partsOf(read.hero)) {
      const tile = firstFreeTile(cells, zone, (t) => taken.has(t));
      if (tile === null) break;
      if (put(part, tile, read)) taken.add(tile);
    }
  }
  const phantimal = phantimalAt(taken);
  for (const hero of new Set(heroes.map((h) => h.hero))) {
    const summon = SUMMONS[hero];
    for (let i = 0; summon && i < summon.count; i++) {
      const tile = firstFreeTile(cells, zone, (t) => taken.has(t));
      if (tile === null || !put(summon.part, tile, null)) break;
      taken.add(tile);
    }
  }
  return phantimal;
}

/** Your side's heroes on the first free tiles of the player's zone, in the order of the picture, with the states the picture was sure of; then its phantimal and artifact when the report showed them. */
export function placeOwn(cells: number[], heroes: BattleDraftSide['heroes'], extras: Pick<BattleDraftSide, 'artifact' | 'phantimal'> = { artifact: null, phantimal: null }, saved: SavedSide | null = null): FormationState {
  if (saved) return reusedOwn(saved, heroes, extras);
  let formation = emptyFormation();
  const phantimal = layOut(
    cells,
    TILE.PLAYER,
    heroes,
    (unit, tile, read) => {
      if (read && read.rank !== null) formation = withHeroState(formation, read.hero, read.rank, read.equipmentLevel === null ? '' : String(read.equipmentLevel));
      const result = placeHero(formation, unit, tile);
      if (result.value === formation) return false;
      formation = result.value;
      return true;
    },
    (taken) => placePhantimal(cells, TILE.PLAYER, taken, extras.phantimal),
  );
  return { ...formation, phantimal, ...artifactFields(extras.artifact) };
}

/** The other side's heroes on the first free tiles of the enemy zone, likewise. */
export function placeOpponent(cells: number[], heroes: BattleDraftSide['heroes'], extras: Pick<BattleDraftSide, 'artifact' | 'phantimal'> = { artifact: null, phantimal: null }, saved: SavedSide | null = null): OpponentState {
  if (saved) return reusedOpponent(saved, heroes, extras);
  let placed = emptyOpponent().placed;
  const phantimal = layOut(
    cells,
    TILE.ENEMY,
    heroes,
    (unit, tile, read) => {
      const rank = read?.rank ?? '';
      const equipment = read?.equipmentLevel == null ? '' : String(read.equipmentLevel);
      const result = addUnit(placed, unit, tile, (row) => ({ ...row, rank, equipment }));
      if (result.placed === placed) return false;
      placed = result.placed;
      return true;
    },
    (taken) => placePhantimal(cells, TILE.ENEMY, taken, extras.phantimal),
  );
  return { ...emptyOpponent(), placed, phantimal, ...artifactFields(extras.artifact) };
}

const asDataUrl = (blob: Blob) =>
  new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });

/** The crops of the artifact and phantimal of each side of a picture, while the server still has the picture. A crop that cannot be fetched is left out. */
export async function fetchCrops(picture: BattleImportPicture & { draft: BattleDraft }): Promise<NonNullable<BattleImportPicture['cropData']>> {
  const one = async (key: string | undefined, frame = false) => {
    if (!key) return null;
    try {
      const response = await fetch(urlOf(rosterImportContract.tile, { params: { id: String(picture.id), key }, query: frame ? { frame: 'top' } : {} }));
      return response.ok ? await asDataUrl(await response.blob()) : null;
    } catch {
      return null;
    }
  };
  const side = async (s: BattleDraftSide) => {
    // the tile of each hero as the readers learn it, to teach them if the player corrects the reading
    // and, for a hero the Agent was not sure of or a tile it only guessed at, what else it might be: the readings left unpaired wait for the player to confirm
    const tiles: NonNullable<ImportFeedbackSide['crops']['tiles']> = [];
    const named = s.heroes.map((h) => ({ hero: h.hero as string | null, key: h.tile, ...(h.unsure ? { unsure: true, candidates: h.candidates ?? [] } : {}) }));
    const unread = (s.unread ?? []).map((key) => ({ hero: null, key, ...(s.unreadCandidates?.[key] ? { candidates: s.unreadCandidates[key] } : {}) }));
    for (const { key, ...tile } of [...named, ...unread]) {
      const png = await one(key, true);
      if (png) tiles.push({ ...tile, png });
    }
    return { artifact: await one(s.crops?.artifact), phantimal: await one(s.crops?.phantimal), tiles };
  };
  return { A: await side(picture.draft.sideA), B: await side(picture.draft.sideB) };
}

/** The picture as the player gave it, as a data URL, while the server still has it; null when it cannot be fetched. */
export async function fetchOriginal(picture: BattleImportPicture): Promise<string | null> {
  try {
    const response = await fetch(urlOf(rosterImportContract.picture, { params: { id: String(picture.id) } }));
    return response.ok ? await asDataUrl(await response.blob()) : null;
  } catch {
    return null;
  }
}

/** What a picture's reading said of a side, in the form the feedback takes. */
export const readingOf = (side: BattleDraftSide): ImportReading => ({
  heroes: side.heroes.map((h) => ({ hero: h.hero, rank: h.rank, equipmentLevel: h.equipmentLevel })),
  artifact: side.artifact?.name ? { name: side.artifact.name, level: null } : null,
  phantimal: side.phantimal ?? null,
});


/** The heroes of a team as they stand in the form, once each: both parts of a pair stand on their own tiles. */
const once = (names: string[]) => [...new Set(names)];

/** A side as the form holds it. A phantimal pair is told by its first part, which a reading may have given as the other part. */
function kept<S extends { placed: { tile: number; hero: string; part?: string }[]; phantimal: PlacedPhantimal | null; artifact: string }>(side: PlacedSide<S>, state: S, read: ImportReading): ImportReading {
  return {
    heroes: once(state.placed.map((p) => p.hero)).map((hero) => side.heroesOf(state, hero)),
    artifact: state.artifact ? { name: state.artifact, level: null } : null,
    phantimal: keptPhantimal(state.phantimal, read.phantimal),
  };
}

/** Your side as the form holds it. */
export const keptOwn = (formation: FormationState, read: ImportReading): ImportReading => kept(OWN_SIDE, formation, read);

/** The other side as the form holds it. */
const keptOpponent = (opponent: OpponentState, read: ImportReading): ImportReading => kept(OPPONENT_SIDE, opponent, read);

function keptPhantimal(placed: PlacedPhantimal | null, read: string | null): string | null {
  if (!placed) return null;
  return read !== null && phantimalParts(placed).some((part) => part.name === read) ? read : placed.name;
}

/** A kept side without the heroes the import corrected itself: the readers learn only from what the player chose (ADR 0013). */
const withoutCorrected = (kept: ImportReading, corrected: string[] = []): ImportReading => ({ ...kept, heroes: kept.heroes.filter((h) => !corrected.includes(h.hero)) });

/** The feedback for the teams that were read from pictures: each side's reading and crops with what the player kept. */
export function feedbackOf(drafts: { imported?: ImportedTeam; formation: FormationState; opponent: OpponentState }[], rosters: Record<'A' | 'B', Hero[] | null> = { A: null, B: null }): ImportFeedbackSide[] {
  // A rank the form holds that is the roster's own may be what choosing a profile filled in, so it is not taken as a correction.
  const side = (read: ImportReading, final: ImportReading, crops: ImportFeedbackSide['crops'], roster: Hero[] | null): ImportFeedbackSide => ({
    read,
    final,
    crops,
    skipRank: final.heroes.filter((h) => h.rank !== null && roster?.find((r) => r.name === h.hero)?.rank === h.rank).map((h) => h.hero),
  });
  return drafts.flatMap((d) =>
    d.imported
      ? [
          { ...side(d.imported.A.read, withoutCorrected(keptOwn(d.formation, d.imported.A.read), d.imported.A.corrected), d.imported.A.crops, rosters.A), side: 'A' as const },
          { ...side(d.imported.B.read, withoutCorrected(keptOpponent(d.opponent, d.imported.B.read), d.imported.B.corrected), d.imported.B.crops, rosters.B), side: 'B' as const },
        ]
      : [],
  );
}

/** What was read of the two sides of one fight, kept on its team in the form until the records are saved. */
export interface ImportedTeam {
  A: { read: ImportReading; crops: ImportFeedbackSide['crops']; /** The heroes the import replaced from a known team: they teach the readers nothing. */ corrected?: string[] };
  B: { read: ImportReading; crops: ImportFeedbackSide['crops']; corrected?: string[] };
  /** The picture the fight was read from, to keep with the record once saved (ADR 0016). */
  picture?: { label: string | null; data: string } | null;
}
