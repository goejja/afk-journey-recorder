import { formatDurationFixed } from '../../src/domain/dream-hunt.js';
import { TimeSpread } from './BestTeams.js';
import { DREAM_HUNT_FIGHTS } from '../../src/domain/dream-hunt.js';
import { groupStats, TOTAL, type DayGroup, type Scale } from './week-groups.js';

/** The columns of the table in order: the total of the day first, then each fight. */
const COLUMNS = [TOTAL, ...Array.from({ length: DREAM_HUNT_FIGHTS }, (_, i) => i)];

/**
 * The row under the best day of an opened group: for the total and for each boss, a bar from the group's best to its worst time on the week's
 * scale, a tick at the average, and the three figures; the total's cell also says how many runs the group has.
 */
export function GroupRange({ group, scales }: { group: DayGroup; scales: Scale[] }) {
  const stats = groupStats(group);
  return (
    <tr className="week-range" aria-label="Range of the group">
      {COLUMNS.map((column) => {
        const s = stats[column]!;
        const scale = scales[column]!;
        return (
          <td key={column}>
            <TimeSpread best={s.best} median={s.average} worst={s.worst} scaleMin={scale.min} scaleMax={scale.max} centre="average" format={formatDurationFixed} wide />
            <div className="range-figures">
              <span>
                <span className="muted">best</span> {formatDurationFixed(s.best)}
              </span>
              <span>
                <span className="muted">avg</span> <strong>{formatDurationFixed(s.average)}</strong>
              </span>
              <span>
                <span className="muted">worst</span> {formatDurationFixed(s.worst)}
              </span>
              {column === TOTAL && (
                <span className="muted">
                  {s.runs} {s.runs === 1 ? 'run' : 'runs'}
                </span>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}
