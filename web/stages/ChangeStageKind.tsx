import { useState } from 'react';
import { isApex, PHASES } from '../../src/domain/stage.js';
import { api, type StageKind } from '../backend.js';
import { useCurrentSeason } from '../seasons.js';

/** Which kinds a stage can be turned into: the other one of its family. */
const OTHER_KIND: Record<StageKind, StageKind> = {
  Normal: 'Phantisomal',
  Phantisomal: 'Normal',
  'Apex Normal': 'Apex Phantisomal',
  'Apex Phantisomal': 'Apex Normal',
};
const KINDS = Object.keys(OTHER_KIND) as StageKind[];

/** Fixes stages recorded as the wrong kind: a range of stage numbers changes kind, and its attempts with it. */
export function ChangeStageKind({ onChanged, onCancel }: { onChanged: () => void; onCancel: () => void }) {
  const currentSeason = useCurrentSeason();
  const [chosenSeason, setSeason] = useState<number | null>(null);
  const season = chosenSeason ?? currentSeason;
  const [kind, setKind] = useState<StageKind>('Normal');
  const [phase, setPhase] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function apply() {
    try {
      if (from.trim() === '') throw new Error('Enter the first stage number');
      const first = Number(from);
      const { stages, attempts } = await api.changeStageKind({ season, phase: isApex(kind) ? phase : 0, kind, newKind: OTHER_KIND[kind], from: first, to: to === '' ? first : Number(to) });
      setError(null);
      setStatus(stages === 0 ? 'No such stage was recorded.' : `${stages} stage${stages === 1 ? '' : 's'} and ${attempts} attempt${attempts === 1 ? '' : 's'} are now ${OTHER_KIND[kind]}.`);
      if (stages > 0) onChanged();
    } catch (e) {
      setStatus(null);
      setError((e as Error).message);
    }
  }

  return (
    <div className="filters" role="group" aria-label="Change stage kind">
      <label className="field">
        Season
        <input type="number" min={1} value={season} onChange={(e) => setSeason(Number(e.target.value))} />
      </label>
      <label className="field">
        Recorded as
        <select value={kind} onChange={(e) => setKind(e.target.value as StageKind)}>
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      {isApex(kind) && (
        <label className="field">
          Phase
          <select value={phase} onChange={(e) => setPhase(Number(e.target.value))}>
            {PHASES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        From stage
        <input type="number" min={1} value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="field">
        To stage (optional)
        <input type="number" min={1} value={to} placeholder="same stage" onChange={(e) => setTo(e.target.value)} />
      </label>
      <button className="primary" disabled={!from} onClick={() => void apply()}>
        Make {OTHER_KIND[kind]}
      </button>
      <button onClick={onCancel}>Close</button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
      {status && <span className="muted" role="status">{status}</span>}
    </div>
  );
}
