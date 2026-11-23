import { useCallback, useMemo, useState } from 'react';
import { MAP_TAGS, TILE, TILE_COUNT } from '../../src/domain/map.js';
import { api, type GameMap } from '../backend.js';
import { HexMap, Legend } from '../HexMap.js';
import { TilePopover } from '../TilePopover.js';
import { useNameDialog } from '../ui/Dialog.js';
import { useAction } from '../hooks/action.js';
import { useConfirmActions } from '../hooks/confirm.js';
import { useLoad } from '../hooks/load.js';
import { MasterDetail } from '../ui/MasterDetail.js';
import { Notice } from '../ui/Notice.js';

interface Draft {
  name: string;
  tags: string[];
  cells: number[];
  boostTiles: number[];
}


const NO_MAPS: GameMap[] = [];
const blankDraft = (): Draft => ({ name: '', tags: ['Stage'], cells: Array(TILE_COUNT).fill(TILE.OPEN), boostTiles: [] });
const toDraft = (map: GameMap): Draft => ({ name: map.name, tags: map.tags, cells: map.cells, boostTiles: map.boostTiles });
const sameDraft = (a: Draft, b: Draft) =>
  a.name === b.name && a.tags.join() === b.tags.join() && a.cells.join() === b.cells.join() && a.boostTiles.join() === b.boostTiles.join();

export function MapsPage() {
  const loaded = useLoad(() => api.maps(), []);
  const maps = loaded.data ?? NO_MAPS;
  const [selected, setSelected] = useState<string | null>(null); // null while creating a new map
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  /** The tile whose type and Boost are being set, with the button it was clicked on. */
  const [editing, setEditing] = useState<{ index: number; anchor: HTMLElement } | null>(null);
  const { error: actionError, busy, setError, run: act } = useAction();
  const error = loaded.error ?? actionError;
  const { confirmDelete, confirmDiscard, confirmRun, dialog } = useConfirmActions(act);
  const { name: askName, dialog: nameDialog } = useNameDialog();

  const current = maps.find((m) => m.name === selected) ?? null;
  const dirty = current ? !sameDraft(draft, toDraft(current)) : draft.name !== '' || draft.cells.some((c) => c !== TILE.OPEN);

  // reads the maps again; with `select` (a saved map's name, or null for a new one) the page then opens it
  const reloadMaps = loaded.reload;
  const reload = useCallback(
    async (select?: string | null) => {
      const list = await reloadMaps();
      if (list && select !== undefined) {
        setEditing(null);
        setSelected(select);
        const map = list.find((m) => m.name === select);
        setDraft(map ? toDraft(map) : blankDraft());
      }
    },
    [reloadMaps],
  );

  const run = (action: () => Promise<string | null | undefined>) => act(action, reload);

  async function open(name: string | null) {
    if (
      dirty &&
      !(await confirmDiscard())
    )
      return;
    setError(null);
    setEditing(null);
    const map = maps.find((m) => m.name === name);
    setSelected(name);
    setDraft(map ? toDraft(map) : blankDraft());
  }

  const save = () =>
    run(async () => {
      const saved = current ? await api.saveMap(current.name, draft) : await api.createMap(draft);
      return saved.name;
    });

  const duplicate = async () => {
    const name = await askName({ title: 'Name for the copy', initialValue: `${draft.name} copy`, confirmLabel: 'Duplicate' });
    if (name) void run(async () => (await api.duplicateMap(current!.name, name)).name);
  };

  const remove = async () => {
    if (
      await confirmDelete(`Delete the map "${current!.name}"?`)
    ) {
      void run(async () => {
        await api.deleteMap(current!.name);
        return null;
      });
    }
  };

  const restore = () =>
    confirmRun({ title: `Replace your edits to "${current!.name}" with the imported original?`, confirmLabel: 'Replace' }, async () => (await api.restoreMap(current!.name)).name, reload);

  const visible = useMemo(
    () =>
      maps.filter(
        (m) =>
          (!search || m.name.toLowerCase().includes(search.toLowerCase())) && (!tagFilter || m.tags.includes(tagFilter)),
      ),
    [maps, search, tagFilter],
  );

  function toggleTag(tag: string) {
    setDraft((d) => ({ ...d, tags: d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag].sort() }));
  }

  return (
    <>
      <MasterDetail
        header={
          <div className="toolbar">
            <span className="muted">{maps.length} maps</span>
            <button onClick={() => void open(null)}>New map</button>
          </div>
        }
        sidebarLabel="Maps"
        sidebarHeader={
          <div className="filters">
            <input placeholder="Search maps" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select aria-label="Tag" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              <option value="">All tags</option>
              {MAP_TAGS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        }
        sidebar={
          <ul className="master-detail-list" aria-label="Maps">
            {visible.map((m) => (
              <li key={m.name}>
                <button className={m.name === selected ? 'map-item active' : 'map-item'} onClick={() => void open(m.name)}>
                  <span>{m.name}</span>
                  <span className="muted">
                    {m.tags.join(', ') || 'no tag'}
                    {m.source === 'manual' && m.canRestore ? ' · edited' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        }
        detailLabel={current ? `Map details for ${current.name}` : 'New map details'}
        detailHeader={<h3>{current ? current.name : 'New map'}</h3>}
        detailKey={selected}
        detail={
          <div className="map-editor">
            {error && (
              <Notice kind="error">
                {error}
              </Notice>
            )}
            <div className="filters">
              <input
                placeholder="Map name"
                aria-label="Map name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              {MAP_TAGS.map((tag) => (
                <label key={tag} className="check">
                  <input type="checkbox" checked={draft.tags.includes(tag)} onChange={() => toggleTag(tag)} /> {tag}
                </label>
              ))}
            </div>

            <HexMap
              rowLengths={current?.rowLengths ?? [2, 5, 6, 6, 7, 6, 6, 5, 2]}
              cells={draft.cells}
              boostTiles={draft.boostTiles}
              onTileClick={(index, anchor) => setEditing((old) => (old?.index === index ? null : { index, anchor }))}
            />
            <p className="muted">Click a tile to set its type and its Boost. The enemy deploys on the top half, you on the bottom.</p>
            {editing && (
              <TilePopover
                anchor={editing.anchor}
                index={editing.index}
                tile={draft.cells[editing.index]!}
                boosted={draft.boostTiles.includes(editing.index)}
                onChange={(tile, boosted) =>
                  setDraft((d) => ({
                    ...d,
                    cells: d.cells.map((c, i) => (i === editing.index ? tile : c)),
                    boostTiles: (boosted ? [...d.boostTiles.filter((t) => t !== editing.index), editing.index] : d.boostTiles.filter((t) => t !== editing.index)).sort((x, y) => x - y),
                  }))
                }
                onClose={() => setEditing(null)}
              />
            )}
            <Legend boost />

            {current?.handMade && <p className="muted">Not on Yaphalla yet: the next import takes over its tiles.</p>}
            <div className="actions">
              <button className="primary" onClick={() => void save()} disabled={busy || !dirty || draft.name.trim() === ''}>
                {current ? 'Save' : 'Create map'}
              </button>
              {current && (
                <>
                  <button disabled={busy} onClick={() => void duplicate()}>Duplicate</button>
                  <button onClick={() => void restore()} disabled={busy || !current.canRestore}>
                    Restore original
                  </button>
                  <button className="danger" disabled={busy} onClick={() => void remove()}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        }
      />
      {dialog}
      {nameDialog}
    </>
  );
}
