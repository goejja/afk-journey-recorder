import { type Borrow } from '../arena/borrow.js';
import { FormationEditor } from '../FormationEditor.js';
import { Portrait } from '../Portrait.js';
import { type Reference, type Draft, onMap } from './draft.js';

/** The boss, its rule (only the fifth fight has one) and the map: what a fight is about. */
export function FightIdentity({ draft, reference, showRule, onChange }: { draft: Draft; reference: Reference; showRule: boolean; onChange: (draft: Draft) => void }) {
  const stageMaps = reference.maps.filter((m) => m.tags.includes('Stage'));
  return (
    <>
      {draft.boss && <Portrait kind="boss" name={draft.boss} size={40} />}
      <label className="field">
        Boss
        <select value={draft.boss} onChange={(e) => onChange({ ...draft, boss: e.target.value })}>
          {reference.bosses.map((b) => (
            <option key={b.name}>{b.name}</option>
          ))}
        </select>
      </label>
      {showRule && (
        <label className="field">
          Rule
          <select value={draft.rule} onChange={(e) => onChange({ ...draft, rule: e.target.value })}>
            <option value="">None</option>
            {reference.rules.map((r) => (
              <option key={r.name}>{r.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Map
        <select value={draft.mapName} onChange={(e) => onChange({ ...draft, mapName: e.target.value, formation: onMap(reference, e.target.value, draft) })}>
          {stageMaps.map((m) => (
            <option key={m.name}>{m.name}</option>
          ))}
        </select>
      </label>
    </>
  );
}

export function FightResult({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  return (
    <>
      <fieldset className="field">
        <legend>Result</legend>
        <label>
          <input type="radio" name="dh-outcome" checked={draft.outcome === 'Win'} onChange={() => onChange({ ...draft, outcome: 'Win' })} /> Cleared
        </label>
        <label>
          <input type="radio" name="dh-outcome" checked={draft.outcome === 'Loss'} onChange={() => onChange({ ...draft, outcome: 'Loss' })} /> Not cleared
        </label>
      </fieldset>
      {draft.outcome === 'Win' && (
        <label className="field">
          Clear time
          <input placeholder="9.69 or 1:23" value={draft.time} onChange={(e) => onChange({ ...draft, time: e.target.value })} />
        </label>
      )}
    </>
  );
}

export function FightBoard({ draft, reference, unavailable, borrow, onChange }: { draft: Draft; reference: Reference; unavailable?: Map<string, string>; borrow?: Borrow; onChange: (draft: Draft) => void }) {
  const map = reference.maps.find((m) => m.name === draft.mapName);
  if (!map) return <p className="muted">Pick a map.</p>;
  return (
    <FormationEditor
      map={map}
      heroes={reference.heroes}
      artifacts={reference.artifacts}
      phantimals={null}
      value={draft.formation}
      onChange={(formation) => onChange({ ...draft, formation })}
      unavailable={unavailable}
      borrow={borrow}
      rules={reference.heroRules}
      withAssist={false}
    />
  );
}
