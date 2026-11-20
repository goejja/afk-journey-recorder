import { DREAM_HUNT_FIGHTS, formatDurationFixed } from '../../src/domain/dream-hunt.js';
import { TimeSpread } from './BestTeams.js';
import { FIGHT_SCALE, formationKey, totalStats, type DayGroup, type FormationRuns, type Scale } from './week-groups.js';

/** One cell of the row: a bar from the best to the worst time on `scale`, a tick at the average, the figures, and how many runs there were. */
function Range({ best, average, worst, runs, lost = 0, scale }: { best: number | null; average: number | null; worst: number; runs: number; lost?: number; scale: Scale }) {
  return (
    <td>
      <TimeSpread best={best ?? worst} median={average ?? worst} worst={worst} scaleMin={scale.min} scaleMax={scale.max} centre="average" format={formatDurationFixed} wide />
      <div className="range-figures">
        {best !== null && (
          <span>
            <span className="muted">best</span> {formatDurationFixed(best)}
          </span>
        )}
        {average !== null && (
          <span>
            <span className="muted">avg</span> <strong>{formatDurationFixed(average)}</strong>
          </span>
        )}
        <span>
          <span className="muted">worst</span> {formatDurationFixed(worst)}
        </span>
        <span className="muted">
          {runs} {runs === 1 ? 'run' : 'runs'}
          {lost > 0 && ` · ${lost} lost`}
        </span>
      </div>
    </td>
  );
}

/**
 * The row under the best day of an opened group. The total of the day shows the group's own days, on the week's scale of totals. Each boss
 * shows how the group's team against it came out over the whole week (`formations`), in other groups and unfinished days too, on the scale of
 * the fight limit; a formation that lost shows the fight limit as its worst.
 */
export function GroupRange({ group, formations, totalScale }: { group: DayGroup; formations: Map<string, FormationRuns>; totalScale: Scale }) {
  const total = totalStats(group);
  return (
    <tr className="week-range" aria-label="Range of the group">
      <Range {...total} scale={totalScale} />
      {Array.from({ length: DREAM_HUNT_FIGHTS }, (_, index) => {
        const formation = formations.get(formationKey(group.best.fights[index]!));
        if (!formation) return <td key={index} />;
        const { best, average, worst, wins, lost } = formation;
        return <Range key={index} best={best} average={average} worst={worst} runs={wins + lost} lost={lost} scale={FIGHT_SCALE} />;
      })}
    </tr>
  );
}
