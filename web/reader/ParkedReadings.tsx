import { useCallback, useEffect, useRef, useState } from 'react';
import { api, parkedReadingUrl, type Hero, type ParkedList, type ParkedReading, type ParkKind } from '../backend.js';
import { HeroGrid } from '../HeroGrid.js';
import { Portrait } from '../Portrait.js';
import { Dialog } from '../ui/Dialog.js';
import { ListStatus } from '../ui/ListStatus.js';
import { useToast } from '../ui/Toast.js';

const PAGE = 20;
type Filter = 'all' | ParkKind;
type Counts = ParkedList['counts'];
const KIND_LABEL: Record<ParkKind, string> = { difference: 'Differences', unsure: 'Unsure' };
const waiting = (counts: Counts) => counts.difference + counts.unsure;

/** What the card says of the reading, in the player's words. */
function describe(r: ParkedReading): string {
  const side = `Side ${r.side}`;
  if (r.kind === 'unsure') return `${side}: the Agent was not sure of ${r.readHero ?? 'this hero'}, and you kept it.`;
  return r.readHero ? `${side}: the Agent read ${r.readHero}, and you did not keep it.` : `${side}: the Agent could not name this hero.`;
}

/** The candidate heroes of a card: the kept hero of an unsure reading first, then the others the reader suggests. */
const choicesOf = (r: ParkedReading): string[] => [...new Set([...(r.kind === 'unsure' && r.keptHero ? [r.keptHero] : []), ...r.candidates])];

/**
 * The readings of Battle imports that the hero reader could not learn from by itself (ADR 0040), for the player to say which hero each tile shows.
 * A confirmed tile becomes a Hero Example; one put aside is deleted. `onWaiting` reports how many readings wait, for the label of the tab.
 */
export function ParkedReadings({ onWaiting, onChanged }: { onWaiting: (count: number) => void; onChanged: () => void }) {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [entries, setEntries] = useState<ParkedReading[]>([]);
  const [info, setInfo] = useState<Pick<ParkedList, 'total' | 'counts' | 'caps'> | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [choosing, setChoosing] = useState<ParkedReading | null>(null);
  const [heroes, setHeroes] = useState<Hero[] | null>(null);
  // the answer of an older request is dropped when a newer one was made (another filter, another page)
  const latest = useRef(0);

  const load = useCallback(async (kind: Filter, offset: number) => {
    const mine = ++latest.current;
    try {
      const page = await api.parkedReadings(kind, offset, PAGE);
      if (mine !== latest.current) return;
      setEntries((old) => (offset === 0 ? page.entries : [...old, ...page.entries]));
      setInfo({ total: page.total, counts: page.counts, caps: page.caps });
      onWaiting(waiting(page.counts));
      setFailed(false);
      setError(null);
    } catch (e) {
      if (mine !== latest.current) return;
      setFailed(true);
      setError(`Could not read the readings to confirm: ${(e as Error).message}`);
    } finally {
      if (mine === latest.current) setMore(false);
    }
  }, [onWaiting]);

  useEffect(() => {
    setInfo(null);
    setEntries([]);
    void load(filter, 0);
  }, [filter, load]);

  /** The card leaves the list and the counts follow, without reading the list again. */
  const gone = (entry: ParkedReading) => {
    setEntries((old) => old.filter((e) => e.id !== entry.id));
    setInfo((old) => {
      if (!old) return old;
      const counts = { ...old.counts, [entry.kind]: old.counts[entry.kind] - 1 };
      onWaiting(waiting(counts));
      return { ...old, counts, total: old.total - 1 };
    });
  };

  async function confirm(entry: ParkedReading, hero: string) {
    try {
      const { learnt } = await api.confirmParkedReading(entry.id, hero);
      gone(entry);
      toast(learnt ? `Learnt: ${hero}` : `The reader already had a tile just like it for ${hero}: nothing added`);
      if (learnt) onChanged();
      setError(null);
    } catch (e) {
      setError(`Could not confirm ${hero}: ${(e as Error).message}`);
    }
  }

  async function dismiss(entry: ParkedReading) {
    try {
      await api.dismissParkedReading(entry.id);
      gone(entry);
      setError(null);
    } catch (e) {
      setError(`Could not dismiss the reading: ${(e as Error).message}`);
    }
  }

  function chooseOther(entry: ParkedReading) {
    setChoosing(entry);
    if (heroes === null) {
      api.heroes().then(setHeroes, (e: Error) => setError(`Could not read the heroes: ${e.message}`));
    }
  }

  const full = info ? (Object.keys(KIND_LABEL) as ParkKind[]).filter((k) => info.counts[k] >= info.caps[k]) : [];
  const shown = info?.total ?? 0;

  return (
    <section>
      <p className="muted">
        When a Battle import is saved, the tiles the hero reader could not learn from your corrections wait here: a hero you changed that could not be paired with the one that
        replaced it, and a hero the Agent was not sure of that you kept. Say which hero each tile shows and the reader learns it; put aside the ones you cannot tell.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {full.map((k) => (
        <p key={k} className="warn-text">
          The list of {KIND_LABEL[k].toLowerCase()} is full ({info!.caps[k]}): the next imports park no more of them until you confirm or put some aside.
        </p>
      ))}
      <div className="filters" role="group" aria-label="Kind of reading">
        {(['all', 'difference', 'unsure'] as const).map((k) => (
          <button key={k} aria-pressed={filter === k} className={filter === k ? 'active' : undefined} onClick={() => setFilter(k)}>
            {k === 'all' ? 'All' : KIND_LABEL[k]}
            {info ? ` (${k === 'all' ? waiting(info.counts) : info.counts[k]})` : ''}
          </button>
        ))}
      </div>
      <ListStatus loaded={info !== null} failed={failed} empty={entries.length === 0} filtered={filter !== 'all'} none="Nothing to confirm in Admin > Reader." noMatch={`No ${KIND_LABEL[filter as ParkKind]?.toLowerCase() ?? 'reading'} to confirm.`} />
      <ul className="parked-list" aria-label="Readings to confirm">
        {entries.map((entry) => (
          <li key={entry.id} className="parked-card" aria-label={`Reading ${entry.id}`}>
            <img className="crop" src={parkedReadingUrl(entry.id)} alt={`Tile ${entry.id} to confirm`} loading="lazy" />
            <p className="muted">{describe(entry)}</p>
            <div className="parked-choices">
              {choicesOf(entry).map((hero) => (
                <button key={hero} aria-label={`${entry.kind === 'unsure' && hero === entry.keptHero ? 'Yes, it is' : 'Confirm'} ${hero}`} onClick={() => void confirm(entry, hero)}>
                  <Portrait kind="hero" name={hero} size={28} />
                  {entry.kind === 'unsure' && hero === entry.keptHero ? `Yes, ${hero}` : hero}
                </button>
              ))}
            </div>
            <div className="parked-actions">
              <button className="small" onClick={() => chooseOther(entry)}>
                Other hero…
              </button>
              <button className="danger small" aria-label={`Dismiss reading ${entry.id}`} onClick={() => void dismiss(entry)}>
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
      {info && entries.length < shown && (
        <div className="actions">
          <button
            disabled={more}
            onClick={() => {
              setMore(true);
              void load(filter, entries.length);
            }}
          >
            Show more ({shown - entries.length} left)
          </button>
        </div>
      )}
      {choosing && (
        <Dialog
          title="Which hero is this?"
          onCancel={() => setChoosing(null)}
          closeOnBackdrop
          initialFocus="input"
          actions={
            <div className="overlay-actions">
              <button data-cancel onClick={() => setChoosing(null)}>
                Cancel
              </button>
            </div>
          }
        >
          <div className="parked-dialog">
            <img className="crop" src={parkedReadingUrl(choosing.id)} alt={`Tile ${choosing.id} to confirm`} />
            <div className="parked-dialog-grid">
              {heroes === null ? (
                <p className="muted">Loading…</p>
              ) : (
                <HeroGrid
                  heroes={heroes}
                  selected={null}
                  label="Heroes"
                  onPick={(hero) => {
                    const entry = choosing;
                    setChoosing(null);
                    void confirm(entry, hero);
                  }}
                />
              )}
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
