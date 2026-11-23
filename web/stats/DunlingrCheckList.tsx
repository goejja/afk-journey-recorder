import { SMALL_SAMPLE } from '../../src/domain/stats.js';
import { api } from '../backend.js';
import { percent } from '../format.js';
import { useLoad } from '../hooks/load.js';
import { RecordLink } from '../records/RecordLink.js';
import { Notice } from '../ui/Notice.js';

/** The stored PvP records where the hero farthest from Dunlingr is not a Damage dealer or a Support (#222). Roles are Prydwen's, outside evidence. Read only: nothing here changes a record. */
export function DunlingrCheckList() {
  const { data, error } = useLoad(() => api.dunlingrCheck(), []);
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <p className="muted">Checking the records…</p>;
  if (data.records === 0) return null;
  return (
    <>
      <h3>Dunlingr&rsquo;s farthest ally</h3>
      <p className="muted">
        Dunlingr&rsquo;s order boosts the ally farthest from him, which should be the main Damage dealer or the main Support. The PvP roles are Prydwen&rsquo;s (outside evidence) and
        &ldquo;main&rdquo; is not checked: only a farthest hero that is a Tank or a Specialist, or has no PvP role, is listed. When two heroes are as far, the rearmost is taken, which is a guess.
        PvP only. A plan of yours can put it there on purpose, so nothing is changed here: look at the record. Dunlingr on a Boost tile of the map is left out.
      </p>
      <p className="muted">
        In {data.records} PvP {data.records === 1 ? 'record' : 'records'} with Dunlingr, a Damage dealer or a Support stood farthest in {data.boosted} ({percent(data.boosted / data.records)}
        {data.records < SMALL_SAMPLE ? ', anecdote' : ''}).
        {data.onBoostTile > 0 && ` ${data.onBoostTile} ${data.onBoostTile === 1 ? 'record' : 'records'} with Dunlingr on a Boost tile left out.`}
      </p>
      {data.rows.length === 0 ? (
        <p className="muted">Every record has a Damage dealer or a Support farthest from Dunlingr.</p>
      ) : (
        <table className="data-table" aria-label="Dunlingr check">
          <thead>
            <tr>
              <th>Battle</th>
              <th>Side</th>
              <th>Mode</th>
              <th>Map</th>
              <th>Dunlingr&rsquo;s tile</th>
              <th>Farthest hero</th>
              <th>PvP role</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={`${row.attemptId}-${row.side}`}>
                <td><RecordLink mode={row.mode} id={row.attemptId} /></td>
                <td>{row.side}</td>
                <td>{row.mode}</td>
                <td>{row.mapName ?? '–'}</td>
                <td>{row.tile}</td>
                <td>
                  {row.farthest}
                  {row.tiedWith.length > 0 && <span className="muted"> (as far as {row.tiedWith.join(', ')})</span>}
                </td>
                <td>{row.role ?? 'role unknown'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
