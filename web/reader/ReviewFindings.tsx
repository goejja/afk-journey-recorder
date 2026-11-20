import { useState } from 'react';
import { api, type ReviewFinding, type ReviewFindings } from '../backend.js';
import { RecordLink } from '../records/RecordLink.js';

/** Marks a finding the previous run did not have. */
const NewMark = ({ finding }: { finding: ReviewFinding }) => (finding.new ? <><span className="badge">New</span>{' '}</> : null);

/** What a finding is about, in the words of its buttons. */
const about = (f: ReviewFinding) => (f.code === 'rank-look-misread' || f.code === 'rank-look-unreadable' ? `Rank Look ${f.subject}` : f.code === 'record-phantimal-faction' ? `record ${f.subject}` : f.subject);
const identity = (f: ReviewFinding) => ({ code: f.code, subject: f.subject, message: f.message });

/** Hides a finding the player judges fine, until its message changes (ADR 0032). */
function DismissButton({ finding, onDismissalChanged, onError }: { finding: ReviewFinding; onDismissalChanged: () => void; onError: (message: string) => void }) {
  async function dismiss() {
    try {
      await api.dismissFinding(identity(finding));
      onDismissalChanged();
    } catch (e) {
      onError(`Could not dismiss the finding: ${(e as Error).message}`);
    }
  }
  return (
    <button className="small" aria-label={`Dismiss finding about ${about(finding)}`} onClick={() => void dismiss()}>
      Dismiss
    </button>
  );
}

const kilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Rank Looks the others read as another rank, or whose picture cannot be read: move one to that rank, or delete it, with the routes of Admin > Reader. */
function Misread({ finding, onChanged, onDismissalChanged, onError }: { finding: ReviewFinding; onChanged: (done: ReviewFinding[]) => void; onDismissalChanged: () => void; onError: (message: string) => void }) {
  const id = Number(finding.subject);
  async function run(action: () => Promise<unknown>, failure: string) {
    try {
      await action();
      onChanged([finding]);
    } catch (e) {
      onError(`${failure}: ${(e as Error).message}`);
    }
  }
  return (
    <li>
      <NewMark finding={finding} />
      {finding.message}{' '}
      {finding.readAs && (
        <>
          <button onClick={() => void run(() => api.moveRankLook(id, finding.readAs!), `Could not move Rank Look ${id}`)}>Move Rank Look {id} to {finding.readAs}</button>{' '}
        </>
      )}
      <button className="danger small" onClick={() => void run(() => api.deleteLearned('rank', id), `Could not delete Rank Look ${id}`)}>
        Delete Rank Look {id}
      </button>{' '}
      <DismissButton finding={finding} onDismissalChanged={onDismissalChanged} onError={onError} />
    </li>
  );
}

/** The Wrong, Obsolete (unreferenced files and the kept pictures) and Improve findings of the Reader review; Thinning is shown by the page beside them. */
const EMPTY: ReviewFindings = { wrong: [], obsolete: [], improve: [], kept: [] };

/** `findings` is null while there is no run to show; `placeholder` then says why. The page around the findings stays where it is meanwhile. */
export function ReviewFindingsView({ findings: found, dismissed, placeholder, onChanged, onDismissalChanged, onError, children }: { findings: ReviewFindings | null; dismissed: ReviewFinding[]; placeholder: string; onChanged: (done: ReviewFinding[]) => void; onDismissalChanged: () => void; onError: (message: string) => void; children?: React.ReactNode }) {
  const findings = found ?? EMPTY;
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const files = findings.obsolete.filter((f) => f.code === 'unreferenced-file');
  const ticked = files.filter((f) => !unticked.has(f.subject)).map((f) => f.subject);
  const heroes = findings.improve.filter((f) => f.code === 'hero-no-example');
  const toggle = (file: string) =>
    setUnticked((current) => {
      const next = new Set(current);
      if (!next.delete(file)) next.add(file);
      return next;
    });

  async function deleteFiles() {
    try {
      await api.deleteReviewFiles(ticked);
      onChanged(files.filter((f) => ticked.includes(f.subject)));
    } catch (e) {
      onError(`Could not delete the files: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <h3>Wrong</h3>
      {found === null ? (
        <p className="muted">{placeholder}</p>
      ) : findings.wrong.length === 0 ? (
        <p className="muted">Nothing looks wrong.</p>
      ) : (
        <ul>
          {findings.wrong.map((f) =>
            f.code === 'rank-look-misread' || f.code === 'rank-look-unreadable' ? (
              <Misread key={`${f.code}-${f.subject}`} finding={f} onChanged={onChanged} onDismissalChanged={onDismissalChanged} onError={onError} />
            ) : (
              <li key={`${f.code}-${f.subject}`}>
                <NewMark finding={f} />
                {f.message}{' '}
                {f.recordId !== undefined && f.mode !== undefined && (
                  <>
                    <RecordLink mode={f.mode} id={f.recordId} label="Open the record" />{' '}
                  </>
                )}
                <DismissButton finding={f} onDismissalChanged={onDismissalChanged} onError={onError} />
              </li>
            ),
          )}
        </ul>
      )}

      <h3>Obsolete</h3>
      {files.length > 0 && (
        <>
          <p className="muted">Files that no row refers to: nothing reads them.</p>
          <ul>
            {files.map((f) => (
              <li key={f.subject}>
                <label className="check">
                  <input type="checkbox" checked={!unticked.has(f.subject)} onChange={() => toggle(f.subject)} aria-label={`Delete ${f.subject}`} /> <NewMark finding={f} />
                  {f.subject}
                </label>{' '}
                <DismissButton finding={f} onDismissalChanged={onDismissalChanged} onError={onError} />
              </li>
            ))}
          </ul>
          <button className="danger" disabled={ticked.length === 0} onClick={() => void deleteFiles()}>
            Delete {plural(ticked.length, 'ticked file', 'ticked files')}
          </button>
        </>
      )}
      {findings.kept.length > 0 && (
        <>
          <p className="muted">Pictures kept for a purpose: only you can say whether they are still wanted.</p>
          <table className="board" aria-label="Kept pictures">
            <thead>
              <tr>
                <th>Category</th>
                <th>Files</th>
                <th>Size</th>
                <th>Oldest</th>
              </tr>
            </thead>
            <tbody>
              {findings.kept.map((k) => (
                <tr key={k.category}>
                  <td>{k.category}</td>
                  <td>{plural(k.files, 'file', 'files')}</td>
                  <td>{kilobytes(k.bytes)}</td>
                  <td>{k.oldest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {children}

      <h3>Improve</h3>
      {found === null ? null : findings.improve.length === 0 ? (
        <p className="muted">Nothing to improve.</p>
      ) : (
        <ul>
          {findings.improve.filter((f) => f.code !== 'hero-no-example').map((f) => (
            <li key={`${f.code}-${f.subject}`}>
              <NewMark finding={f} />
              {f.message} <DismissButton finding={f} onDismissalChanged={onDismissalChanged} onError={onError} />
            </li>
          ))}
        </ul>
      )}
      {heroes.length > 0 && (
        <details>
          <summary>{heroes.length === 1 ? '1 hero has no example' : `${heroes.length} heroes have no example`}</summary>
          <ul>
            {heroes.map((f) => (
              <li key={f.subject}>
                {f.subject} <DismissButton finding={f} onDismissalChanged={onDismissalChanged} onError={onError} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {dismissed.length > 0 && (
        <details>
          <summary>Dismissed ({dismissed.length})</summary>
          <ul>
            {dismissed.map((f) => (
              <li key={`${f.code}-${f.subject}-${f.message}`}>
                {f.message}{' '}
                <button
                  className="small"
                  aria-label={`Show again finding about ${about(f)}`}
                  onClick={() => void api.restoreFinding(identity(f)).then(onDismissalChanged, (e: Error) => onError(`Could not show the finding again: ${e.message}`))}
                >
                  Show again
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
