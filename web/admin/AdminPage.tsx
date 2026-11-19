import { FormationIdsAdmin } from './FormationIdsAdmin.js';
import { useCallback, useEffect, useState } from 'react';
import { allowsRule, DEFAULT_MODES, DEFAULT_SLOTS, emptySlot } from '../../src/domain/defaults.js';
import { MapPicker } from '../MapPicker.js';
import { urlOf } from '../../src/shared/contract.js';
import { adminContract } from '../../src/shared/contracts/admin.js';
import { ScoreSettingsAdmin } from '../advisor/index.js';
import { api, type AgentSettings, type Boss, type CounterRuleView, type BossRule, type DefaultMode, type DefaultSlot, type GameMap, type StatsSettingsView, type WeeklySetups, type SeasonEntry } from '../backend.js';
import { BossRules } from '../dream-hunt/BossRules.js';
import { CleanupPage } from '../reader/CleanupPage.js';
import { ImagesPage } from '../reader/ImagesPage.js';
import { MapsPage } from './MapsPage.js';
import { ArtifactsPage } from './ArtifactsPage.js';
import { UnitsPage } from './UnitsPage.js';
import { ReaderPage } from '../reader/ReaderPage.js';
import { ReviewPage } from '../reader/ReviewPage.js';
import { useCrud } from '../useCrud.js';
import { RecordRow } from '../ui/RecordRow.js';

/** The modes the Statistics page starts with: a starting choice of its Mode filter, which the page can still change. */
function StatsSettingsAdmin() {
  const [view, setView] = useState<StatsSettingsView | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const { error, message, run } = useCrud();

  const show = (v: StatsSettingsView) => (setView(v), setDraft(v.modes));
  useEffect(() => {
    void run(() => api.statsSettings(), show);
  }, [run]);

  if (!view) return error ? <p className="error" role="alert">{error}</p> : null;
  return (
    <>
      <h3>Statistics</h3>
      <p className="muted">
        The Statistics page starts with these modes selected in its Mode filter. It is only a starting choice: the page can still show other modes, and none ticked
        starts it with every mode. The query command always counts every mode unless it is given one.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="actions" role="group" aria-label="Statistics starts with these modes">
        {view.available.map((m) => (
          <label key={m} className="check">
            <input type="checkbox" checked={draft.includes(m)} onChange={() => setDraft(view.available.filter((o) => (o === m ? !draft.includes(m) : draft.includes(o))))} /> {m}
          </label>
        ))}
      </div>
      <div className="actions">
        <button className="primary" onClick={() => void run(() => api.saveStatsSettings(draft), show, 'Saved.')}>Save modes</button>
        <button onClick={() => void run(() => api.resetStatsSettings(), show, 'Back to the PvP modes.')}>Use the PvP modes</button>
      </div>
    </>
  );
}

/** When a Formation group counts as a counter of another in Statistics, the Counter Advisor and the query command (ADR 0039). */
function CounterRuleAdmin() {
  const [view, setView] = useState<CounterRuleView | null>(null);
  const [rate, setRate] = useState('');
  const [games, setGames] = useState('');
  const { error, message, run } = useCrud();

  const show = (v: CounterRuleView) => (setView(v), setRate(String(Math.round(v.winRate * 1000) / 10)), setGames(String(v.minGames)));
  useEffect(() => {
    void run(() => api.counterRule(), show);
  }, [run]);

  if (!view) return error ? <p className="error" role="alert">{error}</p> : null;
  return (
    <>
      <h3>Counters</h3>
      <p className="muted">
        A Formation group counters another when it met it in at least this many games and won at least this share of them. A record with fewer games is shown as
        anecdote and is never called a counter. The Statistics page, the Counter Advisor and the query command use this rule; it changes no Win Score.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="actions">
        <label className="field" title="From 50 to 100">
          Counter win rate (%)
          <input type="number" min={50} max={100} step={1} value={rate} onChange={(e) => setRate(e.target.value)} />
          <span className="muted">default {Math.round(view.defaults.winRate * 100)}</span>
        </label>
        <label className="field" title="From 1 to 50">
          Minimum games
          <input type="number" min={1} max={50} step={1} value={games} onChange={(e) => setGames(e.target.value)} />
          <span className="muted">default {view.defaults.minGames}</span>
        </label>
      </div>
      <div className="actions">
        <button className="primary" onClick={() => void run(() => api.saveCounterRule({ winRate: Number(rate) / 100, minGames: Number(games) }), show, 'Saved.')}>Save counter rule</button>
        <button onClick={() => void run(() => api.resetCounterRule(), show, 'Back to the default rule.')}>Use the default rule</button>
      </div>
    </>
  );
}

/** The day of the latest game update, from which Dream Hunt's Advisor counts fights as fresh evidence. */
function UpdateDateAdmin() {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const { error, run: act } = useCrud();

  const show = (v: { date: string | null }) => (setSaved(v.date), setDraft(v.date ?? ''));
  useEffect(() => {
    void act(() => api.updateDate(), show);
  }, [act]);
  const run = (action: () => Promise<{ date: string | null }>) => act(action, show);

  return (
    <>
      <h3>Game update</h3>
      <p className="muted">
        The day of the latest game update, which may have boosted Dream Hunt bosses. The Advisor then treats the fights from this day on as fresh evidence and shows
        them apart from the older ones. Leave it empty to count every fight alike.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <label className="field">
          Update date
          <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button className="primary" disabled={draft === '' || draft === saved} onClick={() => void run(() => api.saveUpdateDate(draft))}>Save date</button>
        <button disabled={saved === null} onClick={() => void run(() => api.clearUpdateDate())}>Clear date</button>
      </div>
    </>
  );
}

/** Settings of the app itself: the list of seasons and which one is the current one, and the Win Score tuning. */
function GeneralAdmin() {
  const [seasons, setSeasons] = useState<SeasonEntry[] | null>(null);
  const [number, setNumber] = useState('');
  const { error, run: act } = useCrud();

  useEffect(() => {
    void act(() => api.seasons(), setSeasons);
  }, [act]);
  const run = (action: () => Promise<SeasonEntry[]>) => act(action, setSeasons);

  return (
    <section>
      <h3>Seasons</h3>
      <p className="muted">
        The current season is the one every new record is played in (a Battle of a Tournament takes the Tournament's), and where new stages start, and the artifacts offered first.
        A season that stages, phantimals, records or Tournaments already name cannot be removed.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <label className="field">
          New season
          <input type="number" min={1} max={999} value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
        <button
          className="primary"
          disabled={number === ''}
          onClick={() => void run(() => api.addSeason(Number(number))).then((worked) => worked && setNumber(''))}
        >
          Add season
        </button>
      </div>
      <ul className="attempts" aria-label="Seasons">
        {seasons?.map((s) => (
          <li key={s.number} className="attempt">
            <RecordRow
              actions={
                <>
                  <button disabled={s.current} onClick={() => void run(() => api.setCurrentSeason(s.number))}>
                    Make current
                  </button>
                  <button className="danger" disabled={s.current || s.stages + s.phantimals + s.records + s.tournaments > 0} onClick={() => void run(() => api.deleteSeason(s.number))}>
                    Remove
                  </button>
                </>
              }
            >
              <strong>Season {s.number}</strong>
              {s.current && <span className="badge">current</span>}
              <span className="muted">
                {s.stages} stages · {s.phantimals} phantimals · {s.records} records
              </span>
            </RecordRow>
          </li>
        ))}
      </ul>
      <UpdateDateAdmin />
      <ScoreSettingsAdmin />
      <StatsSettingsAdmin />
      <CounterRuleAdmin />
    </section>
  );
}

/** Rules that boost you, edited here only. */
function RulesAdmin() {
  const [rules, setRules] = useState<BossRule[] | null>(null);
  const { error, run } = useCrud();
  const reload = useCallback(() => run(() => api.bossRules(), setRules), [run]);
  useEffect(() => void reload(), [reload]);
  return (
    <section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {rules && <BossRules rules={rules} onChanged={reload} />}
    </section>
  );
}

/** Which agent answers scenarios when started from the Scenarios tab, found on this computer. */
function AgentAdmin() {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [looking, setLooking] = useState(false);
  const { error, message, setMessage, run } = useCrud();

  const look = useCallback(async () => {
    setLooking(true);
    await run(() => api.refreshAgentTools(), (found) => setSettings((current) => (current ? { ...current, tools: found.tools } : found)));
    setLooking(false);
  }, [run]);

  useEffect(() => {
    void run(
      () => api.agentSettings(),
      (loaded) => {
        setSettings(loaded);
        if (Object.keys(loaded.tools).length === 0) void look();
      },
    );
  }, [run, look]);

  const save = () => settings && run(() => api.saveAgentSettings(settings), (saved) => setSettings({ ...saved, tools: settings.tools }), 'Saved.');

  const change = (patch: Partial<AgentSettings>) => {
    setSettings((s) => s && { ...s, ...patch });
    setMessage(null);
  };

  const tool = settings?.tools[settings.preset];
  const models = tool?.models ?? [];

  return (
    <section>
      <p className="muted">
        The Run estimate button on a scenario starts this agent in the background. It can only read your recorded history; the app saves its reply as the
        scenario's estimate. The agents are fixed in the code and are looked for on this computer's PATH; there is no path to type.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {settings && (
        <>
          <div className="filters">
            <label className="field">
              Agent
              <select value={settings.preset} onChange={(e) => change({ preset: e.target.value })}>
                {settings.presets.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                    {settings.tools[preset] && !settings.tools[preset]!.installed ? ' (not installed)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Model
              <input list="agent-models" value={settings.model} onChange={(e) => change({ model: e.target.value.trim() })} />
              <datalist id="agent-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label className="field">
              Time limit (minutes)
              <input type="number" min={1} max={120} value={settings.timeoutMinutes} onChange={(e) => change({ timeoutMinutes: Number(e.target.value) })} />
            </label>
            <button className="primary" onClick={() => void save()}>
              Save
            </button>
            <button disabled={looking} onClick={() => void look()}>
              {looking ? 'Looking…' : 'Refresh agents and models'}
            </button>
          </div>
          {tool?.installed && (
            <p className="muted">
              Found at {tool.path}
              {tool.version ? `, ${tool.version}` : ''}.{' '}
              {tool.models
                ? `${tool.models.length} models to choose from; type to search. This is what the tool knows about, not necessarily what your account can use.`
                : `Its models could not be listed${tool.modelsError ? `: ${tool.modelsError}` : ''}. You can still type one.`}
            </p>
          )}
          {tool && !tool.installed && (
            <p className="error" role="alert">
              {settings.preset} was not found on this computer's PATH, so it cannot run. Install it, then refresh.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Every tag in use, to rename (a rename onto an existing tag merges them) or remove from all records. */
function TagsAdmin() {
  const [tags, setTags] = useState<{ tag: string; count: number }[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const { error, message, setMessage, run: act, confirm, dialog } = useCrud();

  const reload = useCallback(() => act(() => api.tags(), setTags), [act]);
  useEffect(() => void reload(), [reload]);

  /** Does a change that answers with what it did, shows that, and reads the tags again. */
  const run = (action: () => Promise<string>) =>
    act(action, (done) => {
      setMessage(done);
      setEditing(null);
      return reload();
    });

  const plural = (n: number) => `${n} record${n === 1 ? '' : 's'}`;

  async function removeTag(tag: string, count: number) {
    if (
      !(await confirm({
        title: `Remove the tag "${tag}" from ${plural(count)}?`,
        message: 'The records stay.',
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return;
    void run(async () => `Removed ${tag} from ${plural((await api.deleteTag(tag)).removed)}.`);
  }

  return (
    <section>
      <p className="muted">
        Tags are free text on any record, for example the player a record belongs to. Renaming a tag changes it on every record; renaming it to a tag that
        already exists merges the two. Removing a tag never deletes the records.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {tags && tags.length === 0 && <p className="muted">No tags yet.</p>}
      <ul className="attempts" aria-label="Tags">
        {(tags ?? []).map(({ tag, count }) => (
          <li key={tag} className="attempt">
            {editing === tag ? (
              <RecordRow
                infoClassName="record-row-edit"
                actions={
                  <>
                    <button
                      className="primary"
                      disabled={name.trim() === ''}
                      onClick={() => void run(async () => `Renamed ${tag} on ${plural((await api.renameTag(tag, name)).records)}.`)}
                    >
                      Save
                    </button>
                    <button onClick={() => setEditing(null)}>Cancel</button>
                  </>
                }
              >
                <input className="small" aria-label="New tag name" value={name} onChange={(e) => setName(e.target.value)} />
              </RecordRow>
            ) : (
              <RecordRow
                actions={
                  <>
                    <button
                      onClick={() => {
                        setEditing(tag);
                        setName(tag);
                      }}
                    >
                      Rename
                    </button>
                    <button className="danger" onClick={() => void removeTag(tag, count)}>
                      Remove
                    </button>
                  </>
                }
              >
                <strong>{tag}</strong>
                <span className="muted">{plural(count)}</span>
              </RecordRow>
            )}
          </li>
        ))}
      </ul>
      {dialog}
    </section>
  );
}

/** Downloading a backup, restoring one, and the cleanup of old records. */
function DatabaseAdmin() {
  const { error, message, run, confirm, dialog } = useCrud();

  async function restore(file: File | undefined) {
    if (!file) return;
    const ok = await confirm({
      title: `Replace ALL records with the ones in "${file.name}"?`,
      message: 'Everything entered since that backup was made is lost. The current data is saved in the data/backups folder first.',
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!ok) return;
    await run(
      () => api.restoreBackup(file),
      undefined,
      ({ restoredRows, savedAs, note }) => `Restored ${restoredRows} rows.${savedAs ? ` The previous data is saved as ${savedAs}.` : ''} ${note} Reload the page to see them everywhere.`,
    );
  }

  return (
    <section>
      <h3>Backup and restore</h3>
      <p className="muted">
        A backup is a copy of the whole database: records, roster, maps, tags and rules. No pictures are in it: downloaded images can be downloaded again, but the
        pictures you confirmed or uploaded (images/custom) exist only in the images folder, so copy that folder too.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="filters">
        <a className="button" href={urlOf(adminContract.backup)} download>
          Download backup
        </a>
        <label className="field">
          Restore from a backup file
          <input type="file" accept=".db,.sqlite,.sqlite3,application/octet-stream" aria-label="Backup file" onChange={(e) => void restore(e.target.files?.[0]).then(() => (e.target.value = ''))} />
        </label>
      </div>
      <CleanupPage />
      {dialog}
    </section>
  );
}

interface WeeklyReference {
  bosses: Boss[];
  rules: BossRule[];
  maps: GameMap[];
}

/** The slots of one mode with their own Save and Clear, so the modes are edited and saved apart. */
function WeeklyMode({ mode, setup, reference }: { mode: DefaultMode; setup: WeeklySetups[DefaultMode]; reference: WeeklyReference }) {
  const fill = (from: WeeklySetups[DefaultMode]) => Array.from({ length: DEFAULT_SLOTS[mode] }, (_, i) => from.slots[i] ?? emptySlot());
  const [saved, setSaved] = useState(setup);
  const [slots, setSlots] = useState<DefaultSlot[]>(() => fill(setup));
  const { error, message, run: act } = useCrud();

  const edit = (index: number, change: Partial<DefaultSlot>) => setSlots((old) => old.map((s, i) => (i === index ? { ...s, ...change } : s)));

  const run = (action: () => Promise<WeeklySetups>, done: string) =>
    act(
      action,
      (all) => {
        setSaved(all[mode]);
        setSlots(fill(all[mode]));
      },
      done,
    );

  const mapTag = mode === 'Dream Hunt' ? 'Stage' : 'Arena';
  return (
    <section className="panel" aria-label={mode}>
      <h3>{mode}</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="weekly-slots" aria-label={`${mode} slots`}>
        {slots.map((slot, i) => (
          <li key={i} className="weekly-slot">
            <strong>{mode === 'Dream Hunt' ? `Fight ${i + 1}` : `Team ${i + 1}`}</strong>
            {mode === 'Dream Hunt' && (
              <label className="field">
                Boss
                <select value={slot.boss ?? ''} onChange={(e) => edit(i, { boss: e.target.value || null })}>
                  <option value="">None</option>
                  {reference.bosses.map((b) => (
                    <option key={b.name}>{b.name}</option>
                  ))}
                </select>
              </label>
            )}
            <MapPicker label="Map" maps={reference.maps.filter((m) => m.tags.includes(mapTag))} value={slot.mapName} onChange={(mapName) => edit(i, { mapName })} />
            {allowsRule(mode, i + 1) && (
              <label className="field">
                Rule
                <select value={slot.rule ?? ''} onChange={(e) => edit(i, { rule: e.target.value || null })}>
                  <option value="">None</option>
                  {reference.rules.map((r) => (
                    <option key={r.name}>{r.name}</option>
                  ))}
                </select>
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className="workspace-actions">
        <button className="primary" onClick={() => void run(() => api.saveDefaults(mode, slots), `Saved the ${mode} setup.`)}>
          Save
        </button>
        <button onClick={() => void run(() => api.clearDefaults(mode), `Cleared the ${mode} setup.`)}>Clear</button>
        <span className="muted">{saved.updatedAt ? `Updated ${saved.updatedAt}` : 'Not set'}</span>
        {message && <span role="status">{message}</span>}
      </div>
    </section>
  );
}

/** The boss, map and rule each mode repeats for a week: new records start with them. Every mode is shown and saved on its own. */
function WeeklyAdmin() {
  const [setups, setSetups] = useState<WeeklySetups | null>(null);
  const [reference, setReference] = useState<WeeklyReference | null>(null);
  const { error, run } = useCrud();

  useEffect(() => {
    void run(
      () => Promise.all([api.defaults(), api.bosses(), api.bossRules(), api.maps()]),
      ([all, bosses, rules, maps]) => {
        setSetups(all);
        setReference({ bosses, rules, maps });
      },
    );
  }, [run]);

  return (
    <section>
      <p className="muted">Dream Hunt, Supreme Arena, Super League and Guild Duel repeat the same bosses, maps and rules for a week. New records start with what is set here. Nothing expires: change it when the week does.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {setups && reference && DEFAULT_MODES.map((mode) => <WeeklyMode key={mode} mode={mode} setup={setups[mode]} reference={reference} />)}
    </section>
  );
}

const SECTIONS = [
  { key: 'general', label: 'General', component: GeneralAdmin },
  { key: 'weekly', label: 'Weekly default', component: WeeklyAdmin },
  { key: 'maps', label: 'Maps', component: MapsPage },
  { key: 'units', label: 'Units', component: UnitsPage },
  { key: 'artifacts', label: 'Artifacts', component: ArtifactsPage },
  { key: 'images', label: 'Images', component: ImagesPage },
  { key: 'reader', label: 'Reader', component: ReaderPage },
  { key: 'review', label: 'Review', component: ReviewPage },
  { key: 'database', label: 'Database', component: DatabaseAdmin },
  { key: 'tags', label: 'Tags', component: TagsAdmin },
  { key: 'formationIds', label: 'Formation IDs', component: FormationIdsAdmin },
  { key: 'rules', label: 'Rules', component: RulesAdmin },
  { key: 'agent', label: 'Agent', component: AgentAdmin },
] as const;

/** Upkeep that is not part of recording battles. */
export function AdminPage() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]['key']>('general');
  const active = SECTIONS.find((s) => s.key === section)!;
  const Section = active.component;
  return (
    <div>
      <h2 className="sr-only">{active.label}</h2>
      <div className="tabs" role="tablist" aria-label="Admin">
        {SECTIONS.map(({ key, label }) => (
          <button key={key} role="tab" aria-selected={section === key} className={section === key ? 'active' : undefined} onClick={() => setSection(key)}>
            {label}
          </button>
        ))}
      </div>
      <Section />
    </div>
  );
}
