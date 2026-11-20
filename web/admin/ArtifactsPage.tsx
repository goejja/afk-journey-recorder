import { useCallback, useMemo, useState } from 'react';
import { artifactGroupProblem, seasonGroup } from '../../src/domain/artifact.js';
import { PRE_SEASON_GROUP } from '../../src/domain/stage.js';
import { api, type Artifact, type SeasonEntry } from '../backend.js';
import { MultiSelect } from '../MultiSelect.js';
import { Portrait } from '../Portrait.js';
import { useAction } from '../hooks/action.js';
import { useConfirmActions } from '../hooks/confirm.js';
import { useLoad } from '../hooks/load.js';
import { MasterDetail } from '../ui/MasterDetail.js';
import { Notice } from '../ui/Notice.js';

interface Draft {
  name: string;
  seasonal: boolean;
  season: number | null;
}

const NO_ITEMS: Artifact[] = [];
const NO_SEASONS: number[] = [];
const seasonOf = (group: string): number | null => (/^Season (\d+)$/.exec(group) ? Number(group.slice(7)) : null);
const toDraft = (a: Artifact): Draft => ({ name: a.name, seasonal: a.group !== PRE_SEASON_GROUP, season: seasonOf(a.group) });
const groupOf = (d: Draft): string => (d.seasonal && d.season !== null ? seasonGroup(d.season) : d.seasonal ? '' : PRE_SEASON_GROUP);
const sameDraft = (a: Draft, b: Draft) => a.name === b.name && groupOf(a) === groupOf(b);

/** The artifacts of the game: which ones are Pre-Season and which belong to one season. */
export function ArtifactsPage() {
  const loaded = useLoad(() => api.artifacts(), []);
  const items = loaded.data ?? NO_ITEMS;
  // the season list is only a convenience: the artifacts' own seasons are offered too, so a failure to read it is not shown
  const seasonList = useLoad(() => api.seasons().catch(() => [] as SeasonEntry[]), []);
  const known = useMemo(() => seasonList.data?.map((s) => s.number) ?? NO_SEASONS, [seasonList.data]);
  const current = seasonList.data?.find((s) => s.current)?.number ?? null;
  const [selected, setSelected] = useState<string | null>(null); // null while adding
  const [draft, setDraft] = useState<Draft>({ name: '', seasonal: false, season: null });
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const { error: actionError, busy, setError, run: act } = useAction();
  const error = loaded.error ?? actionError;
  const { confirmDelete, confirmDiscard, dialog } = useConfirmActions(act);

  const blank = useCallback((): Draft => ({ name: '', seasonal: false, season: current }), [current]);
  const open_ = items.find((a) => a.name === selected) ?? null;
  const dirty = open_ ? !sameDraft(draft, toDraft(open_)) : draft.name !== '';

  // reads the artifacts again; with `select` (a saved artifact's name, or null for a new one) the page then opens it
  const reloadItems = loaded.reload;
  const reload = useCallback(
    async (select?: string | null) => {
      const list = await reloadItems();
      if (list && select !== undefined) {
        setSelected(select);
        const item = list.find((a) => a.name === select);
        setDraft(item ? toDraft(item) : { name: '', seasonal: false, season: null });
      }
    },
    [reloadItems],
  );

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
              <Notice kind="error">
                {error}
              </Notice>
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
              <button className="primary" onClick={() => void save()} disabled={busy || !dirty || problem !== null} title={problem ?? undefined}>
                {open_ ? 'Save' : 'Create artifact'}
              </button>
              {open_ && (
                <button className="danger" disabled={busy} onClick={() => void remove()}>
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
