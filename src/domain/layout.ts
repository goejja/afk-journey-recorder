import { TILE_COUNT } from './map.js';
import { PAIR_PHANTIMALS, checkPhantimalPartner, checkUnits, partOf } from './units.js';

/**
 * What a Unit is: the hero itself or one of its parts, a Summon, or part of the Phantimal (ADR 0028). A hero and a
 * Phantimal may share a name, so the kind keeps them apart.
 */
export type UnitKind = 'hero' | 'phantimal';

/** One Unit on one tile. `part` is '' for a lone hero or a one-part Phantimal. */
export interface LayoutUnit {
  kind: UnitKind;
  hero: string;
  part: string;
  tile: number;
}

/**
 * Which Units stand on which tiles, the Phantimal's included. Rank, equipment and artifact are not part of it, so two
 * formations with the same Units on the same tiles have the same Layout (see the glossary).
 */
export interface Layout {
  units: LayoutUnit[];
}

/** A formation as the forms and the API carry it; only what a Layout needs is read. */
export interface PlacedFormation {
  heroes?: { tile: number; hero: string; part?: string | null }[];
  phantimal?: { name: string; tile: number; partnerTile?: number | null } | null;
}

/** The Units of a Phantimal payload: its first tile, and its partner's tile when it has one. */
const phantimalUnits = (phantimal: NonNullable<PlacedFormation['phantimal']>): LayoutUnit[] => [
  { kind: 'phantimal', hero: phantimal.name, part: '', tile: phantimal.tile },
  ...(phantimal.partnerTile != null
    ? [{ kind: 'phantimal' as const, hero: phantimal.name, part: PAIR_PHANTIMALS[phantimal.name] ?? '', tile: phantimal.partnerTile }]
    : []),
];

/** The Layout of a formation payload: its Units, with the Phantimal folded in like any other Unit. */
export function layoutFrom(formation: PlacedFormation): Layout {
  return {
    units: [
      ...(formation.heroes ?? []).map((h) => ({ kind: 'hero' as const, hero: h.hero, part: partOf(h), tile: h.tile })),
      ...(formation.phantimal ? phantimalUnits(formation.phantimal) : []),
    ],
  };
}

/** A text that is the same for the same Layout, whatever the order the Units were placed in. */
export function layoutKey(layout: Layout): string {
  return layout.units
    .map((u) => `${u.tile}|${u.kind}|${u.hero}|${u.part}`)
    .sort()
    .join(';');
}

const turn = (tile: number) => TILE_COUNT - 1 - tile;

/**
 * The same deployment seen from the other half of the board. The rows of a map are as long forwards as backwards, so
 * turning the board by half a turn sends tile i to tile 44 - i.
 */
export function rotateLayout(layout: Layout): Layout {
  return { units: layout.units.map((u) => ({ ...u, tile: turn(u.tile) })) };
}

export type LayoutMatch = 'same' | 'rotated';

/** How `placed` matches `stored`: as it is, turned upside down, or not at all. */
export function compareLayouts(stored: Layout, placed: Layout): LayoutMatch | null {
  const key = layoutKey(stored);
  if (layoutKey(placed) === key) return 'same';
  if (layoutKey(rotateLayout(placed)) === key) return 'rotated';
  return null;
}

/** One team of a Deployment: its Layout and the Artifact it carries (null when none is known). */
export interface DeploymentTeam extends Layout {
  artifact: string | null;
}

/**
 * What a Formation ID stands for (see the glossary): the numbered teams of a record, team 1 first. A team that is not
 * known (a battle recorded with only some of its fights) is null, so the numbers stay those of the battle.
 */
export interface Deployment {
  teams: (DeploymentTeam | null)[];
}

/** A team as the forms and the API carry it, with the artifact. */
interface PlacedTeam extends PlacedFormation {
  artifact?: string | null;
}

/** The Deployment of the teams given, in order; a missing team is null. */
export function deploymentFrom(teams: (PlacedTeam | null | undefined)[]): Deployment {
  return { teams: teams.map((t) => (t ? { ...layoutFrom(t), artifact: t.artifact ?? null } : null)) };
}

/** True when no team of the Deployment has a Unit: there is nothing to match on. */
export const isEmptyDeployment = (d: Deployment): boolean => d.teams.every((t) => !t || t.units.length === 0);

/** The Phantimal a team fields, read from its Units, or null: its name (the pair's key) and the tile of each part. */
export function phantimalOf(team: Layout): { name: string; tiles: number[] } | null {
  const units = team.units.filter((u) => u.kind === 'phantimal');
  if (units.length === 0) return null;
  return { name: units.find((u) => u.part === '')?.hero ?? units[0]!.hero, tiles: units.map((u) => u.tile) };
}

/** The Deployment seen from the other half of the board: every team turned. */
export const rotateDeployment = (d: Deployment): Deployment => ({ teams: d.teams.map((t) => (t ? { ...rotateLayout(t), artifact: t.artifact } : null)) });

const hasUnits = (t: Layout) => t.units.length > 0;

/**
 * How `placed` matches `stored`, team by team (team k only with team k). Teams without a unit are not compared. Every
 * compared team must match in the same way, as stored or all turned together. A team the stored Deployment lacks counts
 * as a match when `allowNewTeams` (declaring a code that adds teams) and as a mismatch otherwise (looking for codes).
 * Artifacts are not compared here, see deploymentArtifactClash.
 */
export function compareDeployments(stored: Deployment, placed: Deployment, allowNewTeams = false): LayoutMatch | null {
  const matches = new Set<LayoutMatch>();
  for (const [k, team] of placed.teams.entries()) {
    if (!team || !hasUnits(team)) continue;
    const there = stored.teams[k];
    if (!there) {
      if (allowNewTeams) continue;
      return null;
    }
    const match = compareLayouts(there, team);
    if (match === null) return null;
    // A symmetric team matches both ways, so it does not decide the orientation.
    const turned = compareLayouts(there, rotateLayout(team));
    if (match === 'same' && turned === 'same') continue;
    matches.add(match);
  }
  if (matches.size > 1) return null;
  return matches.has('rotated') ? 'rotated' : 'same';
}

/** The first team whose Artifact differs from the stored one, as a 1-based team number, or null. A missing Artifact never clashes. */
export function deploymentArtifactClash(stored: Deployment, placed: Deployment): { team: number; stored: string; placed: string } | null {
  for (const [k, team] of placed.teams.entries()) {
    const there = stored.teams[k];
    if (team?.artifact && there?.artifact && team.artifact !== there.artifact) return { team: k + 1, stored: there.artifact, placed: team.artifact };
  }
  return null;
}

/**
 * The stored Deployment with what `placed` adds: teams and Artifacts it had none of. `placed` is turned first when it was
 * seen from the other half, so the stored Deployment keeps its first orientation. Call it after compareDeployments said it matches.
 */
export function extendDeployment(stored: Deployment, placed: Deployment): Deployment {
  const match = compareDeployments(stored, placed, true);
  const seen = match === 'rotated' ? rotateDeployment(placed) : placed;
  const length = Math.max(stored.teams.length, seen.teams.length);
  const teams = Array.from({ length }, (_, k): DeploymentTeam | null => {
    const had = stored.teams[k] ?? null;
    const added = seen.teams[k] ?? null;
    if (!had) return added && hasUnits(added) ? added : null;
    return had.artifact || !added?.artifact ? had : { ...had, artifact: added.artifact };
  });
  return { teams };
}

/** Says why a Deployment typed in by hand cannot be one, or null: it has a team with units, and every team is a valid Layout. */
export function deploymentProblem(d: Deployment): string | null {
  if (isEmptyDeployment(d)) return 'Place at least one unit';
  for (const [k, team] of d.teams.entries()) {
    if (!team) continue;
    const error = layoutProblem(team);
    if (error) return d.teams.length > 1 ? `Team ${k + 1}: ${error}` : error;
  }
  return null;
}

/** A Formation ID is 8 characters, digits or upper-case letters. */
export const isFormationId = (value: string): boolean => /^[0-9A-Z]{8}$/.test(value);

/** What the player typed, without the spaces around it and in upper case. Check the result with isFormationId. */
export const normalizeFormationId = (value: string): string => value.trim().toUpperCase();

/**
 * Returns an error message when a Layout typed in by hand cannot be a deployment, else null: the Units follow the rules
 * of units (pairs whole, every summon placed), every tile is on the board, and no two Units share a tile.
 */
function layoutProblem(layout: Layout): string | null {
  const used = new Set<number>();
  const take = (tile: unknown, label: string): string | null => {
    if (!Number.isInteger(tile) || (tile as number) < 0 || (tile as number) >= TILE_COUNT) return `${label} is not on the board`;
    if (used.has(tile as number)) return `Two units stand on tile ${tile}`;
    used.add(tile as number);
    return null;
  };
  for (const u of layout.units) {
    if (u?.kind !== 'hero' && u?.kind !== 'phantimal') return 'Every unit is a hero or a phantimal';
    if (typeof u.hero !== 'string' || u.hero === '') return 'Every unit needs a hero';
    const error = take(u.tile, u.part ? `${u.hero} (${u.part})` : u.hero);
    if (error) return error;
  }
  const unitsError = checkUnits(layout.units.filter((u) => u.kind === 'hero'));
  if (unitsError) return unitsError;
  const byPhantimal = new Map<string, LayoutUnit[]>();
  for (const u of layout.units.filter((u) => u.kind === 'phantimal')) byPhantimal.set(u.hero, [...(byPhantimal.get(u.hero) ?? []), u]);
  for (const [name, own] of byPhantimal) {
    if (own.length > 2) return `${name} stands on at most two tiles`;
    const main = own.find((u) => u.part === '') ?? own[0]!;
    const partner = own.find((u) => u !== main);
    if (partner && PAIR_PHANTIMALS[name] !== partner.part) return `${name} has no ${partner.part}`;
    // The tiles are already taken above; this checks the pair rule itself.
    const rule = checkPhantimalPartner({ name, partnerTile: partner?.tile ?? null }, () => null);
    if (rule) return rule;
  }
  return null;
}
