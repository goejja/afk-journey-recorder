import { useState } from 'react';
import { api } from '../backend.js';
import { useAction } from '../hooks/action.js';
import type { LearnedView } from '../../src/shared/api.js';
import { sourceLabel } from './LookTile.js';
import { useConfirm } from '../ui/Dialog.js';
import { DisclosureMark } from '../ui/Icon.js';
import { Notice } from '../ui/Notice.js';

/** The panel's header line: the readings and the share of them that agreed with the player (weighted by readings), then the pictures and their sources. */
export function summaryLine(view: Pick<LearnedView, 'accuracy' | 'sources'>): string {
  const readings = view.accuracy.reduce((sum, a) => sum + a.readings, 0);
  const agreed = view.accuracy.reduce((sum, a) => sum + a.agreed, 0);
  const pictures = view.sources.reduce((sum, s) => sum + s.count, 0);
  const parts = [readings === 0 ? 'No readings yet' : `${readings.toLocaleString('en')} readings · ${Math.round((agreed / readings) * 100)}% agreed`];
  if (pictures > 0) parts.push(`${pictures.toLocaleString('en')} pictures from ${view.sources.length} ${view.sources.length === 1 ? 'source' : 'sources'}`);
  return parts.join(' · ');
}

/** How well the readers did on the pictures read so far, and the way to undo everything one source added. Starts collapsed, its header line giving the gist. */
export function LearnedSummary({ view, onChanged }: { view: LearnedView; onChanged: () => void }) {
  const { error, busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const { confirm, dialog } = useConfirm();

  async function removeSource(source: LearnedView['sources'][number]) {
    const ok = await confirm({
      title: `Delete the ${source.count} pictures that ${sourceLabel(source.source)} added?`,
      message: 'Heroes, ranks, artifacts and phantimals alike. The readers forget them; the records are not touched.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await run(() => api.deleteLearnedSource(source.source), onChanged);
  }

  return (
    <section className="panel" aria-label="Accuracy and sources">
      {dialog}
      <div className="deployment-head">
        <button className="deployment-toggle" aria-expanded={open} aria-controls="learned-summary-body" onClick={() => setOpen((old) => !old)}>
          <DisclosureMark open={open} /> How the readings did
        </button>
        <span className="muted">{summaryLine(view)}</span>
      </div>
      {open && (
        <div id="learned-summary-body">
          {view.accuracy.length === 0 ? (
            <p className="muted">No reading has been kept next to what the player chose yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Screen</th>
                  <th>Field</th>
                  <th className="num">Readings</th>
                  <th className="num">Agreed</th>
                </tr>
              </thead>
              <tbody>
                {view.accuracy.map((a) => (
                  <tr key={`${a.source}-${a.screen}-${a.field}`}>
                    <td>{a.source}</td>
                    <td>{a.screen}</td>
                    <td>{a.field}</td>
                    <td className="num">{a.readings}</td>
                    <td className="num">{a.agreedPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Where the pictures came from</h3>
          {error && (
            <Notice kind="error">
              {error}
            </Notice>
          )}
          {view.sources.length === 0 ? (
            <p className="muted">No picture has a source yet: it is kept for the pictures learnt from now on.</p>
          ) : (
            <ul className="sources-list">
              {view.sources.map((s) => (
                <li key={s.source}>
                  <span>{sourceLabel(s.source)}</span>
                  <span className="num">{s.count} pictures</span>
                  <button className="danger small" disabled={busy} aria-label={`Delete all from ${sourceLabel(s.source)}`} onClick={() => void removeSource(s)}>
                    Delete all
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
