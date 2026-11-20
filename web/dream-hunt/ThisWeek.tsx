import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { DREAM_HUNT_FIGHTS, formatDurationFixed } from '../../src/domain/dream-hunt.js';
import type { DefaultSlot } from '../../src/domain/defaults.js';
import { api, type DreamHuntAttempt } from '../backend.js';
import { finishedDays, formationRuns, groupDays, totalScale } from './week-groups.js';
import { GroupRange } from './GroupRange.js';
import { useLoad } from '../hooks/load.js';
import { useMaps } from '../hooks/maps.js';
import { LayoutMap } from './BestTeams.js';
import { Portrait } from '../Portrait.js';
import { TeamCell } from '../TeamCell.js';
import { layoutFrom, type Layout } from '../../src/domain/layout.js';
import { toggled } from '../format.js';
import { DisclosureMark } from '../ui/Icon.js';
import { Notice } from '../ui/Notice.js';

/** How many groups are listed before `Show N more`. */
const GROUPS = 7;

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

/** A fight's team as its artifact then its heroes in small portraits (a hero on several tiles shows once), with the fight's time under it. */
function FightCell({ fight, worst }: { fight: DreamHuntAttempt; worst: number | null }) {
  return (
    <TeamCell artifact={fight.formation.artifact} heroes={fight.formation.heroes.map((h) => h.name)}>
      <span className="week-times muted">
        <span className={worst === null ? 'week-time' : 'week-time ranked'} style={worst === null ? undefined : ({ '--worst': worst } as CSSProperties)}>
          {formatDurationFixed(fight.timeSeconds!)}
        </span>
      </span>
    </TeamCell>
  );
}

/**
 * The best days of this week's Dream Hunt: the five bosses are the columns (the weekly default in Admin > Weekly default, or else the bosses
 * of the best day) and each line below is a group of the days played this week with the same five teams, since the same formation is retried
 * for the luck of the fight. A group shows its fastest day (the team used against each boss and the time of the fight), its best and average
 * total and how many days it holds; opened, it shows where the heroes stood on that best day, the range of the group's totals and the range of each of its teams against its boss over the whole week. Groups are ranked by
 * their best total, fastest first.
 */
export function ThisWeek({ slots }: { slots: DefaultSlot[] }) {
  const attempts = useLoad(() => api.dreamHuntAttempts({ limit: '100000' }), []);
  const groups = useMemo(() => (attempts.data ? groupDays(finishedDays(attempts.data, slots)) : null), [attempts.data, slots]);
  const scale = useMemo(() => (groups ? totalScale(groups) : null), [groups]); // over every group, so the bars do not move on Show more
  const formations = useMemo(() => (attempts.data ? formationRuns(attempts.data, slots) : null), [attempts.data, slots]);
  const error = attempts.error;
  const { maps, error: mapsError } = useMaps();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);

  const toggle = (battleId: number) => setOpen((current) => toggled(current, battleId));
  const listed = groups ? (all ? groups : groups.slice(0, GROUPS)) : null;

  const boss = (index: number) => slots[index]?.boss ?? null;
  const detail = (index: number) => {
    const slot = slots[index];
    return [slot?.rule, slot?.mapName].filter(Boolean).join(' · ') || `Fight ${index + 1}`;
  };

  return (
    <div>
      {mapsError && (
        <Notice kind="error">
          {mapsError}
        </Notice>
      )}
      {error && (
        <Notice kind="error">
          {error}
        </Notice>
      )}
      <table className="week-table" aria-label="This week">
        <thead>
          <tr>
            <th className="muted">Best total</th>
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
          {listed?.map((group, rank) => {
            const key = group.best.battleId;
            const shown = open.has(key);
            const label = `Group ${rank + 1}`;
            return (
              <Fragment key={key}>
                <tr className="week-day" aria-label={label} onClick={() => toggle(key)}>
                  <td>
                    <button className="week-toggle" aria-expanded={shown} aria-label={`${shown ? 'Hide' : 'Show'} the days of group ${rank + 1}`}>
                      <span>
                        <DisclosureMark open={shown} /> <strong className="week-time">{formatDurationFixed(group.best.totalSeconds)}</strong>
                      </span>
                      <span className="muted week-group-facts">
                        avg {formatDurationFixed(group.averageSeconds)} · ×{group.days.length}
                      </span>
                    </button>
                  </td>
                  {group.best.fights.map((fight, index) => (
                    <td key={fight.id}>
                      <FightCell fight={fight} worst={timeShare(fight.timeSeconds!, listed.map((g) => g.best.fights[index]!.timeSeconds!))} />
                    </td>
                  ))}
                </tr>
                {shown && (
                  <>
                    <tr className="week-placements" aria-label={`Placements of ${label.toLowerCase()}`}>
                      <td className="muted">Best day</td>
                      {group.best.fights.map((fight) => (
                        <td key={fight.id}>
                          <LayoutMap mapName={fight.mapName} layout={layoutOf(fight)} map={maps.find((m) => m.name === fight.mapName)} />
                        </td>
                      ))}
                    </tr>
                    {scale && formations && <GroupRange group={group} formations={formations} totalScale={scale} />}
                  </>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {groups && groups.length > GROUPS && (
        <button className="small" onClick={() => setAll((old) => !old)}>
          {all ? 'Show fewer' : `Show ${groups.length - GROUPS} more`}
        </button>
      )}
      {slots.every((slot) => !slot.boss) ? (
        <p className="muted">No bosses in the weekly default yet: set them in Admin &gt; Weekly default to see this week's days.</p>
      ) : (
        groups?.length === 0 && <p className="muted">No complete day (five won, timed fights) against this weekly default's bosses and rule recorded yet.</p>
      )}
      <p className="muted">
        The fastest days played against the weekly default's bosses and rule, by the total of their five fight times. Days that fielded the same five teams (same heroes and artifact, wherever they stood) are one group, shown by its best day with the average total and the number of days; open a group to see where the heroes stood on its best day and, the range (best, average and worst) of the group's totals on the scale of all the week's groups and, for each boss, of that team against it in every fight of the week, in other groups and unfinished days too, on a scale from 0 to 90 seconds. A lost fight has no time: it counts as a run, is shown as lost, and makes the worst 90 seconds; best and average are those of the wins. A day with a lost or untimed fight is not counted in the groups. The week changes when you change the weekly default.
      </p>
    </div>
  );
}
