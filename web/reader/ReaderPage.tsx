import { useCallback, useEffect, useState } from 'react';
import { api, type LearnedView } from '../backend.js';
import { LearnedRanks } from './LearnedRanks.js';
import { LearnedSummary } from './LearnedSummary.js';
import { LearnedUnits } from './LearnedUnits.js';
import { ReaderHeroes } from './ReaderHeroes.js';

const PARTS = [
  { key: 'heroes', label: 'Heroes' },
  { key: 'ranks', label: 'Ranks' },
  { key: 'units', label: 'Artifacts and phantimals' },
] as const;

/** What the application and the Agent learnt from the pictures the player confirmed, to review and to fix when a picture was filed wrongly. */
export function ReaderPage() {
  const [view, setView] = useState<LearnedView | null>(null);
  const [part, setPart] = useState<(typeof PARTS)[number]['key']>('heroes');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setView(await api.learned());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // a change in one part (a source deleted) can touch another, so the hero list is read again too
  const changed = () => {
    setRevision((n) => n + 1);
    void reload();
  };

  return (
    <div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {view && <LearnedSummary view={view} onChanged={changed} />}
      <div className="tabs" role="tablist" aria-label="Learned">
        {PARTS.map(({ key, label }) => (
          <button key={key} role="tab" aria-selected={part === key} className={part === key ? 'active' : undefined} onClick={() => setPart(key)}>
            {label}
          </button>
        ))}
      </div>
      {part === 'heroes' && <ReaderHeroes key={revision} heroNames={view?.choices.heroes ?? []} onChanged={() => void reload()} />}
      {part === 'ranks' && view && <LearnedRanks view={view} onChanged={changed} />}
      {part === 'units' && view && <LearnedUnits view={view} onChanged={changed} />}
    </div>
  );
}
