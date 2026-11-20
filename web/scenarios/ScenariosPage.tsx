import { useId, useState } from 'react';
import { ARENA_MODES, FIXED_MAP, heroesAlreadyUsed, TEAMS_PER_MODE } from '../../src/domain/arena.js';
import { api, type AgentJob, type ArenaMode, type Artifact, type BossRule, type GameMap, type Hero, type Rules, type Scenario } from '../backend.js';
import { useAction } from '../hooks/action.js';
import { useReference } from '../hooks/load.js';
import { useJobFinished, useJobs } from '../jobs/JobsProvider.js';
import { BattleEditor } from '../arena/BattleEditor.js';
import { emptyFormation, type FormationState } from '../FormationEditor.js';
import { keepOnMap } from '../relocate.js';
import { CounterAdvisor, TeamGenerator } from '../advisor/index.js';
import { emptyOpponent, type OpponentState } from '../arena/OpponentEditor.js';
import { useConfirm } from '../ui/Dialog.js';
import { RecordRow } from '../ui/RecordRow.js';
import { TabPanel, Tabs } from '../ui/Tabs.js';
import { Notice } from '../ui/Notice.js';

const NO_SCENARIOS: Scenario[] = [];

interface Reference {
  maps: GameMap[];
  heroes: Hero[];
  artifacts: Artifact[];
  rules: BossRule[];
  heroRules: Rules;
}

/** One team's slot while it is being planned. */
interface SlotDraft {
  mapName: string;
  rule: string;
  mine: FormationState;
  enemy: OpponentState;
}

const newSlot = (reference: Reference): SlotDraft => ({
  mapName: reference.maps.find((m) => m.tags.includes('Arena'))?.name ?? '',
  rule: '',
  mine: emptyFormation(),
  enemy: emptyOpponent(),
});

/** The teams of a slot on another map: where they stand is kept as far as the new map allows (see keepOnMap). */
const onMap = (reference: Reference, mapName: string, slot: SlotDraft) => {
  const map = reference.maps.find((m) => m.name === mapName);
  if (!map) return { mine: slot.mine, enemy: slot.enemy };
  const kept = keepOnMap(map.cells, slot.mine, slot.enemy);
  return { mine: kept.formation, enemy: kept.opponent };
};

const slotFromScenario = (s: Scenario['slots'][number]): SlotDraft => ({
  mapName: s.mapName,
  rule: s.rule ?? '',
  mine: { ...emptyFormation(), placed: s.mine.map((h) => ({ tile: h.tile, hero: h.name, ...(h.part ? { part: h.part } : {}) })) },
  enemy: {
    ...emptyOpponent(),
    placed: s.enemy.map((h) => ({ tile: h.tile, hero: h.name, ...(h.part ? { part: h.part } : {}), rank: h.rank ?? '', equipment: h.equipmentLevel === null ? '' : String(h.equipmentLevel) })),
  },
});

function ScenarioForm({ reference, editing, onSaved, onCancel }: { reference: Reference; editing?: Scenario; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [mode, setMode] = useState<ArenaMode>(editing?.mode ?? 'Supreme Arena');
  const [note, setNote] = useState(editing?.note ?? '');
  const [slots, setSlots] = useState<SlotDraft[]>(() =>
    editing ? editing.slots.map(slotFromScenario) : Array.from({ length: TEAMS_PER_MODE['Supreme Arena'] }, () => newSlot(reference)),
  );
  const [current, setCurrent] = useState(0);
  const teamsId = useId();
  const { error, busy, run } = useAction();

  const arenaMaps = reference.maps.filter((m) => m.tags.includes('Arena'));
  const slot = slots[current]!;
  const map = reference.maps.find((m) => m.name === slot.mapName);

  function changeMode(next: ArenaMode) {
    setMode(next);
    setSlots((old) =>
      Array.from({ length: TEAMS_PER_MODE[next] }, (_, i) => {
        const kept = old[i] ?? newSlot(reference);
        const fixed = FIXED_MAP[next];
        return fixed === undefined || kept.mapName === fixed ? kept : { ...kept, mapName: fixed, ...onMap(reference, fixed, kept) };
      }),
    );
    setCurrent(0);
  }
  const update = (patch: Partial<SlotDraft>) => setSlots((old) => old.map((s, i) => (i === current ? { ...s, ...patch } : s)));

  // The roster heroes you placed on the other teams are not available here.
  const unavailable = new Map<string, string>();
  slots.forEach((s, i) => {
    if (i === current) return;
    for (const hero of heroesAlreadyUsed([{ heroes: s.mine.placed.map((p) => p.hero), assist: null }])) unavailable.set(hero, `Used in team ${i + 1}`);
  });

  async function save() {
    const input = {
      name,
      mode,
      note,
      slots: slots.map((s) => ({
        mapName: s.mapName,
        rule: mode === 'Supreme Arena' ? s.rule || null : null,
        mine: s.mine.placed,
        enemy: s.enemy.placed.map((p) => ({ tile: p.tile, hero: p.hero, ...(p.part ? { part: p.part } : {}), rank: p.rank || null, equipmentLevel: p.equipment === '' ? null : Number(p.equipment) })),
      })),
    };
    await run(() => (editing ? api.updateScenario(editing.id, input) : api.createScenario(input)), onSaved);
  }

  const teamView = (
    <>
      <div className="filters" key={current}>
        <label className="field">
          Map
          <select value={slot.mapName} disabled={FIXED_MAP[mode] !== undefined} onChange={(e) => update({ mapName: e.target.value, ...onMap(reference, e.target.value, slot) })}>
            {arenaMaps.filter((m) => FIXED_MAP[mode] === undefined || m.name === FIXED_MAP[mode]).map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </select>
        </label>
        {mode === 'Supreme Arena' && (
          <label className="field">
            Rule
            <select value={slot.rule} onChange={(e) => update({ rule: e.target.value })}>
              <option value="">None</option>
              {reference.rules.map((r) => (
                <option key={r.name}>{r.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {map && (
        <div key={`${current}-${slot.mapName}`}>
          <p className="muted">Place the enemy team on Side B. Optionally place your own heroes on Side A to keep them; leave it empty for the agent to propose from your roster.</p>
          <BattleEditor
            map={map}
            heroes={reference.heroes}
            artifacts={reference.artifacts}
            rules={reference.heroRules}
            formation={slot.mine}
            onFormation={(mine) => update({ mine })}
            opponent={slot.enemy}
            onOpponent={(enemy) => update({ enemy })}
            onBoth={(mine, enemy) => update({ mine, enemy })}
            unavailable={unavailable}
            sideAHeroes="roster"
            heroesOnly
            labels={{ a: 'Your heroes', b: 'Enemy' }}
          />
        </div>
      )}
    </>
  );

  return (
    <section className="panel">
      <h3>{editing ? 'Edit scenario' : 'New scenario'}</h3>
      <div className="filters">
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Mode
          <select value={mode} onChange={(e) => changeMode(e.target.value as ArenaMode)}>
            {ARENA_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {slots.length > 1 && (
        <Tabs id={teamsId} label="Teams" tabs={slots.map((s, i) => ({ key: i, label: `Team ${i + 1}${s.enemy.placed.length > 0 ? ` (${s.enemy.placed.length} enemy)` : ''}` }))} value={current} onChange={setCurrent} />
      )}
      {slots.length > 1 ? <TabPanel id={teamsId} value={current}>{teamView}</TabPanel> : teamView}
      {error && (
        <Notice kind="error">
          {error}
        </Notice>
      )}
      <button className="primary" disabled={busy} onClick={() => void save()}>
        {editing ? 'Save changes' : 'Save scenario'}
      </button>
      <button onClick={onCancel}>Cancel</button>
    </section>
  );
}

const requestFor = (s: Scenario) =>
  `Answer scenario ${s.id} ("${s.name}"): run \`npm run query -- scenario --id ${s.id}\`, use the recorded history as AGENTS.md describes, then save your answer with \`npm run scenario:estimate\`.`;

/** The agent's runs on all scenarios, from the app's job watcher: the list reloads when a run seen going has finished. */
function useAgentRuns(onFinished: () => void) {
  const { summary, error: lookError } = useJobs();
  const [errors, setErrors] = useState<Record<number, string>>({});
  useJobFinished('scenario', (event) => event.state === 'done' && onFinished());

  async function act(id: number, action: (id: number) => Promise<AgentJob>) {
    try {
      await action(id);
      setErrors(({ [id]: _cleared, ...rest }) => rest);
    } catch (e) {
      setErrors((old) => ({ ...old, [id]: (e as Error).message }));
    }
  }

  return {
    lookError,
    jobOf: (id: number): AgentJob => summary?.scenarios[id] ?? { state: 'idle' },
    errorOf: (id: number) => errors[id] ?? null,
    start: (id: number) => act(id, api.runScenario),
    cancel: (id: number) => act(id, api.cancelScenarioRun),
  };
}

interface CardRun {
  job: AgentJob;
  error: string | null;
  start: () => void;
  cancel: () => void;
}

function ScenarioCard({ scenario, run, onEdit, onDelete }: { scenario: Scenario; run: CardRun; onEdit: () => void; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const stale = scenario.estimateAt !== null && scenario.updatedAt > scenario.estimateAt;

  async function copy() {
    try {
      await navigator.clipboard.writeText(requestFor(scenario));
      setCopied(true);
      setFallback(null);
    } catch {
      setFallback(requestFor(scenario));
    }
  }

  return (
    <li className="attempt">
      <RecordRow
        actions={
          <>
            {run.job.state === 'running' ? (
              <button onClick={run.cancel}>Cancel estimate</button>
            ) : (
              <button className="primary" onClick={run.start}>
                Run estimate
              </button>
            )}
            <button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy request for Claude'}</button>
            <button onClick={onEdit}>Edit</button>
            <button className="danger" onClick={onDelete}>
              Delete
            </button>
          </>
        }
      >
        <strong>{scenario.name}</strong>
        <span className="badge">{scenario.mode}</span>
        <span className="muted">
          {scenario.slots.length} team{scenario.slots.length === 1 ? '' : 's'}
        </span>
      </RecordRow>
      {scenario.note && <p className="muted">{scenario.note}</p>}
      {fallback && (
        <div className="details-panel">
          <p className="muted">The clipboard is not available here. Copy the request below and give it to Claude Code.</p>
          <textarea className="copy-fallback" readOnly value={fallback} aria-label="Request for Claude Code" />
        </div>
      )}
      {run.job.state === 'running' && <p role="status">The agent is working on this. It can take a few minutes.</p>}
      {run.job.state === 'failed' && (
        <Notice kind="error">
          The last run failed: {run.job.error}
          {scenario.estimate ? ' The previous estimate is kept.' : ''}
        </Notice>
      )}
      {run.error && (
        <Notice kind="error">
          {run.error}
        </Notice>
      )}
      <p className="muted">
        {scenario.slots.map((s) => `Team ${s.position}: ${s.enemy.map((h) => h.name).join(', ')}${s.mine.length ? ` vs ${s.mine.map((h) => h.name).join(', ')}` : ''}`).join(' · ')}
      </p>
      {scenario.estimate ? (
        <div>
          <p className="muted">
            Agent estimate, {scenario.estimateAt}
            {stale ? ' (the scenario was edited since: ask again)' : ''}
          </p>
          <pre className="estimate">{scenario.estimate}</pre>
        </div>
      ) : (
        <p className="muted">No estimate yet. Run the agent, or copy the request and give it to Claude Code.</p>
      )}
    </li>
  );
}

function ScenarioPlanner() {
  const loaded = useReference({ scenarios: api.scenarios, maps: api.maps, heroes: api.heroes, artifacts: api.artifacts, rules: api.bossRules, heroRules: api.rules });
  const scenarios = loaded.data?.scenarios ?? NO_SCENARIOS;
  const reference: Reference | null = loaded.data ?? null;
  const reload = loaded.reload;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Scenario | null>(null);
  const { error: actionError, run } = useAction({ then: reload });
  const error = loaded.error ?? actionError;
  const { confirm, dialog } = useConfirm();

  const runs = useAgentRuns(() => void reload());

  async function remove(scenario: Scenario) {
    if (
      !(await confirm({
        title: `Delete the scenario "${scenario.name}"?`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    await run(() => api.deleteScenario(scenario.id));
  }

  const done = () => {
    setAdding(false);
    setEditing(null);
    void reload();
  };

  return (
    <div>
      <div className="toolbar">
        <span className="muted">{scenarios.length} scenarios</span>
        <button className="primary" disabled={!reference} onClick={() => (setEditing(null), setAdding(true))}>
          New scenario
        </button>
      </div>
      <p className="muted">
        Plan an Arena, Supreme Arena, Super League, Guild Duel or Treasure Rush fight: place the enemy teams, and optionally some of your heroes. The agent reads the scenario, compares it
        with your recorded battles and writes its estimate here (choose the agent in Admin). It cannot simulate a fight; it can only say what the history suggests.
      </p>
      {(error ?? runs.lookError) && (
        <Notice kind="error">
          {error ?? runs.lookError}
        </Notice>
      )}
      {reference && adding && <ScenarioForm reference={reference} onSaved={done} onCancel={() => setAdding(false)} />}
      {reference && editing && <ScenarioForm key={editing.id} reference={reference} editing={editing} onSaved={done} onCancel={() => setEditing(null)} />}
      <ul className="attempts" aria-label="Scenarios">
        {scenarios.map((s) => (
          <ScenarioCard
            key={s.id}
            scenario={s}
            run={{ job: runs.jobOf(s.id), error: runs.errorOf(s.id), start: () => void runs.start(s.id), cancel: () => void runs.cancel(s.id) }}
            onEdit={() => (setAdding(false), setEditing(s))}
            onDelete={() => void remove(s)}
          />
        ))}
      </ul>
      {scenarios.length === 0 && <p className="muted">No scenarios yet.</p>}
      {dialog}
    </div>
  );
}

const TOOLS = { generator: 'Team generator', advisor: 'Advisor', planner: 'Scenario planner' } as const;
type Tool = keyof typeof TOOLS;

/** The Scenarios page: the team generator (teams from your roster and records), the Advisor (teams against an enemy you place) and the scenario planner (boards the agent estimates). */
export function ScenariosPage() {
  const [tool, setTool] = useState<Tool>('generator');
  return (
    <section>
      <Tabs id="scenarios" label="Scenarios" tabs={(Object.keys(TOOLS) as Tool[]).map((key) => ({ key, label: TOOLS[key] }))} value={tool} onChange={setTool} />
      <TabPanel id="scenarios" value={tool}>
        {tool === 'generator' ? <TeamGenerator /> : tool === 'advisor' ? <CounterAdvisor /> : <ScenarioPlanner />}
      </TabPanel>
    </section>
  );
}
