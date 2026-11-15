import { useCallback, useEffect, useMemo, useState } from 'react';
import { artifactGroupProblem, seasonGroup } from '../../src/domain/artifact.js';
import { PRE_SEASON_GROUP } from '../../src/domain/stage.js';
import { api, type Artifact } from '../backend.js';
import { MultiSelect } from '../MultiSelect.js';
import { Portrait } from '../Portrait.js';
import { useCrud } from '../useCrud.js';
import { MasterDetail } from '../ui/MasterDetail.js';

interface Draft {
  name: string;
  seasonal: boolean;
  season: number | null;
}

const seasonOf = (group: string): number | null => (/^Season (\d+)$/.exec(group) ? Number(group.slice(7)) : null);
const toDraft = (a: Artifact): Draft => ({ name: a.name, seasonal: a.group !== PRE_SEASON_GROUP, season: seasonOf(a.group) });
const groupOf = (d: Draft): string => (d.seasonal && d.season !== null ? seasonGroup(d.season) : d.seasonal ? '' : PRE_SEASON_GROUP);
const sameDraft = (a: Draft, b: Draft) => a.name === b.name && groupOf(a) === groupOf(b);

/** The artifacts of the game: which ones are Pre-Season and which belong to one season. */
export function ArtifactsPage() {
  const [items, setItems] = useState<Artifact[]>([]);
  const [known, setKnown] = useState<number[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // null while adding
  const [draft, setDraft] = useState<Draft>({ name: '', seasonal: false, season: null });
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const { error, setError, run: act, confirmDelete, confirmDiscard, dialog } = useCrud();

  const blank = useCallback((): Draft => ({ name: '', seasonal: false, season: current }), [current]);
  const open_ = items.find((a) => a.name === selected) ?? null;
  const dirty = open_ ? !sameDraft(draft, toDraft(open_)) : draft.name !== '';

  const reload = useCallback(async (select?: string | null) => {
    const loaded = await api.artifacts();
    setItems(loaded);
    if (select !== undefined) {
      setSelected(select);
      const item = loaded.find((a) => a.name === select);
      setDraft(item ? toDraft(item) : { name: '', seasonal: false, season: null });
    }
  }, []);

  useEffect(() => {
    void act(() => reload());
    api.seasons().then(
      (seasons) => {
        setKnown(seasons.map((s) => s.number));
        setCurrent(seasons.find((s) => s.current)?.number ?? null);
      },
      () => undefined, // the season list is only a convenience: the artifacts' own seasons are offered too
    );
  }, [act, reload]);

  const run = (action: () => Promise<string | null | undefined>) => act(action, reload);

  async function open(name: string | null) {
    if (
      dirty &&
      !(await confirmDiscard())
    )
      return;
    setError(null);
    setSelected(name);
    const item = items.find((a) => a.name === name);
    setDraft(item ? toDraft(item) : blank());
  }

  const group = groupOf(draft);
  const problem = draft.name.trim() === '' ? 'An artifact needs a name' : artifactGroupProblem(group) ? 'Choose the season' : null;
  const payload = () => ({ name: draft.name, group });
  const save = () => run(async () => (open_ ? await api.saveArtifact(open_.name, payload()) : await api.createArtifact(payload())).name);
  const remove = async () => {
    if (
      await confirmDelete(`Delete the artifact "${open_!.name}"?`)
    ) {
      void run(async () => {
        await api.deleteArtifact(open_!.name);
        return null;
      });
    }
  };

  const seasons = useMemo(() => [...new Set([...known, ...items.map((a) => seasonOf(a.group)).filter((s): s is number => s !== null), ...(draft.season === null ? [] : [draft.season])])].sort((a, b) => b - a), [known, items, draft.season]);
  const groups = useMemo(() => [...new Set(items.map((a) => a.group))].sort((a, b) => (seasonOf(b) ?? 0) - (seasonOf(a) ?? 0)), [items]);
  const visible = items.filter((a) => (groupFilter.length === 0 || groupFilter.includes(a.group)) && a.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <MasterDetail
        header={
          <div className="toolbar">
            <span className="muted">{items.length} artifacts</span>
            <button onClick={() => void open(null)}>New artifact</button>
          </div>
        }
        sidebarLabel="Artifacts"
        sidebarHeader={
          <div className="filters">
            <input placeholder="Search" aria-label="Search artifacts" value={search} onChange={(e) => setSearch(e.target.value)} />
            <MultiSelect label="Group" options={groups} value={groupFilter} onChange={setGroupFilter} />
          </div>
        }
        sidebar={
          <ul className="master-detail-list" aria-label="Artifacts">
            {visible.map((a) => (
              <li key={a.name}>
                <button className={a.name === selected ? 'map-item active' : 'map-item'} onClick={() => void open(a.name)}>
                  <span className="with-portrait">
                    <Portrait kind="artifact" name={a.name} size={32} />
                    {a.name}
                  </span>
                  <span className="muted">{a.group}</span>
                </button>
              </li>
            ))}
          </ul>
        }
        detailLabel={open_ ? `Artifact details for ${open_.name}` : 'New artifact details'}
        detailHeader={<h3>{open_ ? open_.name : 'New artifact'}</h3>}
        detailKey={selected}
        detail={
          <div className="map-editor">
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="filters">
              <label className="field">
                Name
                <input aria-label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
            </div>
            <div className="filters">
              <fieldset className="field">
                <legend>Group</legend>
                <label className="check">
                  <input type="radio" name="artifact-group" checked={!draft.seasonal} onChange={() => setDraft({ ...draft, seasonal: false })} /> Pre-Season
                </label>
                <label className="check">
                  <input type="radio" name="artifact-group" checked={draft.seasonal} onChange={() => setDraft({ ...draft, seasonal: true, season: draft.season ?? current })} /> Seasonal
                </label>
              </fieldset>
              {draft.seasonal && (
                <label className="field">
                  Season
                  <select aria-label="Season" value={draft.season ?? ''} onChange={(e) => setDraft({ ...draft, season: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">Choose a season</option>
                    {seasons.map((s) => (
                      <option key={s} value={s}>
                        Season {s}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p className="muted">
              {open_ && `${open_.uses ?? 0} ${open_.uses === 1 ? 'record uses' : 'records use'} it.`}
              {open_ && (open_.source === 'manual' ? ' Edited by you: an import leaves it alone.' : ' From the import: saving a change makes it yours, and an import then leaves it alone.')}
            </p>
            <div className="actions">
              <button className="primary" onClick={() => void save()} disabled={!dirty || problem !== null} title={problem ?? undefined}>
                {open_ ? 'Save' : 'Create artifact'}
              </button>
              {open_ && (
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
