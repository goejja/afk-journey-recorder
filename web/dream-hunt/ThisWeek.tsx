import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { DREAM_HUNT_FIGHTS, formatDurationFixed } from '../../src/domain/dream-hunt.js';
import type { DefaultSlot } from '../../src/domain/defaults.js';
import { api, type DreamHuntAttempt } from '../backend.js';
import { useLoad } from '../useLoad.js';
import { useMaps } from '../useMaps.js';
import { LayoutMap } from './BestTeams.js';
import { Portrait } from '../Portrait.js';
import { TeamCell } from '../TeamCell.js';
import { layoutFrom, type Layout } from '../../src/domain/layout.js';
import { toggled } from '../format.js';

/** How many days are listed. */
const DAYS = 5;

/** One played day: its five fights by number, and the total of their times. */
export interface PlayedDay {
  battleId: number;
  totalSeconds: number;
  fights: DreamHuntAttempt[];
}

/** Whether a fight is the one the weekly default asks for in its place: the same boss and the same rule (none matches none). */
const matchesSlot = (fight: DreamHuntAttempt, slot: DefaultSlot | undefined) => slot?.boss != null && fight.boss === slot.boss && (fight.bossRule ?? null) === (slot.rule ?? null);

/**
 * The fastest days played this week: the battles with all five fights won and timed whose fights match the weekly default (see matchesSlot) in
 * every place, fastest total first. There is no calendar here: the week changes when the weekly default is changed by hand. A day with a lost
 * or untimed fight, or fewer than five fights, is not a finished run and is left out.
 */
function bestDays(attempts: DreamHuntAttempt[], slots: DefaultSlot[], count: number): PlayedDay[] {
  const byBattle = new Map<number, DreamHuntAttempt[]>();
  for (const a of attempts) if (a.battleId !== null) byBattle.set(a.battleId, [...(byBattle.get(a.battleId) ?? []), a]);
  const days: PlayedDay[] = [];
  for (const [battleId, group] of byBattle) {
    const fights = [...group].sort((a, b) => (a.battlePosition ?? 0) - (b.battlePosition ?? 0));
    const done = fights.length === DREAM_HUNT_FIGHTS && fights.every((f) => f.outcome === 'Win' && f.timeSeconds !== null);
    if (!done || !fights.every((f, index) => matchesSlot(f, slots[index]))) continue;
    days.push({ battleId, totalSeconds: fights.reduce((sum, f) => sum + f.timeSeconds!, 0), fights });
  }
  return days.sort((a, b) => a.totalSeconds - b.totalSeconds || b.battleId - a.battleId).slice(0, count);
}

/** How a formation did against one boss: its won, timed fights. */
export interface FormationTimes {
  fights: number;
  bestSeconds: number;
  averageSeconds: number;
}

/** The same units and artifact against the same boss and rule, wherever the heroes stood. */
const formationKey = (f: DreamHuntAttempt) => JSON.stringify([f.boss, f.bossRule ?? '', [...new Set(f.formation.heroes.map((h) => h.name))].sort(), f.formation.artifact ?? '']);

/** Best and average time of each formation over all recorded won, timed fights against a boss (not only this week's), by formationKey. */
function formationTimes(attempts: DreamHuntAttempt[]): Map<string, FormationTimes> {
  const times = new Map<string, number[]>();
  for (const a of attempts) if (a.outcome === 'Win' && a.timeSeconds !== null) times.set(formationKey(a), [...(times.get(formationKey(a)) ?? []), a.timeSeconds]);
  return new Map([...times].map(([key, list]) => [key, { fights: list.length, bestSeconds: Math.min(...list), averageSeconds: list.reduce((sum, t) => sum + t, 0) / list.length }]));
}

/**
 * Where a fight's time falls among the days listed against the same boss: 0 for the fastest, 1 for the slowest, null when the days do not differ
 * (a lone day, or equal times), so nothing is coloured that has nothing to compare with.
 */
export function timeShare(seconds: number, among: number[]): number | null {
  const fastest = Math.min(...among);
  const slowest = Math.max(...among);
  return slowest > fastest ? (seconds - fastest) / (slowest - fastest) : null;
}

/** Where a fight's heroes stood. */
const layoutOf = (fight: DreamHuntAttempt): Layout =>
  layoutFrom({ heroes: fight.formation.heroes.map((h) => ({ tile: h.tile, hero: h.name, part: h.part })), phantimal: fight.formation.phantimal });

/** A fight's team as its artifact then its heroes in small portraits (a hero on several tiles shows once), with the fight's time under it and, on the same line, the formation's best and average time when it won more than once against the boss. */
function FightCell({ fight, times, worst }: { fight: DreamHuntAttempt; times: FormationTimes | undefined; worst: number | null }) {
  return (
    <TeamCell artifact={fight.formation.artifact} heroes={fight.formation.heroes.map((h) => h.name)}>
      <span className="week-times muted">
        <span className={worst === null ? 'week-time' : 'week-time ranked'} style={worst === null ? undefined : ({ '--worst': worst } as CSSProperties)}>
          {formatDurationFixed(fight.timeSeconds!)}
        </span>
        {times && times.fights > 1 && (
          <>
            {' '}· best <span className="week-time">{formatDurationFixed(times.bestSeconds)}</span> · avg <span className="week-time">{formatDurationFixed(times.averageSeconds)}</span>
          </>
        )}
      </span>
    </TeamCell>
  );
}

/**
 * The best days of this week's Dream Hunt: the five bosses are the columns (the weekly default in Admin > Weekly default, or else the bosses
 * of the best day) and each line below is one day actually played this week, with the team used against each boss and the time of the
 * fight. Days are ranked by the total of their five times, fastest first.
 */
export function ThisWeek({ slots }: { slots: DefaultSlot[] }) {
  const attempts = useLoad(() => api.dreamHuntAttempts({ limit: '100000' }), []);
  const days: PlayedDay[] | null = useMemo(() => (attempts.data ? bestDays(attempts.data, slots, DAYS) : null), [attempts.data, slots]);
  const times = useMemo(() => (attempts.data ? formationTimes(attempts.data) : new Map<string, FormationTimes>()), [attempts.data]);
  const error = attempts.error;
  const maps = useMaps();
  const [open, setOpen] = useState<Set<number>>(new Set());

  const toggle = (battleId: number) => setOpen((current) => toggled(current, battleId));

  const boss = (index: number) => slots[index]?.boss ?? null;
  const detail = (index: number) => {
    const slot = slots[index];
    return [slot?.rule, slot?.mapName].filter(Boolean).join(' · ') || `Fight ${index + 1}`;
  };

  return (
    <div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <table className="week-table" aria-label="This week">
        <thead>
          <tr>
            <th className="muted">Total</th>
            {Array.from({ length: DREAM_HUNT_FIGHTS }, (_, index) => (
              <th key={index}>
                {boss(index) ? (
                  <span className="week-boss">
                    <Portrait kind="boss" name={boss(index)!} size={32} />
                    <span>
                      <strong>{boss(index)}</strong>
                      <span className="muted">{detail(index)}</span>
                    </span>
                  </span>
                ) : (
                  <span className="muted">Fight {index + 1}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days?.map((day, rank) => (
            <Fragment key={day.battleId}>
              <tr className="week-day" aria-label={`Day ${rank + 1}`} onClick={() => toggle(day.battleId)}>
                <td>
                  <button className="week-toggle" aria-expanded={open.has(day.battleId)} aria-label={`${open.has(day.battleId) ? 'Hide' : 'Show'} placements of day ${rank + 1}`}>
                    <span aria-hidden="true">{open.has(day.battleId) ? '▾' : '▸'}</span> <strong className="week-time">{formatDurationFixed(day.totalSeconds)}</strong>{' '}
                    <span className="muted">#{rank + 1}</span>
                  </button>
                </td>
                {day.fights.map((fight, index) => (
                  <td key={fight.id}>
                    <FightCell fight={fight} times={times.get(formationKey(fight))} worst={timeShare(fight.timeSeconds!, days!.map((d) => d.fights[index]!.timeSeconds!))} />
                  </td>
                ))}
              </tr>
              {open.has(day.battleId) && (
                <tr className="week-placements" aria-label={`Placements of day ${rank + 1}`}>
                  <td />
                  {day.fights.map((fight) => (
                    <td key={fight.id}>
                      <LayoutMap mapName={fight.mapName} layout={layoutOf(fight)} map={maps.find((m) => m.name === fight.mapName)} />
                    </td>
                  ))}
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {slots.every((slot) => !slot.boss) ? (
        <p className="muted">No bosses in the weekly default yet: set them in Admin &gt; Weekly default to see this week's days.</p>
      ) : (
        days?.length === 0 && <p className="muted">No complete day (five won, timed fights) against this weekly default's bosses and rule recorded yet.</p>
      )}
      <p className="muted">
        The fastest days played against the weekly default's bosses and rule, by the total of their five fight times; open a day to see where the heroes stood against each boss. A day with a lost or untimed fight is not counted. The week changes when you change the weekly default.
      </p>
    </div>
  );
}
