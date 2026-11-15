import { useState } from 'react';
import { api } from '../backend.js';
import type { LearnedView } from '../../src/shared/api.js';
import { sourceLabel } from './LookTile.js';
import { useConfirm } from '../ui/Dialog.js';

/** How well the readers did on the pictures read so far, and the way to undo everything one source added. */
export function LearnedSummary({ view, onChanged }: { view: LearnedView; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function removeSource(source: LearnedView['sources'][number]) {
    const ok = await confirm({
      title: `Delete the ${source.count} pictures that ${sourceLabel(source.source)} added?`,
      message: 'Heroes, ranks, artifacts and phantimals alike. The readers forget them; the records are not touched.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteLearnedSource(source.source);
      setError(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="panel" aria-label="Accuracy and sources">
      {dialog}
      <h3>How the readings did</h3>
      {view.accuracy.length === 0 ? (
        <p className="muted">No reading has been kept next to what the player chose yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Screen</th>
              <th>Field</th>
              <th>Readings</th>
              <th>Agreed</th>
            </tr>
          </thead>
          <tbody>
            {view.accuracy.map((a) => (
              <tr key={`${a.source}-${a.screen}-${a.field}`}>
                <td>{a.source}</td>
                <td>{a.screen}</td>
                <td>{a.field}</td>
                <td>{a.readings}</td>
                <td>{a.agreedPercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>Where the pictures came from</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {view.sources.length === 0 ? (
        <p className="muted">No picture has a source yet: it is kept for the pictures learnt from now on.</p>
      ) : (
        <ul>
          {view.sources.map((s) => (
            <li key={s.source}>
              {sourceLabel(s.source)}: {s.count} pictures{' '}
              <button className="danger small" aria-label={`Delete all from ${sourceLabel(s.source)}`} onClick={() => void removeSource(s)}>
                Delete all
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
