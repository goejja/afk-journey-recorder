import { DREAM_HUNT_FIGHTS } from '../../src/domain/dream-hunt.js';
import type { DefaultSlot } from '../../src/domain/defaults.js';
import type { DreamHuntAttempt } from '../backend.js';

/** One played day: its five fights by number, and the total of their times. */
export interface PlayedDay {
  battleId: number;
  totalSeconds: number;
  fights: DreamHuntAttempt[];
}

/** The days that fielded the same five formations, the fastest first. */
export interface DayGroup {
  /** The fastest of the days: its teams and times stand for the group. */
  best: PlayedDay;
  /** Every day of the group, the fastest first. */
  days: PlayedDay[];
  averageSeconds: number;
}

/** Whether a fight is the one the weekly default asks for in its place: the same boss and the same rule (none matches none). */
const matchesSlot = (fight: DreamHuntAttempt, slot: DefaultSlot | undefined) => slot?.boss != null && fight.boss === slot.boss && (fight.bossRule ?? null) === (slot.rule ?? null);

/** The same units and artifact against the same boss and rule, wherever the heroes stood. */
const fightKey = (f: DreamHuntAttempt) => [f.boss, f.bossRule ?? '', [...new Set(f.formation.heroes.map((h) => h.name))].sort(), f.formation.artifact ?? ''];

/** Fastest first; of equal totals the one recorded last. */
const fastestFirst = (a: PlayedDay, b: PlayedDay) => a.totalSeconds - b.totalSeconds || b.battleId - a.battleId;

/**
 * The days played this week: the battles with all five fights won and timed whose fights match the weekly default (see matchesSlot) in
 * every place, fastest total first. There is no calendar here: the week changes when the weekly default is changed by hand. A day with a lost
 * or untimed fight, or fewer than five fights, is not a finished run and is left out.
 */
export function finishedDays(attempts: DreamHuntAttempt[], slots: DefaultSlot[]): PlayedDay[] {
  const byBattle = new Map<number, DreamHuntAttempt[]>();
  for (const a of attempts) if (a.battleId !== null) byBattle.set(a.battleId, [...(byBattle.get(a.battleId) ?? []), a]);
  const days: PlayedDay[] = [];
  for (const [battleId, group] of byBattle) {
    const fights = [...group].sort((a, b) => (a.battlePosition ?? 0) - (b.battlePosition ?? 0));
    const done = fights.length === DREAM_HUNT_FIGHTS && fights.every((f) => f.outcome === 'Win' && f.timeSeconds !== null);
    if (!done || !fights.every((f, index) => matchesSlot(f, slots[index]))) continue;
    days.push({ battleId, totalSeconds: fights.reduce((sum, f) => sum + f.timeSeconds!, 0), fights });
  }
  return days.sort(fastestFirst);
}

/**
 * Days that fielded the same team (units and artifact, not where the heroes stood) against each boss, in order, as one group: a player retries
 * a formation many times for the luck of the fight. A day with one different team is a group of its own. Groups come fastest best day first.
 */
export function groupDays(days: PlayedDay[]): DayGroup[] {
  const byTeams = new Map<string, PlayedDay[]>();
  for (const day of days) {
    const key = JSON.stringify(day.fights.map(fightKey));
    byTeams.set(key, [...(byTeams.get(key) ?? []), day]);
  }
  return [...byTeams.values()]
    .map((list) => {
      const sorted = [...list].sort(fastestFirst);
      return { best: sorted[0]!, days: sorted, averageSeconds: sorted.reduce((sum, d) => sum + d.totalSeconds, 0) / sorted.length };
    })
    .sort((a, b) => fastestFirst(a.best, b.best));
}

/** How the runs of a group came out in one place of the day, or over the whole day: the best, the average and the worst time, and how many runs. */
export interface RunStats {
  best: number;
  average: number;
  worst: number;
  runs: number;
}

/** Where a column of the table ends: the times shown on its bars run from `min` to `max`. */
export interface Scale {
  min: number;
  max: number;
}

/** The first of the group's columns is the fight against the first boss; `TOTAL` is the whole day, which the table shows first. */
export const TOTAL = DREAM_HUNT_FIGHTS;

const statsOf = (times: number[]): RunStats => ({ best: Math.min(...times), average: times.reduce((sum, t) => sum + t, 0) / times.length, worst: Math.max(...times), runs: times.length });

/** The runs of a group by fight (index 0 to 4) then, at `TOTAL`, by day. */
export const groupStats = (group: DayGroup): RunStats[] => [...Array.from({ length: DREAM_HUNT_FIGHTS }, (_, i) => statsOf(group.days.map((d) => d.fights[i]!.timeSeconds!))), statsOf(group.days.map((d) => d.totalSeconds))];

/**
 * One scale per column over every run of every group of the week, so a bar shows where a group's runs fall among the others'. A little room
 * is left at each end, so that the best and the worst of the week are not on the edge.
 */
export function weekScales(groups: DayGroup[]): Scale[] {
  const all = groups.map((g) => g.days);
  return Array.from({ length: DREAM_HUNT_FIGHTS + 1 }, (_, column) => {
    const times = all.flatMap((days) => days.map((d) => (column === TOTAL ? d.totalSeconds : d.fights[column]!.timeSeconds!)));
    const min = Math.min(...times);
    const max = Math.max(...times);
    const room = Math.max((max - min) * 0.08, 0.05);
    return { min: Math.max(0, min - room), max: max + room };
  });
}
