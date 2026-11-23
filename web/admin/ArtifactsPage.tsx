import { useCallback, useMemo, useState } from 'react';
import { artifactGroupProblem, seasonGroup } from '../../src/domain/artifact.js';
import { PRE_SEASON_GROUP } from '../../src/domain/stage.js';
import { api, type Artifact, type SeasonEntry } from '../backend.js';
import { MultiSelect } from '../MultiSelect.js';
import { Portrait } from '../Portrait.js';
import { useCatalogEditor } from '../hooks/catalogEditor.js';
import { useLoad } from '../hooks/load.js';
import { CatalogAdmin } from './CatalogAdmin.js';

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
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string[]>([]);

  const blank = useCallback((): Draft => ({ name: '', seasonal: false, season: current }), [current]);
  const reloadItems = loaded.reload;
  const editor = useCatalogEditor<Artifact, Draft>({ items, reloadItems, keyOf: (a) => a.name, toDraft, blank, same: sameDraft });
  const { draft, setDraft, current: open_, dirty, busy } = editor;
  const error = loaded.error ?? editor.error;

  const group = groupOf(draft);
  const problem = draft.name.trim() === '' ? 'An artifact needs a name' : artifactGroupProblem(group) ? 'Choose the season' : null;
  const payload = () => ({ name: draft.name, group });
  const save = () => editor.save(() => (open_ ? api.saveArtifact(open_.name, payload()) : api.createArtifact(payload())));

  const seasons = useMemo(() => [...new Set([...known, ...items.map((a) => seasonOf(a.group)).filter((s): s is number => s !== null), ...(draft.season === null ? [] : [draft.season])])].sort((a, b) => b - a), [known, items, draft.season]);
  const groups = useMemo(() => [...new Set(items.map((a) => a.group))].sort((a, b) => (seasonOf(b) ?? 0) - (seasonOf(a) ?? 0)), [items]);
  const visible = items.filter((a) => (groupFilter.length === 0 || groupFilter.includes(a.group)) && a.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <CatalogAdmin
        label="Artifacts"
        noun="artifact"
        total={items.length}
        items={visible}
        keyOf={(a) => a.name}
        selected={editor.selected}
        open={editor.open}
        search={{ value: search, onChange: setSearch }}
        filters={<MultiSelect label="Group" options={groups} value={groupFilter} onChange={setGroupFilter} />}
        row={(a) => (
          <>
            <span className="with-portrait">
              <Portrait kind="artifact" name={a.name} size={32} />
              {a.name}
            </span>
            <span className="muted">{a.group}</span>
          </>
        )}
        title={open_ ? open_.name : 'New artifact'}
        error={error}
      >
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
            <button className="danger" disabled={busy} onClick={() => void editor.remove(`Delete the artifact "${open_.name}"?`, () => api.deleteArtifact(open_.name))}>
              Delete
            </button>
          )}
        </div>
      </CatalogAdmin>
      {editor.dialog}
    </>
  );
}
