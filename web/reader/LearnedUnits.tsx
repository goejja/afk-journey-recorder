import { useState } from 'react';
import { api, learnedLookUrl } from '../backend.js';
import type { LearnedView } from '../../src/shared/api.js';
import { LookTile } from './LookTile.js';

const KIND_LABEL = { artifact: 'Artifact', phantimal: 'Phantimal' } as const;

/** The artifact and phantimal crops saved from Battle imports, shown to the Agent as references. */
export function LearnedUnits({ view, onChanged }: { view: LearnedView; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function act(what: string, run: () => Promise<unknown>) {
    try {
      await run();
      setError(null);
      onChanged();
    } catch (e) {
      setError(`Could not ${what}: ${(e as Error).message}`);
    }
  }

  return (
    <section>
      <p className="muted">
        The crops of artifacts and phantimals saved with Battle imports. The Agent gets them as extra references for that name, so a crop filed under the wrong name misleads it: move it to the
        right one, or delete it.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {view.units.length === 0 && <p className="muted">No crop has been saved yet.</p>}
      {view.units.map((u) => (
        <article key={`${u.kind}-${u.name}`} className="panel reader-hero" aria-label={`${KIND_LABEL[u.kind]} ${u.name}`}>
          <h3>
            {u.name} <span className="muted">{KIND_LABEL[u.kind]} · {u.looks.length}</span>
          </h3>
          <ul className="reader-tiles">
            {u.looks.map((l) => (
              <LookTile
                key={l.id}
                src={learnedLookUrl('unit', l.id)}
                alt={`Crop of ${u.name}`}
                caption={l.createdAt.slice(0, 10)}
                source={l.source}
                looksLike={null}
                name={`crop ${l.id} of ${u.name}`}
                current={u.name}
                options={u.kind === 'artifact' ? view.choices.artifacts : view.choices.phantimals}
                onMove={(to) => void act(`move the crop to ${to}`, () => api.moveUnitLook(l.id, to))}
                onDelete={() => void act(`delete the crop of ${u.name}`, () => api.deleteLearned('unit', l.id))}
              />
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
