import { z } from 'zod';
import { problemWith } from './schema.js';

/** The three phases of a Titan Reaver event, in the order the game runs them. Not the Season's Phases, which Stages use. */
export const TITAN_PHASES = ['Charge', 'Clash', 'Conquer'] as const;
export type TitanPhase = (typeof TITAN_PHASES)[number];

/** Each Titan Reaver Phase has two bosses, one for each of the two teams. */
export const BOSSES_PER_TITAN_PHASE = 2;
export const TITAN_BOSS_SLOTS = TITAN_PHASES.length * BOSSES_PER_TITAN_PHASE;

/** The Season Phases (1 to 3), each of which holds one Titan Reaver event. */
export const SEASON_PHASES = [1, 2, 3] as const;

/** What a slot (1 to 6) is called on screen: "Charge, boss 1". */
export const titanSlotLabel = (index: number) => `${TITAN_PHASES[Math.floor(index / BOSSES_PER_TITAN_PHASE)]}, boss ${(index % BOSSES_PER_TITAN_PHASE) + 1}`;

/**
 * The setup of the current Titan Reaver event, as saved in Admin > Weekly default: its 6 bosses (null for one not known yet). It is the
 * event of the current Season Phase, so it holds nothing else: the level players have is fixed by the Season Phase. Every boss in it is
 * different; a boss may return in a later event, so nothing is compared with other setups. Names are checked against the database elsewhere.
 */
export const titanReaverSetupSchema = z.object({
  bosses: z
    .array(z.string({ error: 'A boss is a name or empty' }).min(1, 'A boss is a name or empty').nullable(), { error: `A Titan Reaver setup has ${TITAN_BOSS_SLOTS} boss slots` })
    .length(TITAN_BOSS_SLOTS, `A Titan Reaver setup has ${TITAN_BOSS_SLOTS} boss slots`)
    .superRefine((bosses, ctx) => {
      const seen = new Map<string, number>();
      for (const [index, boss] of bosses.entries()) {
        if (boss === null) continue;
        const first = seen.get(boss);
        if (first !== undefined) ctx.addIssue({ code: 'custom', message: `"${boss}" is set twice (${titanSlotLabel(first)} and ${titanSlotLabel(index)}); the 6 bosses of an event are all different` });
        else seen.set(boss, index);
      }
    }),
});
export type TitanReaverSetup = z.infer<typeof titanReaverSetupSchema>;

/** Returns an error message, or null when the setup can be saved (names are checked against the database elsewhere). */
export const validateTitanReaverSetup = (setup: unknown): string | null => problemWith(titanReaverSetupSchema, setup);

// ---- Battles (#278) ---------------------------------------------------------------------------------------------------

/** A Titan Reaver Battle is two fights, one team against each of the two bosses of a Titan Reaver Phase. */
export const TITAN_FIGHTS = 2;

/** The map every Titan Reaver fight is on: a constant, with no choice and no column on a fight. */
export const TITAN_MAP = 'Open';

/** The level players have in a Season Phase's event, which is its maximum (1: 600, 2: 900, 3: 1200). */
export const MAX_LEVEL: Record<number, number> = { 1: 600, 2: 900, 3: 1200 };

/** The highest damage a fight takes: far above any real one, and still a whole number a script can add up. */
export const MAX_DAMAGE = 1e15;

const DAMAGE_UNITS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * Reads damage as the player types it: a whole number (`1234567890`), with thousands separators (`1,234,567,890`, `1 234 567 890`),
 * or short (`1.2B` is 1,200,000,000, `850K`, `3.45m`; a comma works as the decimal point there). Null when it is none of these.
 */
export function parseDamage(text: string): number | null {
  const clean = text.trim().replace(/\s+/g, '');
  const short = /^(\d+(?:[.,]\d+)?)([kmb])$/i.exec(clean);
  if (short) {
    const value = Math.round(Number(short[1]!.replace(',', '.')) * DAMAGE_UNITS[short[2]!.toLowerCase()]!);
    return value <= MAX_DAMAGE ? value : null;
  }
  if (!/^\d{1,3}(?:[,_]\d{3})+$|^\d+$/.test(clean)) return null;
  const value = Number(clean.replace(/[,_]/g, ''));
  return value <= MAX_DAMAGE ? value : null;
}

/** Damage with its thousands separators: `1,234,567,890`. */
export const formatDamage = (damage: number): string => String(damage).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const SHORT_UNITS: [string, number][] = [['K', 1e3], ['M', 1e6], ['B', 1e9]];

/** Damage as the short text `parseDamage` also reads, with 3 significant digits and no trailing zeros: `850K`, `12.3M`, `1.23B`. Under 1,000 it is the number itself. B is the largest unit, as in the game, so 1,523 billion is `1523B` (whole billions from 1000B). */
export function formatDamageShort(damage: number): string {
  if (damage < 1000) return String(damage);
  const last = SHORT_UNITS.length - 1;
  const text = (unit: number) => {
    const raw = damage / SHORT_UNITS[unit]![1];
    return raw >= 1000 ? Math.round(raw) : Number(raw.toPrecision(3));
  };
  let unit = last;
  while (unit > 0 && damage < SHORT_UNITS[unit]![1]) unit -= 1;
  // 999,999 rounds to 1000K: that reads better as 1M
  if (unit < last && text(unit) >= 1000) unit += 1;
  return `${text(unit)}${SHORT_UNITS[unit]![0]}`;
}

/** The Battle's damage: the sum of its fights, which is what the game ranks. */
export const battleTotal = (fights: { damage: number }[]): number => fights.reduce((sum, f) => sum + f.damage, 0);

/** The first thing wrong with the Battle-level fields and the two fights' bosses and damage, or null. Formations are checked apart. */
export function validateTitanReaverBattle(input: {
  seasonPhase: unknown;
  titanPhase: unknown;
  level: unknown;
  fights: { boss?: unknown; damage?: unknown }[] | unknown;
}): string | null {
  const { seasonPhase, titanPhase, level, fights } = input;
  if (!Number.isInteger(seasonPhase) || (seasonPhase as number) < 1 || (seasonPhase as number) > SEASON_PHASES.length) return 'The Season Phase must be 1, 2 or 3';
  if (!TITAN_PHASES.includes(titanPhase as TitanPhase)) return 'The Titan Reaver Phase must be Charge, Clash or Conquer';
  const max = MAX_LEVEL[seasonPhase as number]!;
  if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > max) return `The level must be a whole number from 1 to ${max} in Season Phase ${seasonPhase as number}`;
  if (!Array.isArray(fights) || fights.length !== TITAN_FIGHTS) return `A Titan Reaver Battle has exactly ${TITAN_FIGHTS} fights`;
  for (const [i, fight] of fights.entries()) {
    if (typeof fight?.boss !== 'string' || fight.boss === '') return `Fight ${i + 1}: pick a boss`;
    const damage = fight.damage;
    if (typeof damage !== 'number' || !Number.isInteger(damage) || damage < 0 || damage > MAX_DAMAGE) return `Fight ${i + 1}: the damage must be a whole number from 0 to ${formatDamage(MAX_DAMAGE)}`;
  }
  if (fights[0]!.boss === fights[1]!.boss) return `Both fights are against ${String(fights[0]!.boss)}: a Battle has two different bosses`;
  return null;
}

/** The first hero or Artifact that the two teams of a Battle both use, or null: they share neither. */
export function sharedByTeams(teams: { heroes: string[]; artifact: string | null }[]): { kind: 'hero' | 'Artifact'; name: string } | null {
  const [first, second] = teams;
  if (!first || !second) return null;
  const hero = first.heroes.find((h) => second.heroes.includes(h));
  if (hero) return { kind: 'hero', name: hero };
  return first.artifact && first.artifact === second.artifact ? { kind: 'Artifact', name: first.artifact } : null;
}

/** What grouping needs of a Battle: its total, level and each fight's boss and team. */
export interface GroupableBattle {
  id: number;
  total: number;
  level: number;
  fights: { boss: string; formation: { heroes: { name: string }[]; artifact: string | null } }[];
}

/** The Battles that fielded the same two formations: the best of them stands for the group. */
export interface BattleGroup<T extends GroupableBattle> {
  /** The highest total of the group (of equal totals, the one recorded last). */
  best: T;
  /** Every Battle of the group, the best first. */
  battles: T[];
  average: number;
  worst: number;
  lowestLevel: number;
  highestLevel: number;
}

const bestFirst = (a: GroupableBattle, b: GroupableBattle) => b.total - a.total || b.id - a.id;

/** The same units and Artifact against the same boss, wherever the heroes stood. */
const fightKey = (f: GroupableBattle['fights'][number]) => [f.boss, [...new Set(f.formation.heroes.map((h) => h.name))].sort(), f.formation.artifact ?? ''];

/**
 * Battles that fielded the same team (units and Artifact, not where the heroes stood) against each boss, in order, are one group: a formation is
 * retried many times for the luck of the fight. The level does not split a group: a run at a lower level has a lower total and so ranks lower
 * by itself. Groups come highest best total first.
 */
export function groupBattles<T extends GroupableBattle>(battles: T[]): BattleGroup<T>[] {
  const byTeams = new Map<string, T[]>();
  for (const battle of battles) {
    const key = JSON.stringify(battle.fights.map(fightKey));
    byTeams.set(key, [...(byTeams.get(key) ?? []), battle]);
  }
  return [...byTeams.values()]
    .map((list) => {
      const sorted = [...list].sort(bestFirst);
      const totals = sorted.map((b) => b.total);
      const levels = sorted.map((b) => b.level);
      return {
        best: sorted[0]!,
        battles: sorted,
        average: totals.reduce((sum, t) => sum + t, 0) / totals.length,
        worst: Math.min(...totals),
        lowestLevel: Math.min(...levels),
        highestLevel: Math.max(...levels),
      };
    })
    .sort((a, b) => bestFirst(a.best, b.best));
}

/** Whether a level is below the Season Phase's maximum, so a later run at the maximum might do better. */
export const belowMaxLevel = (seasonPhase: number, level: number): boolean => level < (MAX_LEVEL[seasonPhase] ?? level);

/** Fewer fights than this is an anecdote, not evidence. */
export const ANECDOTE_BELOW = 5;

/** What a team needs for Best teams: its heroes with their tiles, and its Artifact. */
export interface TeamFormation {
  heroes: { tile: number; name: string; part: string }[];
  artifact: string | null;
}

/** A Battle as Best teams reads it: its team level and its fights, each with its boss, damage and team. */
export interface BestTeamsBattle<F extends TeamFormation> {
  id: number;
  level: number;
  fights: { boss: string; damage: number; formation: F }[];
}

/** How a team stood in one place on the map: the fights fought with it and its best damage. */
export interface PlacementStat<F extends TeamFormation> {
  key: string;
  formation: F;
  fights: number;
  best: number;
}

/** A Composition beat the top one at a level both were recorded at. */
export interface SameLevelNote {
  level: number;
  damage: number;
  against: number;
  fights: number;
  againstFights: number;
}

/** One Composition (the same heroes and Artifact, wherever the heroes stood) against one boss. */
export interface BestTeam<F extends TeamFormation> {
  key: string;
  /** The team of its latest fight. */
  latest: F;
  heroes: string[];
  artifact: string | null;
  /** The fights at the chosen level, the best and the median damage of them; null when there is none. */
  fights: number;
  best: number | null;
  median: number | null;
  /** Fewer than `ANECDOTE_BELOW` fights at the chosen level. */
  anecdote: boolean;
  /** No fight at the chosen level: `best` is then null, and `lowerLevel` gives its highest level and the best damage there. */
  lowerLevel: { level: number; best: number } | null;
  /** The note of the same-level indicator, when it beat the top Composition at a level both were recorded at. */
  beat: SameLevelNote | null;
  /** Where the heroes stood in each fight, best damage first. */
  placements: PlacementStat<F>[];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const teamKey = (f: TeamFormation) => JSON.stringify([[...new Set(f.heroes.map((h) => h.name))].sort(), f.artifact ?? '']);
const placementKey = (f: TeamFormation) => JSON.stringify(f.heroes.map((h) => [h.tile, h.name, h.part]).sort());

/** The levels with a recorded fight against the boss, highest first. */
export function levelsOf(battles: BestTeamsBattle<TeamFormation>[], boss: string): number[] {
  return [...new Set(battles.filter((b) => b.fights.some((f) => f.boss === boss)).map((b) => b.level))].sort((a, b) => b - a);
}

/**
 * Every Composition recorded against `boss`, ranked at one team level. A level is only compared with the exact same level, and damage is never scaled.
 * Teams with a fight at `level` come first, by best damage (of equal bests, by more fights); teams with none follow, by their highest level and the
 * best damage there. The same-level indicator compares each other team with the top one at the levels both were recorded at (highest first), and
 * says when the other team's best beat it. `include` and `exclude` keep only the Compositions that hold every included hero and none of the excluded ones.
 * Battles are given newest first, so the first fight of a team is its latest.
 */
export function bestTeams<F extends TeamFormation>(battles: BestTeamsBattle<F>[], boss: string, level: number, filter: { include?: string[]; exclude?: string[] } = {}): BestTeam<F>[] {
  interface Raw {
    latest: F;
    byLevel: Map<number, number[]>;
    placements: Map<string, PlacementStat<F>>;
  }
  const raw = new Map<string, Raw>();
  for (const battle of battles) {
    for (const fight of battle.fights) {
      if (fight.boss !== boss) continue;
      const key = teamKey(fight.formation);
      const team = raw.get(key) ?? { latest: fight.formation, byLevel: new Map(), placements: new Map() };
      team.byLevel.set(battle.level, [...(team.byLevel.get(battle.level) ?? []), fight.damage]);
      const where = placementKey(fight.formation);
      const stat = team.placements.get(where);
      team.placements.set(where, stat ? { ...stat, fights: stat.fights + 1, best: Math.max(stat.best, fight.damage) } : { key: where, formation: fight.formation, fights: 1, best: fight.damage });
      raw.set(key, team);
    }
  }
  const { include = [], exclude = [] } = filter;
  const kept = [...raw].filter(([, t]) => {
    const names = t.latest.heroes.map((h) => h.name);
    return include.every((h) => names.includes(h)) && !exclude.some((h) => names.includes(h));
  });
  const bestAt = (t: Raw, at: number) => Math.max(...(t.byLevel.get(at) ?? [-1]));

  const teams = kept.map(([key, t]): BestTeam<F> => {
    const here = t.byLevel.get(level) ?? [];
    const highest = Math.max(...t.byLevel.keys());
    return {
      key,
      latest: t.latest,
      heroes: [...new Set(t.latest.heroes.map((h) => h.name))],
      artifact: t.latest.artifact,
      fights: here.length,
      best: here.length ? Math.max(...here) : null,
      median: here.length ? median(here) : null,
      anecdote: here.length < ANECDOTE_BELOW,
      lowerLevel: here.length ? null : { level: highest, best: bestAt(t, highest) },
      beat: null,
      placements: [...t.placements.values()].sort((a, b) => b.best - a.best || b.fights - a.fights),
    };
  });
  const rawOf = new Map(kept);
  teams.sort((a, b) => {
    if ((a.best === null) !== (b.best === null)) return a.best === null ? 1 : -1;
    if (a.best !== null && b.best !== null) return b.best - a.best || b.fights - a.fights;
    return b.lowerLevel!.level - a.lowerLevel!.level || b.lowerLevel!.best - a.lowerLevel!.best;
  });

  const top = teams[0] && teams[0].best !== null ? rawOf.get(teams[0].key)! : null;
  if (top) {
    for (const team of teams.slice(1)) {
      const mine = rawOf.get(team.key)!;
      const shared = [...mine.byLevel.keys()].filter((l) => top.byLevel.has(l)).sort((a, b) => b - a);
      const won = shared.find((l) => bestAt(mine, l) > bestAt(top, l));
      if (won !== undefined) team.beat = { level: won, damage: bestAt(mine, won), against: bestAt(top, won), fights: mine.byLevel.get(won)!.length, againstFights: top.byLevel.get(won)!.length };
    }
  }
  return teams;
}
