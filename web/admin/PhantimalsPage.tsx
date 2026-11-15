import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Phantimal, type PhantimalUsage } from '../backend.js';
import { MultiSelect } from '../MultiSelect.js';
import { Portrait } from '../Portrait.js';
import { refreshUnitRules } from '../unit-rules.js';
import { useCrud } from '../useCrud.js';
import { MasterDetail } from '../ui/MasterDetail.js';

const FACTIONS = ['Lightbearer', 'Wilder', 'Mauler', 'Graveborn', 'Celestial', 'Hypogean', 'Dimensional', 'Celestial-Hypogean'];
const CLASSES = ['Tank', 'Support', 'Marksman', 'Mage', 'Rogue', 'Warrior'];

interface Draft {
  name: string;
  faction: string;
  class: string;
  part: string;
  seasons: number[];
}

const blank = (): Draft => ({ name: '', faction: '', class: '', part: '', seasons: [] });
const toDraft = (p: Phantimal): Draft => ({ name: p.name, faction: p.faction ?? '', class: p.class ?? '', part: p.part ?? '', seasons: p.seasons });
const same = (a: Draft, b: Draft) =>
  a.name === b.name && a.faction === b.faction && a.class === b.class && a.part === b.part && a.seasons.join() === b.seasons.join();

export function PhantimalsPage() {
  const [items, setItems] = useState<Phantimal[]>([]);
  const [selected, setSelected] = useState<string | null>(null); // null while creating
  const [draft, setDraft] = useState<Draft>(blank());
  const [seasonInput, setSeasonInput] = useState('');
  const [usage, setUsage] = useState<PhantimalUsage | null>(null);
  const [seasonFilter, setSeasonFilter] = useState<string[]>([]);
  const { error, setError, run: act, confirmDelete, confirmDiscard, dialog } = useCrud();

  const current = items.find((p) => p.name === selected) ?? null;
  const dirty = current ? !same(draft, toDraft(current)) : draft.name !== '' || draft.seasons.length > 0;

  const reload = useCallback(async (select?: string | null) => {
    const loaded = await api.phantimals();
    setItems(loaded);
    await refreshUnitRules();
    if (select !== undefined) {
      setSelected(select);
      const item = loaded.find((p) => p.name === select);
      setDraft(item ? toDraft(item) : blank());
    }
  }, []);

  useEffect(() => {
    void act(() => reload());
  }, [act, reload]);

  // What puts the selected phantimal on a board decides whether its second part can change.
  useEffect(() => {
    setUsage(null);
    if (selected === null) return;
    let stale = false;
    api.phantimalUsage(selected).then((u) => !stale && setUsage(u), () => undefined);
    return () => {
      stale = true;
    };
  }, [selected, items]);
  const locked = usage !== null && usage.onBoard > 0;

  const run = (action: () => Promise<string | null | undefined>) => act(action, reload);

  async function open(name: string | null) {
    if (
      dirty &&
      !(await confirmDiscard())
    )
      return;
    setError(null);
    setSelected(name);
    const item = items.find((p) => p.name === name);
    setDraft(item ? toDraft(item) : blank());
  }

  const payload = () => ({
    name: draft.name,
    faction: draft.faction || null,
    class: draft.class || null,
    part: draft.part.trim() || null,
    seasons: draft.seasons,
  });
  const save = () =>
    run(async () => (current ? await api.savePhantimal(current.name, payload()) : await api.createPhantimal(payload())).name);
  const remove = async () => {
    if (
      await confirmDelete(`Delete the phantimal "${current!.name}"?`)
    ) {
      void run(async () => {
        await api.deletePhantimal(current!.name);
        return null;
      });
    }
  };

  function addSeason() {
    const season = Number(seasonInput);
    if (Number.isInteger(season) && season >= 1 && !draft.seasons.includes(season)) {
      setDraft({ ...draft, seasons: [...draft.seasons, season].sort((a, b) => a - b) });
    }
    setSeasonInput('');
  }

  const allSeasons = useMemo(() => [...new Set(items.flatMap((p) => p.seasons))].sort((a, b) => b - a), [items]);
  const visible = items.filter((p) => seasonFilter.length === 0 || p.seasons.some((s) => seasonFilter.includes(String(s))));

  return (
    <>
      <MasterDetail
        header={
          <div className="toolbar">
            <span className="muted">{items.length} phantimals</span>
            <button onClick={() => void open(null)}>New phantimal</button>
          </div>
        }
        sidebarLabel="Phantimals"
        sidebarHeader={
          <div className="filters">
            <MultiSelect label="Season" options={allSeasons.map(String)} value={seasonFilter} onChange={setSeasonFilter} format={(s) => `Season ${s}`} />
          </div>
        }
        sidebar={
          <ul className="master-detail-list" aria-label="Phantimals">
            {visible.map((p) => (
              <li key={p.name}>
                <button className={p.name === selected ? 'map-item active' : 'map-item'} onClick={() => void open(p.name)}>
                  <span className="with-portrait">
                    <Portrait kind="phantimal" name={p.name} size={32} />
                    {p.name}
                  </span>
                  <span className="muted">
                    {[p.class, p.faction].filter(Boolean).join(' · ')} · {p.seasons.map((s) => `S${s}`).join(', ') || 'no season'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        }
        detailLabel={current ? `Phantimal details for ${current.name}` : 'New phantimal details'}
        detailHeader={<h3>{current ? current.name : 'New phantimal'}</h3>}
        detailKey={selected}
        detail={
          <div className="map-editor">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="filters">
              <input placeholder="Name" aria-label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <select aria-label="Faction" value={draft.faction} onChange={(e) => setDraft({ ...draft, faction: e.target.value })}>
                <option value="">No faction</option>
                {FACTIONS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <select aria-label="Class" value={draft.class} onChange={(e) => setDraft({ ...draft, class: e.target.value })}>
                <option value="">No class</option>
                {CLASSES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>

            <h3>Second part</h3>
            <div className="filters">
              <input placeholder="No second part" aria-label="Second part" value={draft.part} disabled={locked} onChange={(e) => setDraft({ ...draft, part: e.target.value })} />
            </div>
            <p className="muted">
              {locked
                ? `This phantimal is on a board in ${usage.records} records and ${usage.deployments} Formation IDs and Round Deployments, so its second part cannot change.`
                : 'A phantimal that stands on two tiles, like Wedge of Matter with Wedge of Power, names its second part here. The part is not a phantimal: it has no faction or seasons and is placed with it.'}
            </p>

            <h3>Seasons</h3>
            <div className="chips">
              {draft.seasons.length === 0 && <span className="muted">Not available in any season yet</span>}
              {draft.seasons.map((s) => (
                <span key={s} className="chip">
                  Season {s}
                  <button
                    aria-label={`Remove season ${s}`}
                    onClick={() => setDraft({ ...draft, seasons: draft.seasons.filter((x) => x !== s) })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="filters">
              <input
                type="number"
                min={1}
                placeholder="Season number"
                aria-label="Season number"
                value={seasonInput}
                onChange={(e) => setSeasonInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSeason()}
              />
              <button onClick={addSeason}>Add season</button>
            </div>

            <div className="actions">
              <button className="primary" onClick={() => void save()} disabled={!dirty || draft.name.trim() === ''}>
                {current ? 'Save' : 'Create phantimal'}
              </button>
              {current && (
                <button className="danger" onClick={() => void remove()}>
                  Delete
                </button>
              )}
            </div>
          </div>
        }
      />
      {dialog}
    </>
  );
}
