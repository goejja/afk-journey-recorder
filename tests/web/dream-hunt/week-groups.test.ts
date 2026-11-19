import { describe, expect, it } from 'vitest';
import type { DreamHuntAttempt } from '../../../web/backend.js';
import { finishedDays, groupDays } from '../../../web/dream-hunt/week-groups.js';

const bosses = ['A', 'B', 'C', 'D', 'E'];
const slots = bosses.map((boss) => ({ boss, mapName: 'Open', rule: null }));

/** A day of five fights against the bosses; `teams` names the hero and `tile` where it stands, per fight. */
function day(battleId: number, seconds: number, teams: { hero: string; tile?: number; artifact?: string | null }[] = bosses.map(() => ({ hero: 'Evie' })), outcome = 'Win'): DreamHuntAttempt[] {
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
