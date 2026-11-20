export const STAGE_KINDS = ['Normal', 'Phantisomal', 'Apex Normal', 'Apex Phantisomal'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

const MAX_STANDARD_STAGE = 2700;
const MAX_APEX_STAGE = 1000;
export const PHASES = [1, 2, 3];

export const isApex = (kind: StageKind) => kind === 'Apex Normal' || kind === 'Apex Phantisomal';
export const allowsPhantimal = (kind: StageKind) => kind === 'Phantisomal' || kind === 'Apex Phantisomal';

export interface StageKeyInput {
  season: unknown;
  phase: unknown;
  kind: unknown;
  number: unknown;
}

/** Returns an error message, or null when the stage identity is valid. */
export function validateStageKey(input: StageKeyInput): string | null {
  if (!Number.isInteger(input.season) || (input.season as number) < 1) return 'Season must be a whole number from 1';
  if (!STAGE_KINDS.includes(input.kind as StageKind)) return `Stage kind must be one of: ${STAGE_KINDS.join(', ')}`;
  const kind = input.kind as StageKind;
  if (isApex(kind)) {
    if (!PHASES.includes(input.phase as number)) return 'An Apex stage needs a phase from 1 to 3';
  } else if (input.phase !== 0) {
    return 'Normal and Phantisomal stages have no phase';
  }
  const max = isApex(kind) ? MAX_APEX_STAGE : MAX_STANDARD_STAGE;
  if (!Number.isInteger(input.number) || (input.number as number) < 1 || (input.number as number) > max) {
    return `${kind} stage numbers go from 1 to ${max}`;
  }
  return null;
}

/** An entry of a stage's Stage Enemies: an enemy or a hero, with how many of it stand there. Exactly one of the two names is set. */
interface StageEnemyEntry {
  enemy?: string | null;
  hero?: string | null;
  count: number;
}

/** The most of one enemy a stage may hold. */
const MAX_ENEMY_COUNT = 99;

/** Returns an error message, or null when every entry names a known enemy or hero once, with a count from 1. The same one may stand several times through its count. */
export function validateStageEnemies(entries: unknown, knownEnemies: Set<string>, knownHeroes: Set<string> = new Set()): string | null {
  if (!Array.isArray(entries)) return 'Enemies must be a list';
  const seen = new Set<string>();
  for (const e of entries as StageEnemyEntry[]) {
    const enemy = e?.enemy ?? null;
    const hero = e?.hero ?? null;
    const name = enemy ?? hero;
    if (!e || (enemy === null) === (hero === null) || typeof name !== 'string' || name === '') return 'Each enemy needs either an enemy name or a hero name';
    if (!Number.isInteger(e.count) || e.count < 1 || e.count > MAX_ENEMY_COUNT) return `${name}: the count must be a whole number from 1 to ${MAX_ENEMY_COUNT}`;
    if (enemy !== null && !knownEnemies.has(enemy)) return `Unknown enemy "${enemy}"`;
    if (hero !== null && !knownHeroes.has(hero)) return `Unknown hero "${hero}"`;
    const key = `${enemy !== null ? 'enemy' : 'hero'}:${name}`;
    if (seen.has(key)) return `${name} is listed twice: give it a count instead`;
    seen.add(key);
  }
  return null;
}

/** The artifact group that is usable in every season. */
export const PRE_SEASON_GROUP = 'Pre-Season';

/** The artifacts a stage of this season can use: the pre-season ones and that season's own. */
export function artifactsForSeason<T extends { group: string }>(artifacts: T[], season: number): T[] {
  return artifacts.filter((a) => a.group === PRE_SEASON_GROUP || a.group === `Season ${season}`);
}

/** The artifacts to offer for a season, plus any already chosen (so an old record still shows its own). */
export function selectableArtifacts<T extends { name: string; group: string }>(artifacts: T[], season: number, chosen: string[] = []): T[] {
  const usable = new Set(artifactsForSeason(artifacts, season));
  return artifacts.filter((a) => usable.has(a) || chosen.includes(a.name));
}
