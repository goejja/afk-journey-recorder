import { DREAM_HUNT_FIGHTS } from '../../src/domain/dream-hunt.js';
import type { DefaultSlot } from '../../src/domain/defaults.js';
import type { DreamHuntAttempt } from '../backend.js';

/** One played day: its five fights by number, and the total of their times. */
export interface PlayedDay {
  battleId: number;
  /** When the day was recorded (its first fight). */
  createdAt: string;
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
    days.push({ battleId, createdAt: fights[0]!.createdAt, totalSeconds: fights.reduce((sum, f) => sum + f.timeSeconds!, 0), fights });
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
