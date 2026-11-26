import { useState } from 'react';
import { OPEN_MAP } from '../../src/domain/map.js';
import { api, type GameMap } from '../backend.js';
import { useAction } from '../hooks/action.js';
import { useConfirmActions } from '../hooks/confirm.js';
import { useLoad } from '../hooks/load.js';
import { Notice } from '../ui/Notice.js';

/** How many records of each mode use a map, and a way to move its Stages to another map (#382). The Open map is never moved off. */
export function MapUsesPanel({ map, maps, onMoved }: { map: string; maps: readonly GameMap[]; onMoved: () => void }) {
  const [version, setVersion] = useState(0);
  const loaded = useLoad(() => api.mapUses(map), [map, version]);
  const { error: actionError, busy, run } = useAction({ toast: true });
  const { confirmRun, dialog } = useConfirmActions(run);
  const others = maps.filter((m) => m.name !== map);
  const [chosen, setChosen] = useState(OPEN_MAP);
  const target = others.some((m) => m.name === chosen) ? chosen : (others[0]?.name ?? '');
  const uses = loaded.data;
  const error = loaded.error ?? actionError;

  if (!uses) return error ? <Notice kind="error">{error}</Notice> : null;
  const rows: { mode: string; records: string; note?: string }[] = [
    { mode: 'Stages', records: `${uses.stages.records}`, note: uses.stages.stages > 0 ? `on ${uses.stages.stages} ${uses.stages.stages === 1 ? 'stage' : 'stages'}` : undefined },
    { mode: 'PvP records', records: `${uses.arena}` },
    { mode: 'PvP ideas', records: `${uses.ideas}` },
    { mode: 'Dream Hunt', records: `${uses.dreamHunt}` },
    { mode: 'Titan Reaver', records: `${uses.titanReaver}`, note: 'no map' },
  ];

  const move = () =>
    confirmRun(
      {
        title: `Move the stages of "${map}" to "${target}"?`,
        message: 'Their records keep the placements they were saved with, which may not fit the other map: check them afterwards. Records of other modes stay on this map.',
        confirmLabel: 'Move stages',
      },
      () => api.moveMapStages(map, target),
      () => (setVersion((v) => v + 1), onMoved()),
      ({ moved }) => `Moved ${moved} ${moved === 1 ? 'stage' : 'stages'} to ${target}.`,
    );

  return (
    <section aria-label="Used by">
      <h4>Used by</h4>
      {error && <Notice kind="error">{error}</Notice>}
      <table>
        <thead>
          <tr>
            <th scope="col">Mode</th>
            <th scope="col">Records</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mode}>
              <th scope="row">{r.mode}</th>
              <td>
                {r.records}
                {r.note && <span className="muted"> ({r.note})</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {uses.scenarios > 0 && <p className="muted">Also planned in {uses.scenarios} {uses.scenarios === 1 ? 'scenario' : 'scenarios'}.</p>}
      {map === OPEN_MAP && <p className="muted">{OPEN_MAP} is the map Stages start on: it is never deleted and its stages are never moved off it.</p>}
      {map !== OPEN_MAP && uses.stages.stages > 0 && others.length > 0 && (
        <div className="actions">
          <label>
            Move its stages to{' '}
            <select value={target} onChange={(e) => setChosen(e.target.value)}>
              {others.map((m) => (
                <option key={m.name}>{m.name}</option>
              ))}
            </select>
          </label>
          <button disabled={busy} onClick={() => void move()}>
            Move stages
          </button>
        </div>
      )}
      {dialog}
    </section>
  );
}
