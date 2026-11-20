import { isSmallSample } from '../../src/domain/stats.js';
import { useLoad } from '../hooks/load.js';
import { api } from '../backend.js';
import { percent, record } from '../format.js';
import { GroupHeroes } from './FormationGroups.js';
import { WinBar } from './StatsTable.js';
import { Loading } from '../ui/ListStatus.js';

interface Filters {
  mode: string[];
  tag: string[];
  player: string[];
  playedIn: string[];
  excludeDefault: string;
}

/**
 * The best win-rate Formation groups on an opened map, with the heroes they hold (core, then flex) and their record. Both sides of
 * the PvP records count, so a group is read the same wherever it stood; a group with fewer than 3 records is not listed, and one
 * with fewer than 5 is flagged as a small sample.
 */
export function MapFormations({ map, filters }: { map: string; filters: Filters }) {
  const { data, error } = useLoad(() => api.statsMapFormations({ ...filters, map }), [map, filters.mode, filters.tag, filters.player, filters.playedIn, filters.excludeDefault]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <Loading />;
  if (data.length === 0) return <p className="muted">No formation has 3 records on this map with these filters.</p>;
  return (
    <table className="board" aria-label={`Best formations on ${map}`}>
      <thead>
        <tr>
          <th>#</th>
          <th>Formation</th>
          <th>Record</th>
          <th>Win rate</th>
        </tr>
      </thead>
      <tbody>
        {data.map((g, i) => (
          <tr key={[...g.core, ...g.flex].map((h) => h.hero).join()} className={isSmallSample(g.games) ? 'low' : undefined}>
            <td>{i + 1}</td>
            <td>
              <span className="map-formation">
                <GroupHeroes heroes={g.core} size={32} />
                <GroupHeroes heroes={g.flex} size={22} />
              </span>
            </td>
            <td>
              {record(g)} of {g.games}
              {isSmallSample(g.games) && <span className="badge few"> small sample</span>}
            </td>
            <td>
              <WinBar wins={g.wins} games={g.games} /> {percent(g.winRate)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
