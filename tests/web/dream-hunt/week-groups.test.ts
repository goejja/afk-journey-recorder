import { describe, expect, it } from 'vitest';
import type { DreamHuntAttempt } from '../../../web/backend.js';
import { FIGHT_SCALE, finishedDays, formationKey, formationRuns, groupDays, totalScale, totalStats } from '../../../web/dream-hunt/week-groups.js';

const bosses = ['A', 'B', 'C', 'D', 'E'];
const slots = bosses.map((boss) => ({ boss, mapName: 'Open', rule: null }));

/** A day of five fights against the bosses; `teams` names the hero and `tile` where it stands, per fight. */
function day(battleId: number, seconds: number, teams: { hero: string; tile?: number; artifact?: string | null }[] = bosses.map(() => ({ hero: 'Evie' })), outcome: 'Win' | 'Loss' = 'Win'): DreamHuntAttempt[] {
  return bosses.map((boss, i) => ({
    id: battleId * 10 + i, season: 8, createdAt: `2026-01-0${battleId} 10:00:00`, outcome, note: null, boss, mapName: 'Open', timeSeconds: seconds, bossRule: null, tags: [], battleId, battlePosition: i + 1, battleFormationId: null,
    formation: { artifact: teams[i]!.artifact ?? null, phantimal: null, assist: null, formationId: null, heroes: [{ tile: teams[i]!.tile ?? 38, name: teams[i]!.hero, part: '', rank: null, equipmentLevel: null }] },
  })) as DreamHuntAttempt[];
}

describe('groupDays', () => {
  it('puts the days that fielded the same teams in one group, wherever the heroes stood, with its best day first', () => {
    const same = bosses.map(() => ({ hero: 'Evie', tile: 38 }));
    const moved = bosses.map(() => ({ hero: 'Evie', tile: 39 }));
    const groups = groupDays(finishedDays([...day(1, 20, same), ...day(2, 10, moved), ...day(3, 30, same)], slots));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.days.map((d) => d.battleId)).toEqual([2, 1, 3]);
    expect(groups[0]!.best.battleId).toBe(2);
    expect(groups[0]!.averageSeconds).toBe(100); // (50 + 100 + 150) / 3
  });

  it('keeps a day with one different team in a group of its own, and orders the groups by their best day', () => {
    const changed = bosses.map((_, i) => ({ hero: 'Evie', artifact: i === 4 ? 'Bladestorm' : null }));
    const groups = groupDays(finishedDays([...day(1, 20), ...day(2, 5, changed), ...day(3, 10)], slots));
    expect(groups.map((g) => g.days.map((d) => d.battleId))).toEqual([[2], [3, 1]]);
  });

  it('takes the day recorded last first when two days are equally fast', () => {
    const [group] = groupDays(finishedDays([...day(1, 10), ...day(2, 10)], slots));
    expect(group!.days.map((d) => d.battleId)).toEqual([2, 1]);
  });
});

describe('finishedDays', () => {
  it('leaves out a lost or untimed fight, a short day and a boss that is not the weekly default’s', () => {
    const untimed = day(2, 10).map((f, i) => (i === 4 ? { ...f, timeSeconds: null } : f));
    const wrongBoss = day(4, 10).map((f, i) => (i === 0 ? { ...f, boss: 'Z' } : f));
    const days = finishedDays([...day(1, 10), ...untimed, ...day(3, 10, undefined, 'Loss'), ...wrongBoss, ...day(5, 10).slice(0, 4)], slots);
    expect(days.map((d) => d.battleId)).toEqual([1]);
  });
});

describe('totalStats', () => {
  it('gives the best, average and worst total and the number of days of a group', () => {
    const [group] = groupDays(finishedDays([...day(1, 10), ...day(2, 20), ...day(3, 30)], slots));
    expect(totalStats(group!)).toEqual({ best: 50, average: 100, worst: 150, runs: 3 });
  });
});

describe('formationRuns', () => {
  const evie = (battleId: number) => day(battleId, 10)[0]!;
  const key = formationKey(evie(1));

  it('gathers the fights of a formation from every group, whatever the rest of its day', () => {
    const other = bosses.map((_, i) => ({ hero: 'Evie', artifact: i === 4 ? 'Bladestorm' : null }));
    const runs = formationRuns([...day(1, 10), ...day(2, 20), ...day(3, 30, other)], slots).get(key)!;
    expect(runs).toEqual({ best: 10, average: 20, worst: 30, wins: 3, lost: 0 }); // the first boss's formation is the same in both groups
  });

  it('counts the fights of an unfinished day, and a loss as a worst of the fight limit with its count', () => {
    const lost = day(2, 20).map((f, i) => (i === 0 ? { ...f, outcome: 'Loss' as const, timeSeconds: null } : f));
    const runs = formationRuns([...day(1, 10), ...lost, ...day(3, 30).slice(0, 1)], slots).get(key)!;
    expect(runs).toEqual({ best: 10, average: 20, worst: 90, wins: 2, lost: 1 });
  });

  it('has no best or average for a formation that only lost', () => {
    const lost = day(1, 20).map((f) => ({ ...f, outcome: 'Loss' as const, timeSeconds: null }));
    expect(formationRuns(lost, slots).get(key)).toEqual({ best: null, average: null, worst: 90, wins: 0, lost: 1 });
  });

  it('leaves out an untimed win, and a fight against a boss or rule that is not the weekly default’s', () => {
    const untimed = { ...evie(1), timeSeconds: null };
    const wrongBoss = { ...evie(2), boss: 'Z' };
    const wrongRule = { ...evie(3), bossRule: 'Frail' };
    expect(formationRuns([untimed, wrongBoss, wrongRule], slots).size).toBe(0);
  });
});

describe('totalScale', () => {
  it('runs from just under the fastest to just over the slowest total of every group', () => {
    const groups = groupDays(finishedDays([...day(1, 10), ...day(2, 20, bosses.map(() => ({ hero: 'Evie', artifact: 'Bladestorm' })))], slots));
    const scale = totalScale(groups);
    expect(scale.min).toBeCloseTo(50 - 4); // the room is 8% of the 50 s between the totals
    expect(scale.max).toBeCloseTo(100 + 4);
  });

  it('keeps a little room when every day took the same time, and never goes below 0', () => {
    const scale = totalScale(groupDays(finishedDays(day(1, 0.01), slots)));
    expect(scale.min).toBe(0);
    expect(scale.max).toBeCloseTo(0.1);
  });
});

describe('FIGHT_SCALE', () => {
  it('runs from 0 to the fight limit', () => {
    expect(FIGHT_SCALE).toEqual({ min: 0, max: 90 });
  });
});
