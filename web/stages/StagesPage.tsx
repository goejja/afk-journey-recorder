import { useEffect, useMemo, useState } from 'react';
import { buildLane, defaultPhase, GRID_PHASES, laneId, laneKey, openByDefault, standardPhase, type Lane } from '../../src/domain/stage-grid.js';
import { isApex, STAGE_KINDS, type StageKind } from '../../src/domain/stage.js';
import { api, type Attempt } from '../backend.js';
import { useConfirm } from '../ui/Dialog.js';
import { useLoad, useReference } from '../hooks/load.js';
import { AttemptForm, type AttemptFormProps } from './AttemptForm.js';
import { BoxPanel, type BoxRef } from './BoxPanel.js';
import { ChangeStageKind } from './ChangeStageKind.js';
import { usePageState } from './page-state.js';
import { StageLane } from './StageLane.js';
import { TabPanel, Tabs } from '../ui/Tabs.js';
import { Notice } from '../ui/Notice.js';
import { Loading } from '../ui/ListStatus.js';

/** How long a box flashes after a jump. */
const FLASH_MS = 1500;

const stageLabel = (s: Attempt['stage']) => `S${s.season} · ${s.kind}${isApex(s.kind) ? ` (phase ${s.phase})` : ''} · stage ${s.number}`;

/** The Stages page: a grid of every stage, by phase and lane, and under a clicked box its records. */
export function StagesPage() {
  const grid = useLoad(() => api.stageGrid(), []);
  const reference = useReference({ maps: api.maps, heroes: api.heroes, artifacts: api.artifacts, enemies: api.enemies, phantimals: api.phantimals });
  const { state, choosePhase, setLane } = usePageState();
  const [selected, setSelected] = useState<{ kind: StageKind; number: number } | null>(null);
  const [form, setForm] = useState<Pick<AttemptFormProps, 'editing' | 'cloneFrom' | 'prefill'> | null>(null);
  const [version, setVersion] = useState(0);
  const [fixingKind, setFixingKind] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jumpNumber, setJumpNumber] = useState('');
  const [jumpKind, setJumpKind] = useState<StageKind>('Normal');
  const [flashed, setFlashed] = useState<{ kind: StageKind; number: number } | null>(null);
  const { confirm, dialog } = useConfirm();

  const boxes = useMemo(() => grid.data?.boxes ?? [], [grid.data]);
  const season = grid.data?.season ?? 0;
  const phase = state.phase ?? defaultPhase(boxes);
  const lanes = useMemo(() => STAGE_KINDS.map((kind) => buildLane(kind, phase, boxes)), [boxes, phase]);
  const standard = { normal: lanes[0]!, phantisomal: lanes[1]! };
  const isOpen = (lane: Lane) => {
    const key = laneKey(phase, lane.kind);
    return state.open.includes(key) || (!state.closed.includes(key) && openByDefault(lane, standard));
  };

  const refresh = () => {
    setVersion((v) => v + 1);
    void grid.reload();
  };

  // Escape closes the panel
  useEffect(() => {
    if (!selected || form) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, form]);

  // A jump scrolls to its box and lets it flash
  useEffect(() => {
    if (!flashed) return;
    document.getElementById(`box-${laneId(flashed.kind)}-${flashed.number}`)?.scrollIntoView?.({ block: 'center' });
    const timer = setTimeout(() => setFlashed(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashed]);

  function jump() {
    const number = Number(jumpNumber);
    if (!Number.isInteger(number) || number < 1) return;
    const target = isApex(jumpKind) ? phase : standardPhase(jumpKind, number);
    const lane = buildLane(jumpKind, target, boxes);
    if (!lane.boxes.some((b) => b.number === number)) {
      setError(`${jumpKind} has no stage ${number} in phase ${target}: its stages go from ${lane.first} to ${lane.last}.`);
      return;
    }
    setError(null);
    if (target !== phase) choosePhase(target);
    setLane(target, jumpKind, true);
    setFlashed({ kind: jumpKind, number });
  }

  async function remove(attempt: Attempt) {
    if (!(await confirm({ title: `Delete this attempt on ${stageLabel(attempt.stage)}?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.deleteAttempt(attempt.id);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (form && reference.data) {
    const done = () => setForm(null);
    return (
      <AttemptForm
        key={form.editing?.id ?? (form.cloneFrom ? `clone-${form.cloneFrom.id}` : form.prefill ? `box-${form.prefill.kind}-${form.prefill.number}` : 'new')}
        {...reference.data}
        {...form}
        onCancel={done}
        onSaved={() => {
          done();
          refresh();
        }}
        onRecorded={refresh}
      />
    );
  }

  const panelFor = (lane: Lane) => {
    const box = selected && selected.kind === lane.kind ? lane.boxes.find((b) => b.number === selected.number) : undefined;
    if (!selected || !box) return null;
    const ref: BoxRef = { kind: lane.kind, phase: isApex(lane.kind) ? phase : 0, number: box.number };
    return (
      <BoxPanel
        key={`${ref.kind}-${ref.number}`}
        box={ref}
        state={box.state}
        newestSeason={box.newestSeason}
        maps={reference.data?.maps ?? []}
        version={version}
        onEdit={(editing) => setForm({ editing })}
        onClone={(cloneFrom) => setForm({ cloneFrom })}
        onDelete={(attempt) => void remove(attempt)}
        onAdd={(mapName) => setForm({ prefill: { kind: ref.kind, phase: ref.phase, number: ref.number, mapName } })}
        onClose={() => setSelected(null)}
      />
    );
  };

  return (
    <section>
      {(error || grid.error || reference.error) && (
        <Notice kind="error">
          {error ?? grid.error ?? reference.error}
        </Notice>
      )}
      <div className="filters stage-toolbar">
        <Tabs id="stage-phase" label="Phase" tabs={GRID_PHASES.map((p) => ({ key: p, label: `Phase ${p}` }))} value={phase} onChange={(p) => (choosePhase(p), setSelected(null))} />
        <div className="field" role="group" aria-label="Jump to a stage">
          <span className="field-caption">Jump to stage</span>
          <span className="stage-jump">
            <input type="number" min={1} aria-label="Stage number to jump to" value={jumpNumber} onChange={(e) => setJumpNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && jump()} />
            <select aria-label="Lane to jump to" value={jumpKind} onChange={(e) => setJumpKind(e.target.value as StageKind)}>
              {STAGE_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <button onClick={jump}>Jump</button>
          </span>
        </div>
        <button className="primary" onClick={() => setForm({})} disabled={!reference.data}>
          New attempt
        </button>
        <button onClick={() => setFixingKind(!fixingKind)} aria-expanded={fixingKind} title="Fix stages recorded as the wrong kind, such as Normal instead of Phantisomal">
          Change stage kind
        </button>
      </div>
      {fixingKind && <ChangeStageKind onChanged={refresh} onCancel={() => setFixingKind(false)} />}

      <ul className="stage-key muted" aria-label="Box colours">
        <li><span className="stage-swatch cleared" /> cleared this season</li>
        <li><span className="stage-swatch older" /> older season only</li>
        <li><span className="stage-swatch none" /> no record</li>
      </ul>

      <TabPanel id="stage-phase" value={phase}>
        {grid.data === undefined ? (
          !grid.error && <Loading />
        ) : (
          lanes.map((lane) => {
            const open = isOpen(lane);
            return (
              <StageLane
                key={lane.kind}
                lane={lane}
                open={open}
                season={season}
                selected={selected?.kind === lane.kind ? selected.number : null}
                flashed={flashed?.kind === lane.kind ? flashed.number : null}
                onToggle={() => (setLane(phase, lane.kind, !open), selected?.kind === lane.kind && open && setSelected(null))}
                onSelect={(number) => setSelected(selected?.kind === lane.kind && selected.number === number ? null : { kind: lane.kind, number })}
                panel={panelFor(lane)}
              />
            );
          })
        )}
      </TabPanel>
      {dialog}
    </section>
  );
}
