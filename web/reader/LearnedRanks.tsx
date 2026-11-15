import { useState } from 'react';
import { api, learnedLookUrl } from '../backend.js';
import type { LearnedView } from '../../src/shared/api.js';
import { LookTile } from './LookTile.js';

/** The Rank Looks under each rank: a frame filed under the wrong rank makes the reader mistake the two. */
export function LearnedRanks({ view, onChanged }: { view: LearnedView; onChanged: () => void }) {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(id: number, from: string, to: string) {
    try {
      const { wrongBefore, wrongAfter } = await api.moveRankLook(id, to);
      setError(null);
      setMessage(`Moved from ${from} to ${to}. Reading each look from the others, the reader names ${wrongBefore} wrong ranks before and ${wrongAfter} after.`);
      onChanged();
    } catch (e) {
      setError(`Could not move the look to ${to}: ${(e as Error).message}`);
    }
  }

  async function remove(id: number, rank: string) {
    try {
      await api.deleteLearned('rank', id);
      setError(null);
      setMessage(null);
      onChanged();
    } catch (e) {
      setError(`Could not delete the look of ${rank}: ${(e as Error).message}`);
    }
  }

  const ranks = view.ranks.map((r) => ({ ...r, shown: flaggedOnly ? r.looks.filter((l) => l.looksLike !== null) : r.looks })).filter((r) => r.shown.length > 0);
  const total = view.ranks.reduce((sum, r) => sum + r.looks.length, 0);
  return (
    <section>
      <p className="muted">
        The rank reader names a rank by the closest frame tops among these, once it has three of that rank. A frame filed under the wrong rank makes it mistake one rank for the other:
        move it to the right rank, or delete it. "Looks like" marks a frame that the others would read as another rank, which is where to look first.
      </p>
      <div className="toolbar">
        <span className="muted">{total} looks under {view.ranks.length} ranks</span>
        <label className="check">
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Looks like another rank
        </label>
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {ranks.map((r) => (
        <article key={r.rank} className="panel reader-hero" aria-label={r.rank}>
          <h3>
            {r.rank} <span className="muted">{r.looks.length}</span>
            {!r.readable && <span className="warn-text"> not readable yet: fewer than 3 looks</span>}
          </h3>
          <ul className="reader-tiles">
            {r.shown.map((l) => (
              <LookTile
                key={l.id}
                src={learnedLookUrl('rank', l.id)}
                alt={`Look of ${r.rank}`}
                caption={l.createdAt.slice(0, 10)}
                source={l.source}
                looksLike={l.looksLike}
                name={`rank look ${l.id} of ${r.rank}`}
                current={r.rank}
                options={view.choices.ranks}
                onMove={(to) => void move(l.id, r.rank, to)}
                onDelete={() => void remove(l.id, r.rank)}
              />
            ))}
          </ul>
        </article>
      ))}
      {ranks.length === 0 && <p className="muted">{total === 0 ? 'The rank reader has learnt no look yet.' : 'No look matches.'}</p>}
    </section>
  );
}
