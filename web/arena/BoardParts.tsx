import { ARENA_MODES, FIXED_MAP, modeAllowsPhantimal, TEAMS_PER_MODE, UNION_LEVEL_MAX } from '../../src/domain/arena.js';
import { type ArenaBattle, type ArenaMode, type Hero, type Profile } from '../backend.js';
import { BattleEditor } from './BattleEditor.js';
import { type Borrow } from './borrow.js';
import { FormationIdField } from '../FormationIdField.js';
import { type Reference, type Draft, onMap, playerName, type Side } from './draft.js';

/** The mode, map and rule of a battle: what it is about. */
export function ArenaIdentity({ mode, onMode, draft, reference, onChange }: { mode: ArenaMode; onMode?: (mode: ArenaMode) => void; draft: Draft; reference: Reference; onChange: (draft: Draft) => void }) {
  const arenaMaps = reference.maps.filter((m) => m.tags.includes('Arena'));
  return (
    <>
      <label className="field">
        Mode
        <select value={mode} disabled={!onMode} onChange={(e) => onMode?.(e.target.value as ArenaMode)}>
          {ARENA_MODES.map((m) => (
            <option key={m} value={m}>
              {onMode ? `${m} (${TEAMS_PER_MODE[m]} ${TEAMS_PER_MODE[m] === 1 ? 'team' : 'teams'})` : m}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Map
        <select value={draft.mapName} disabled={FIXED_MAP[mode] !== undefined} onChange={(e) => onChange({ ...draft, mapName: e.target.value, ...onMap(reference, e.target.value, draft) })}>
          {arenaMaps.filter((m) => FIXED_MAP[mode] === undefined || m.name === FIXED_MAP[mode]).map((m) => (
            <option key={m.name}>{m.name}</option>
          ))}
        </select>
      </label>
      {mode === 'Supreme Arena' && (
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
    </>
  );
}

export function WinnerField({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  return (
    <fieldset className="field">
      <legend>Winner</legend>
      <label>
        <input type="radio" checked={draft.outcome === 'Win'} onChange={() => onChange({ ...draft, outcome: 'Win' })} /> Side A
      </label>
      <label>
        <input type="radio" checked={draft.outcome === 'Loss'} onChange={() => onChange({ ...draft, outcome: 'Loss' })} /> Side B
      </label>
    </fieldset>
  );
}

export function Board({ draft, mode, reference, unavailable, borrow, sideRosters, onChange }: { draft: Draft; mode: string; reference: Reference; unavailable?: Map<string, string>; borrow?: Borrow; sideRosters?: Record<Side, Hero[] | null>; onChange: (draft: Draft) => void }) {
  const map = reference.maps.find((m) => m.name === draft.mapName);
  if (!map) return <p className="muted">Pick a map.</p>;
  return (
    <BattleEditor
      map={map}
      heroes={reference.heroes}
      artifacts={reference.artifacts}
      rules={reference.heroRules}
      formation={draft.formation}
      onFormation={(formation) => onChange({ ...draft, formation })}
      opponent={draft.opponent}
      onOpponent={(opponent) => onChange({ ...draft, opponent })}
      onBoth={(formation, opponent) => onChange({ ...draft, formation, opponent })}
      unavailable={unavailable}
      borrow={borrow}
      editSideAStates
      phantimals={modeAllowsPhantimal(mode) ? reference.phantimals : undefined}
      withAssist={false}
      sideRosters={sideRosters}
    />
  );
}

/** The Formation ID of each side of a fight on its own, for the bar of the form. */
export function FightFormationIds({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const { formation, opponent } = draft;
  return (
    <>
      <FormationIdField label="Side A" value={formation.formationId} onChange={(formationId) => onChange({ ...draft, formation: { ...formation, formationId } })} teams={[{ placed: formation.placed, phantimal: formation.phantimal, artifact: formation.artifact }]} />
      <FormationIdField label="Side B" value={opponent.formationId} onChange={(formationId) => onChange({ ...draft, opponent: { ...opponent, formationId } })} teams={[{ placed: opponent.placed, phantimal: opponent.phantimal, artifact: opponent.artifact }]} />
    </>
  );
}

/** In Guild Duel the Union Level of each side; nothing in the other modes. */
export function UnionLevels({ mode, draft, onChange }: { mode: ArenaMode; draft: Draft; onChange: (draft: Draft) => void }) {
  if (mode !== 'Guild Duel') return null;
  const unionField = (label: string, key: 'unionLevel' | 'opponentUnionLevel') => (
    <label className="field">
      {label}
      <input type="number" min={0} max={UNION_LEVEL_MAX} step={1} value={draft[key]} onChange={(e) => onChange({ ...draft, [key]: e.target.value })} />
    </label>
  );
  return (
    <>
      {unionField('Side A Union Level', 'unionLevel')}
      {unionField('Side B Union Level', 'opponentUnionLevel')}
    </>
  );
}

/** The mode of a fight or battle as its initials in a fixed-width chip, tinted per mode, so the rows line up (the name is its tooltip). */
const MODE_INITIALS: Record<ArenaMode, string> = { Arena: 'A', 'Supreme Arena': 'SA', 'Super League': 'SL', 'Guild Duel': 'GD', 'Treasure Rush': 'TR' };

export function ModeChip({ mode }: { mode: ArenaMode }) {
  return (
    <span className={`mode-chip mode-${mode.toLowerCase().replace(/ /g, '-')}`} role="img" aria-label={mode} title={mode}>
      {MODE_INITIALS[mode]}
    </span>
  );
}

/** "Alice vs Bob" for the players of a fight. With neither side a Player it is nothing, or an empty cell where `keepCell` (a grid column). */
export function Players({ fight, profiles, keepCell = false }: { fight: ArenaBattle; profiles: Profile[]; keepCell?: boolean }) {
  const a = playerName(profiles, fight.playerIdA);
  const b = playerName(profiles, fight.playerIdB);
  if (!a && !b) return keepCell ? <span /> : null;
  return (
    <span className="players" title="Side A vs Side B">
      <strong>{a ?? 'Unknown'}</strong> <span className="muted">vs</span> <strong>{b ?? 'Unknown'}</strong>
    </span>
  );
}
