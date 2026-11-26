import { useState } from 'react';
import { api, type SyncRun, type SyncSource, type SyncSourceId, type SyncState } from '../backend.js';
import { useAction } from '../hooks/action.js';
import { useConfirmActions } from '../hooks/confirm.js';
import { useLoad } from '../hooks/load.js';
import { useJobs } from '../jobs/JobsProvider.js';
import { Notice } from '../ui/Notice.js';

/** How the last run of a source went, in one line. */
function lastRunText(run: SyncRun | null): string {
  if (!run) return 'Never run.';
  const when = `${run.startedAt} UTC`;
  if (run.status === 'running') return `Started ${when}, running…`;
  return run.status === 'ok' ? `Last run ${when}: done.` : `Last run ${when}: failed.`;
}

function LastRun({ run }: { run: SyncRun | null }) {
  return (
    <div>
      <p className="muted">{lastRunText(run)}{run && (run.refresh || run.overwrite) ? ` (${[run.refresh ? 're-downloaded' : '', run.overwrite ? 'overwrote my edits' : ''].filter(Boolean).join(', ')})` : ''}</p>
      {run?.error && <Notice kind="error">{run.error}</Notice>}
      {run && run.lines.length > 0 && (
        <ul>
          {run.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {run && run.warnings.length > 0 && (
        <ul>
          {run.warnings.map((line, i) => (
            <li key={i}>
              <Notice kind="warning" as="span">{line}</Notice>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Brings the outside data and assets up to date, one source or all of them, in the background (ADR 0045). */
export function SyncPage() {
  const { summary } = useJobs();
  // a run that starts or ends is announced by the job watcher, so the page asks again then
  const loaded = useLoad(() => api.syncState(), [summary?.sync.running, summary?.sync.lastRunId]);
  const state: SyncState | undefined = loaded.data;
  const { error: actionError, busy, run } = useAction({ toast: true });
  const { confirmRun, dialog } = useConfirmActions(run);
  const [refresh, setRefresh] = useState<Record<string, boolean>>({});
  const [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  const error = loaded.error ?? actionError;
  const running = state?.running ?? null;
  const locked = busy || running !== null;

  const start = async (source: SyncSourceId | 'all', refreshIt: boolean, overwriteIt: boolean) => {
    const begin = () => api.startSync({ source, refresh: refreshIt, overwrite: overwriteIt });
    const show = (next: SyncState) => loaded.setData(() => next);
    if (overwriteIt) {
      await confirmRun(
        {
          title: 'Overwrite your edits?',
          message: 'Heroes, bosses and Arena maps you edited after an import get the source’s values again. Your records, rosters, hints and Boost tiles are not touched. The database is copied to data/backups first.',
          confirmLabel: 'Sync and overwrite',
        },
        begin,
        show,
      );
    } else await run(begin, show);
  };

  if (!state) return error ? <Notice kind="error">{error}</Notice> : null;
  const anyOverwrite = state.sources.some((s) => s.canOverwrite);
  return (
    <section>
      <h3>Sync</h3>
      <p className="muted">Brings data and pictures from outside sources up to date. Each sync runs in the background, one at a time, and only when you start it.</p>
      {error && <Notice kind="error">{error}</Notice>}
      {running && <Notice kind="success">Syncing {state.sources.find((s) => s.id === running)?.label ?? running}…</Notice>}
      {state.sources.map((source: SyncSource) => (
        <div key={source.id} className="card">
          <h4>{source.label}</h4>
          <p className="muted">{source.description}</p>
          <LastRun run={source.last} />
          <div className="actions">
            <label className="check">
              <input type="checkbox" checked={refresh[source.id] ?? false} onChange={(e) => setRefresh({ ...refresh, [source.id]: e.target.checked })} /> Re-download (ignore cache)
            </label>
            {source.canOverwrite && (
              <label className="check">
                <input type="checkbox" checked={overwrite[source.id] ?? false} onChange={(e) => setOverwrite({ ...overwrite, [source.id]: e.target.checked })} /> Overwrite my edits
              </label>
            )}
            <button className="primary" disabled={locked} onClick={() => void start(source.id, refresh[source.id] ?? false, source.canOverwrite && (overwrite[source.id] ?? false))}>
              Sync
            </button>
          </div>
        </div>
      ))}
      <div className="actions">
        <label className="check">
          <input type="checkbox" checked={refresh['all'] ?? false} onChange={(e) => setRefresh({ ...refresh, all: e.target.checked })} /> Re-download (ignore cache)
        </label>
        {anyOverwrite && (
          <label className="check">
            <input type="checkbox" checked={overwrite['all'] ?? false} onChange={(e) => setOverwrite({ ...overwrite, all: e.target.checked })} /> Overwrite my edits
          </label>
        )}
        <button className="primary" disabled={locked} onClick={() => void start('all', refresh['all'] ?? false, overwrite['all'] ?? false)}>
          Sync all
        </button>
      </div>
      {dialog}
    </section>
  );
}
