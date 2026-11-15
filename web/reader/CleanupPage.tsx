import { useState } from 'react';
import { RECORD_MODES } from '../../src/domain/arena.js';
import { api, type CleanupPreview, type CleanupRequest } from '../backend.js';
import { TagSelect } from '../Tags.js';
import { useConfirm } from '../ui/Dialog.js';

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

/** Removing old records by mode, age and tag, and compacting the database file. */
export function CleanupPage() {
  const [mode, setMode] = useState('');
  const [days, setDays] = useState('90');
  const [tag, setTag] = useState('');
  const [preview, setPreview] = useState<{ selection: CleanupRequest; result: CleanupPreview } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const selection = (): CleanupRequest => ({ ...(mode ? { mode } : {}), olderThanDays: Number(days), ...(tag ? { tag } : {}) });
  const fail = (e: unknown) => (setError((e as Error).message), setMessage(null));

  async function runPreview() {
    try {
      const chosen = selection();
      setPreview({ selection: chosen, result: await api.previewCleanup(chosen) });
      setError(null);
      setMessage(null);
    } catch (e) {
      setPreview(null);
      fail(e);
    }
  }

  async function remove() {
    if (!preview) return;
    const { count } = preview.result;
    if (
      !(await confirm({
        title: `Permanently delete ${count} record${count === 1 ? '' : 's'}?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      const { deleted } = await api.deleteCleanup(preview.selection, count);
      setPreview(null);
      setError(null);
      setMessage(`Deleted ${deleted} record${deleted === 1 ? '' : 's'}. Optimize the database below to reclaim the space.`);
    } catch (e) {
      setPreview(null);
      fail(e);
    }
  }

  async function optimize() {
    try {
      const { bytesBefore, bytesAfter } = await api.optimizeDatabase();
      setError(null);
      setMessage(`Database compacted: ${kb(bytesBefore)} → ${kb(bytesAfter)}.`);
    } catch (e) {
      fail(e);
    }
  }

  return (
    <section>
      <h3>Cleanup</h3>
      <p className="muted">
        Remove old records you no longer need. Age counts from the day a record was entered. Deleting is permanent, so you see how many records match before
        confirming.
      </p>
      <div className="filters">
        <label className="field">
          Mode
          <select value={mode} onChange={(e) => (setMode(e.target.value), setPreview(null))}>
            <option value="">All modes</option>
            {RECORD_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Older than (days)
          <input type="number" min={1} value={days} onChange={(e) => (setDays(e.target.value), setPreview(null))} />
        </label>
        <div className="field">
          Tag
          <TagSelect value={tag} onChange={(t) => (setTag(t), setPreview(null))} />
        </div>
        <button onClick={() => void runPreview()}>Preview</button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {preview && (
        <div className="panel">
          {preview.result.count === 0 ? (
            <p>No records match.</p>
          ) : (
            <>
              <p>
                <strong>{preview.result.count}</strong> record{preview.result.count === 1 ? '' : 's'} match, entered between {preview.result.oldest} and{' '}
                {preview.result.newest}.
              </p>
              <button className="danger" onClick={() => void remove()}>
                Delete {preview.result.count} record{preview.result.count === 1 ? '' : 's'}
              </button>
            </>
          )}
        </div>
      )}
      <h3>Database file</h3>
      <p className="muted">Compacting rewrites the file to reclaim space left by deleted records and refreshes its statistics. Your records are not changed.</p>
      <button onClick={() => void optimize()}>Optimize database</button>
      {dialog}
    </section>
  );
}
