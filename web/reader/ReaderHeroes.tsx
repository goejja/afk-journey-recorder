import { useCallback, useEffect, useState } from 'react';
import { api, readerExampleUrl, type ReaderExample, type ReaderView } from '../backend.js';
import { LookTile } from './LookTile.js';

const KIND_LABEL: Record<ReaderExample['kind'], string> = { example: 'Example', look: 'Look' };

/** What the hero reader learnt: the tiles filed under each hero, so a tile filed under the wrong hero can be found and deleted. */
export function ReaderHeroes({ heroNames, onChanged }: { heroNames: string[]; onChanged: () => void }) {
  const [view, setView] = useState<ReaderView | null>(null);
  const [search, setSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setView(await api.readerExamples());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function move(example: ReaderExample, hero: string) {
    try {
      await api.moveReaderExample(example, hero);
      await reload();
      onChanged();
    } catch (e) {
      setError(`Could not move the tile to ${hero}: ${(e as Error).message}`);
    }
  }

  async function remove(hero: string, example: ReaderExample) {
    try {
      await api.deleteReaderExample(example);
      await reload();
      onChanged();
    } catch (e) {
      setError(`Could not delete the tile of ${hero}: ${(e as Error).message}`);
    }
  }

  const needle = search.trim().toLowerCase();
  const heroes = (view?.heroes ?? [])
    .filter((h) => h.hero.toLowerCase().includes(needle))
    .map((h) => ({ ...h, examples: flaggedOnly ? h.examples.filter((e) => e.looksLike !== null) : h.examples }))
    .filter((h) => h.examples.length > 0);
  const total = view?.heroes.reduce((sum, h) => sum + h.examples.length, 0) ?? 0;

  return (
    <section>
      <div className="toolbar">
        <span className="muted">{total} tiles under {view?.heroes.length ?? 0} heroes</span>
      </div>
      <p className="muted">
        The hero reader names a tile by the closest of these tiles, each filed under the hero the player confirmed or corrected it to. A tile under the wrong hero makes the
        reader mistake that hero for the other one: delete it. An Example is only read by the reader; a Look is also shown to the Agent. "Looks like" marks a tile that the
        other tiles would read as another hero, which is where to look first. {view ? `${view.withoutExamples} heroes have no tile yet, so the reader cannot name them.` : ''}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="filters">
        <input placeholder="Search" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Looks like another hero
        </label>
      </div>
      {view && heroes.length === 0 && <p className="muted">{total === 0 ? 'The reader has learnt no tile yet.' : 'No tile matches.'}</p>}
      {heroes.map((h) => (
        <article key={h.hero} className="panel reader-hero" aria-label={h.hero}>
          <h3>
            {h.hero} <span className="muted">{h.examples.length}</span>
          </h3>
          <ul className="reader-tiles">
            {h.examples.map((e) => (
              <LookTile
                key={`${e.kind}-${e.id}`}
                src={readerExampleUrl(e)}
                alt={`${KIND_LABEL[e.kind]} of ${h.hero}`}
                caption={`${KIND_LABEL[e.kind]} · ${e.createdAt.slice(0, 10)}`}
                source={e.source}
                looksLike={e.looksLike}
                name={`${KIND_LABEL[e.kind].toLowerCase()} ${e.id} of ${h.hero}`}
                current={h.hero}
                options={heroNames}
                onMove={(hero) => void move(e, hero)}
                onDelete={() => void remove(h.hero, e)}
              />
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
