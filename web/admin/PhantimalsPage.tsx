import { useEffect, useMemo, useState } from 'react';
import { api, type Phantimal, type PhantimalUsage } from '../backend.js';
import { HeroIcons } from '../HeroIcons.js';
import { MultiSelect } from '../MultiSelect.js';
import { Portrait } from '../Portrait.js';
import { refreshUnitRules } from '../unit-rules.js';
import { useCatalogEditor } from '../hooks/catalogEditor.js';
import { useLoad } from '../hooks/load.js';
import { IconButton } from '../ui/Icon.js';
import { CatalogAdmin } from './CatalogAdmin.js';

const FACTIONS = ['Lightbearer', 'Wilder', 'Mauler', 'Graveborn', 'Celestial', 'Hypogean', 'Dimensional', 'Celestial-Hypogean'];
const CLASSES = ['Tank', 'Support', 'Marksman', 'Mage', 'Rogue', 'Warrior'];

interface Draft {
  name: string;
  faction: string;
  class: string;
  part: string;
  seasons: number[];
}

const NO_ITEMS: Phantimal[] = [];
const blank = (): Draft => ({ name: '', faction: '', class: '', part: '', seasons: [] });
const toDraft = (p: Phantimal): Draft => ({ name: p.name, faction: p.faction ?? '', class: p.class ?? '', part: p.part ?? '', seasons: p.seasons });
const same = (a: Draft, b: Draft) =>
  a.name === b.name && a.faction === b.faction && a.class === b.class && a.part === b.part && a.seasons.join() === b.seasons.join();

export function PhantimalsPage() {
  const loaded = useLoad(async () => {
    const list = await api.phantimals();
    await refreshUnitRules();
    return list;
  }, []);
  const items = loaded.data ?? NO_ITEMS;
  const [seasonInput, setSeasonInput] = useState('');
  const [usage, setUsage] = useState<PhantimalUsage | null>(null);
  const [search, setSearch] = useState('');
  const [seasonFilter, setSeasonFilter] = useState<string[]>([]);
  const reloadItems = loaded.reload;
  const editor = useCatalogEditor<Phantimal, Draft>({ items, reloadItems, keyOf: (p) => p.name, toDraft, blank, same });
  const { draft, setDraft, current, dirty, busy, selected } = editor;
  const error = loaded.error ?? editor.error;

  // What puts the selected phantimal on a team decides whether its second part can change.
  useEffect(() => {
    setUsage(null);
    if (selected === null) return;
    let stale = false;
    api.phantimalUsage(selected).then((u) => !stale && setUsage(u), () => undefined);
    return () => {
      stale = true;
    };
  }, [selected, items]);
  const locked = usage !== null && usage.placements > 0;

  const payload = () => ({
    name: draft.name,
    faction: draft.faction || null,
    class: draft.class || null,
    part: draft.part.trim() || null,
    seasons: draft.seasons,
  });
  const save = () => editor.save(() => (current ? api.savePhantimal(current.name, payload()) : api.createPhantimal(payload())));

  function addSeason() {
    const season = Number(seasonInput);
    if (Number.isInteger(season) && season >= 1 && !draft.seasons.includes(season)) {
      setDraft({ ...draft, seasons: [...draft.seasons, season].sort((a, b) => a - b) });
    }
    setSeasonInput('');
  }

  const allSeasons = useMemo(() => [...new Set(items.flatMap((p) => p.seasons))].sort((a, b) => b - a), [items]);
  const needle = search.trim().toLowerCase();
  const visible = items.filter((p) => (seasonFilter.length === 0 || p.seasons.some((s) => seasonFilter.includes(String(s)))) && (needle === '' || p.name.toLowerCase().includes(needle)));

  return (
    <>
      <CatalogAdmin
        label="Phantimals"
        noun="phantimal"
        total={items.length}
        items={visible}
        keyOf={(p) => p.name}
        selected={selected}
        open={editor.open}
        search={{ value: search, onChange: setSearch }}
        filters={<MultiSelect label="Season" options={allSeasons.map(String)} value={seasonFilter} onChange={setSeasonFilter} format={(s) => `Season ${s}`} />}
        row={(p) => (
          <>
            <span className="catalog-row">
              <Portrait kind="phantimal" name={p.name} size={32} />
              <span className="catalog-name">
                <span>{p.name}</span>
              </span>
              <HeroIcons row tier={null} heroClass={p.class} faction={p.faction} />
            </span>
            <span className="muted">{p.seasons.map((s) => `S${s}`).join(', ') || 'no season'}</span>
          </>
        )}
        title={current ? current.name : 'New phantimal'}
        error={error}
      >
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
            ? `This phantimal is placed on a map in ${usage.records} records and ${usage.deployments} Formation IDs and Round Deployments, so its second part cannot change.`
            : 'A phantimal that stands on two tiles, like Wedge of Matter with Wedge of Power, names its second part here. The part is not a phantimal: it has no faction or seasons and is placed with it.'}
        </p>

        <h3>Seasons</h3>
        <div className="chips">
          {draft.seasons.length === 0 && <span className="muted">Not available in any season yet</span>}
          {draft.seasons.map((s) => (
            <span key={s} className="chip">
              Season {s}
              <IconButton icon="close" label={`Remove season ${s}`} onClick={() => setDraft({ ...draft, seasons: draft.seasons.filter((x) => x !== s) })} />
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
          <button className="primary" onClick={() => void save()} disabled={busy || !dirty || draft.name.trim() === ''}>
            {current ? 'Save' : 'Create phantimal'}
          </button>
          {current && (
            <button className="danger" disabled={busy} onClick={() => void editor.remove(`Delete the phantimal "${current.name}"?`, () => api.deletePhantimal(current.name))}>
              Delete
            </button>
          )}
        </div>
      </CatalogAdmin>
      {editor.dialog}
    </>
  );
}
