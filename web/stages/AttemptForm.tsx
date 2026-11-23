import { useEffect, useRef, useState } from 'react';
import { useAction } from '../hooks/action.js';
import { allowsPhantimal, isApex, PHASES, STAGE_KINDS } from '../../src/domain/stage.js';
import { AFK_RANGE_TAG } from '../../src/domain/tags.js';
import {
  api,
  type Artifact,
  type Attempt,
  type Enemy,
  type GameMap,
  type Hero,
  type Phantimal,
  type Stage,
  type StageEnemy,
  type StageKind,
} from '../backend.js';
import { emptyFormation, formationFromRecord, toPayload } from '../FormationEditor.js';
import { emptyOpponent } from '../arena/OpponentEditor.js';
import { keepOnMap } from '../relocate.js';
import { RecordShell } from '../RecordShell.js';
import { useCurrentSeason } from '../seasons.js';
import { FormationEditor } from '../FormationEditor.js';
import { StageEnemiesField } from './StageEnemiesField.js';
import { FormationIdField } from '../FormationIdField.js';

export interface AttemptFormProps {
  maps: GameMap[];
  heroes: Hero[];
  artifacts: Artifact[];
  enemies: Enemy[];
  phantimals: Phantimal[];
  /** The attempt being corrected, when editing instead of recording a new one. */
  editing?: Attempt;
  /** An attempt to start a new one from: the same stage, formation, buff level and tags, but not its result or note. */
  cloneFrom?: Attempt;
  /** The stage a new attempt starts on, from a box of the Stages grid; the season is the current one. */
  prefill?: { kind: StageKind; phase: number; number: number; mapName?: string };
  onSaved: () => void;
  /** A record was saved with "Save and record another": the form stays open, the list behind it can refresh. */
  onRecorded?: () => void;
  onCancel: () => void;
}

/** The tag put on the attempts of a range of stages cleared by one formation in auto-battle. */

export function AttemptForm({ maps, heroes, artifacts, enemies, phantimals, editing, cloneFrom, prefill, onSaved, onRecorded, onCancel }: AttemptFormProps) {
  const stageMaps = maps.filter((m) => m.tags.includes('Stage'));

  // ---- which stage -------------------------------------------------------------------------
  const currentSeason = useCurrentSeason();
  const seed = editing ?? cloneFrom;
  // A clone is a new clear, so it is on the current season's stage; a record being edited keeps its own.
  const [chosenSeason, setSeason] = useState<number | null>(editing?.stage.season ?? null);
  const season = chosenSeason ?? currentSeason; // until the player picks one, the current season
  const [kind, setKind] = useState<StageKind>(seed?.stage.kind ?? prefill?.kind ?? 'Normal');
  const [phase, setPhase] = useState(seed && seed.stage.phase > 0 ? seed.stage.phase : prefill && prefill.phase > 0 ? prefill.phase : 1);
  const [number, setNumber] = useState(seed ? String(seed.stage.number) : prefill ? String(prefill.number) : '');
  // The same formation may have cleared several stages in auto-battle: a new record can then span a range, one attempt per stage.
  const [rangeEnd, setRangeEnd] = useState('');
  const [mapName, setMapName] = useState(seed?.stage.mapName ?? prefill?.mapName ?? stageMaps[0]?.name ?? '');
  /** The stage with this identity when it has been recorded; a stage that is new is only created when the attempt is saved. */
  const [stage, setStage] = useState<Stage | null>(null);
  const hadStage = useRef(false);

  // ---- Stage Enemies, player formation, result -----------------------------------------------
  const [enemyDraft, setEnemyDraft] = useState<StageEnemy[]>([]);
  const [formation, setFormation] = useState(seed ? formationFromRecord(seed.formation, false) : emptyFormation());
  const [buffLevel, setBuffLevel] = useState(String(seed?.buffLevel ?? 0));
  const [note, setNote] = useState(editing?.note ?? '');
  const [tags, setTags] = useState(seed?.tags ?? []);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const stageNumber = Number(number);
  const numberValid = Number.isInteger(stageNumber) && stageNumber >= 1;
  const stageKey = { season, phase: isApex(kind) ? phase : 0, kind, number: stageNumber };
  const activeMapName = stage?.mapName ?? mapName;
  const map = maps.find((m) => m.name === activeMapName);
  const rangeTo = Number(rangeEnd);
  const inRange = !editing && rangeEnd !== '' && Number.isInteger(rangeTo) && numberValid && rangeTo > stageNumber;
  const seasonPhantimals = phantimals.filter((p) => p.seasons.includes(stage?.season ?? season));
  const enemyKey = (list: StageEnemy[]) => JSON.stringify([...list].sort((a, b) => (a.enemy ?? a.hero ?? '').localeCompare(b.enemy ?? b.hero ?? '')));
  const enemiesDirty = !inRange && enemyKey(enemyDraft) !== enemyKey(stage?.enemies ?? []);

  // The stage with this identity is looked up as the player types, never created before the attempt is saved.
  useEffect(() => {
    if (!numberValid) {
      setStage(null);
      setEnemyDraft([]);
      hadStage.current = false;
      return;
    }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const found = (await api.findStages({ season, phase: isApex(kind) ? phase : 0, kind, number: stageNumber }))[0];
        const loaded = found ? await api.stage(found.id) : null;
        if (!current) return;
        // enemies already typed for a stage that is new are kept; those of the stage left behind are not
        setEnemyDraft((old) => (loaded ? loaded.enemies : hadStage.current ? [] : old));
        hadStage.current = loaded !== null;
        setStage(loaded);
        setError(null);
      } catch (e) {
        if (current) setError((e as Error).message);
      }
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [season, kind, phase, stageNumber, numberValid]);

  // A new stage keeps the team the player set up: it stands where it can on the stage's map, and a phantimal the stage
  // cannot take (its kind, or another season) is the only thing left behind.
  const latest = useRef({ editing, maps, phantimals });
  latest.current = { editing, maps, phantimals };
  const stageSeason = stage?.season ?? season;
  useEffect(() => {
    const { editing, maps, phantimals } = latest.current;
    if (editing) return;
    const stageMap = maps.find((m) => m.name === activeMapName);
    setFormation((old) => {
      const kept = stageMap ? keepOnMap(stageMap.cells, old, emptyOpponent()).formation : old;
      const phantimalOk = kept.phantimal !== null && allowsPhantimal(kind) && phantimals.some((p) => p.name === kept.phantimal!.name && p.seasons.includes(stageSeason));
      return phantimalOk ? kept : { ...kept, phantimal: null };
    });
  }, [activeMapName, kind, stageSeason]);

  /** The stage this attempt belongs to, created when it is new, with the Stage Enemies as they are now. */
  async function resolveStage(): Promise<Stage> {
    const base = stage ?? (await api.findOrCreateStage({ ...stageKey, mapName }));
    const saved = enemiesDirty ? await api.saveStage(base.id, base.mapName, enemyDraft) : base;
    setStage(saved);
    return saved;
  }

  /** Typing the end of a range makes every stage after the first an `AFK range` copy. The server adds the tag, so the form keeps it out of the tags. */
  function changeRangeEnd(value: string) {
    setRangeEnd(value);
    if (value !== '') setTags(tags.filter((t) => t.toLowerCase() !== AFK_RANGE_TAG.toLowerCase()));
  }

  async function saveRange(another: boolean) {
    try {
      const range = {
        season,
        phase: stageKey.phase,
        kind,
        from: stageNumber,
        to: rangeTo,
        mapName: activeMapName,
        buffLevel: isApex(kind) ? Number(buffLevel) : null,
        note,
        tags,
        formation: toPayload(formation, false),
      };
      const { attempts } = await api.createAttemptRange(range);
      if (!another) return onSaved();
      setError(null);
      setStatus(`Saved ${attempts.length} records, stages ${range.from} to ${range.to}. Change the range for the next clear, or the formation.`);
      onRecorded?.();
    } catch (e) {
      setStatus(null);
      setError((e as Error).message);
    }
  }

  const saving = useAction();
  const saveAttempt = (another: boolean) => saving.run(() => saveOne(another));

  async function saveOne(another: boolean) {
    if (inRange) return saveRange(another);
    try {
      const resolved = await resolveStage();
      const attempt = {
        stageId: resolved.id,
        buffLevel: isApex(resolved.kind) ? Number(buffLevel) : null,
        note,
        tags,
        formation: toPayload(formation, false),
      };
      await (editing ? api.updateAttempt(editing.id, attempt) : api.createAttempt(attempt));
      if (!another) return onSaved();
      // The formation, note and tags stay, so the same team can be recorded again on another stage.
      setError(null);
      setStatus('Saved. Change the stage for the next clear with the same formation, or change the formation.');
      onRecorded?.();
    } catch (e) {
      setStatus(null);
      setError((e as Error).message);
    }
  }

  const identity = (
    <>
      <label className="field">
        Season
        <input type="number" min={1} value={season} onChange={(e) => setSeason(Number(e.target.value))} />
      </label>
      <label className="field">
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as StageKind)}>
          {STAGE_KINDS.map((k) => (
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
        Stage number
        <input type="number" min={1} value={number} onChange={(e) => setNumber(e.target.value)} />
      </label>
      <label className="field">
        Map
        <select value={activeMapName} disabled={stage !== null} title={inRange ? 'Used for the stages that are new' : stage ? 'A recorded stage keeps its map' : 'Used because the stage is new'} onChange={(e) => setMapName(e.target.value)}>
          {stageMaps.map((m) => (
            <option key={m.name}>{m.name}</option>
          ))}
        </select>
      </label>
      {numberValid && (
        <span className="muted">
          {stage ? `${stage.attemptCount} previous attempt${stage.attemptCount === 1 ? '' : 's'}` : 'New stage'}
        </span>
      )}
    </>
  );

  const result = (
    <>
      {isApex(kind) && (
        <label className="field">
          Buff level
          <input type="number" min={0} value={buffLevel} onChange={(e) => setBuffLevel(e.target.value)} />
        </label>
      )}
    </>
  );

  // What only a Stage has: the range of stages one clear covered, and the Stage Enemies (which belong to one stage, not to a range).
  const fields = (
    <>
      {!editing && (
        <label className="field">
          Up to stage (optional)
          <input type="number" min={1} value={rangeEnd} placeholder="same formation" title="The same formation cleared every stage from the stage number to this one in auto-battle" onChange={(e) => changeRangeEnd(e.target.value)} />
        </label>
      )}
      {!inRange && <StageEnemiesField enemies={enemies} heroes={heroes} value={enemyDraft} onChange={setEnemyDraft} />}
    </>
  );

  return (
    <RecordShell
      title={editing ? 'Edit record' : 'New record'}
      identity={identity}
      result={result}
      fields={fields}
      note={note}
      onNote={setNote}
      tags={tags}
      onTags={setTags}
      lockedTags={inRange ? [{ tag: AFK_RANGE_TAG, title: `Added to stages ${stageNumber + 1} to ${rangeTo}, which copy the formation set on stage ${stageNumber}` }] : undefined}
      formationIds={<FormationIdField value={formation.formationId} onChange={(formationId) => setFormation({ ...formation, formationId })} teams={[{ placed: formation.placed, phantimal: formation.phantimal, artifact: formation.artifact }]} />}
      error={error}
      status={status}
      saveLabel={editing ? 'Save changes' : 'Save record'}
      onSave={() => void saveAttempt(false)}
      onSaveAnother={editing ? undefined : () => void saveAttempt(true)}
      saveDisabled={!numberValid || !map || formation.placed.length === 0}
      saving={saving.busy}
      onCancel={onCancel}
    >
      {numberValid && map ? (
        <FormationEditor
          map={map}
          heroes={heroes}
          artifacts={artifacts}
          phantimals={allowsPhantimal(kind) ? seasonPhantimals : null}
          season={stage?.season ?? season}
          value={formation}
          onChange={setFormation}
          heroSource="all"
          withState={false}
          mapLabel="Stage map"
        />
      ) : (
        <p className="muted">Enter the stage number to place the formation.</p>
      )}
    </RecordShell>
  );
}
