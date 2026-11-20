import { SMALL_SAMPLE } from '../../src/domain/stats.js';
import { api, type BackCheckRow } from '../backend.js';
import { percent } from '../format.js';
import { useLoad } from '../hooks/load.js';
import { RecordLink } from '../records/RecordLink.js';
import { Notice } from '../ui/Notice.js';

/** How many rows are drawn: the newest records first, so a long list stays usable while the marks in Admin > Units cut it down. */
const SHOWN = 500;

/** What the hero's games in the game row it stands in say, as context: a small sample is called small. */
const inRow = (row: BackCheckRow) =>
  row.gamesInRow < SMALL_SAMPLE
    ? `${row.gamesInRow} ${row.gamesInRow === 1 ? 'game' : 'games'} (anecdote)`
    : `${row.gamesInRow} games, ${percent(row.winsInRow / row.gamesInRow)} won`;

/** The stored PvP records where a hero that stands at the back has another hero behind it (#221). Dream Hunt and Stage have no such rule of placement. Read only: nothing here changes a record. */
export function BackCheckList() {
  const { data, error } = useLoad(() => api.backCheck(), []);
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <p className="muted">Checking the records…</p>;
  const left = data.onBoostTile > 0 && (
    <p className="muted">
      {data.onBoostTile} {data.onBoostTile === 1 ? 'hero stands on a Boost tile of its map and is' : 'heroes stand on a Boost tile of their map and are'} left out: placed there on purpose.
    </p>
  );
  if (data.rows.length === 0) {
    return (
      <>
        <p className="muted">Every hero that stands at the back has only heroes of its own kind behind it.</p>
        {left}
      </>
    );
  }
  const shown = data.rows.slice(0, SHOWN);
  return (
    <>
      <p className="muted">
        In PvP a Damage dealer with range 5 or more usually stands at the back of its side (Admin &gt; Units can add a hero or remove one). Stage and Dream Hunt records are not checked. These records have a hero that is not one of them standing behind such a hero,
        which usually means a hero was put on the wrong tile when the record was read from the replay. A plan of yours can put it there on purpose, so nothing is changed here: look at the record. A hero on a Boost tile of the map (Admin &gt; Maps) is left out. The games of the hero in that row are context, not the reason it is listed; under {SMALL_SAMPLE} is anecdote.
      </p>
      {data.rows.length > shown.length && <p className="muted">Showing the newest {shown.length} of {data.rows.length} rows.</p>}
      {left}
      <table className="board" aria-label="Placement check">
        <thead>
          <tr>
            <th>Battle</th>
            <th>Side</th>
            <th>Mode</th>
            <th>Map</th>
            <th>Hero</th>
            <th>Game row</th>
            <th>Behind it</th>
            <th>Hero in that row</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={`${row.attemptId}-${row.side}-${row.hero}`}>
              <td><RecordLink mode={row.mode} id={row.attemptId} /></td>
              <td>{row.side}</td>
              <td>{row.mode}</td>
              <td>{row.mapName ?? '–'}</td>
              <td>{row.hero}</td>
              <td>{row.gameRow}</td>
              <td>{row.behind.join(', ')}</td>
              <td>{inRow(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
