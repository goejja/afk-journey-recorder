import { Fragment, useState } from 'react';
import { ROW_LENGTHS, TILE, TILE_COUNT } from '../../src/domain/map.js';
import { deploymentFrom, deploymentProblem, isFormationId, normalizeFormationId, type Deployment } from '../../src/domain/layout.js';
import { api, type Artifact, type FormationIdEntry, type GameMap, type Hero, type Phantimal } from '../backend.js';
import { emptyFormation, FormationEditor, type FormationState } from '../FormationEditor.js';
import { HexMap } from '../HexMap.js';
import { Portrait } from '../Portrait.js';
import { useAction } from '../hooks/action.js';
import { useLoad } from '../hooks/load.js';
import { useConfirmActions } from '../hooks/confirm.js';
import { Notice } from '../ui/Notice.js';

const EMPTY_CELLS = Array<number>(TILE_COUNT).fill(TILE.OPEN);

/** The units of one stored team drawn on the board, where they stand. */
function LayoutMap({ code, team }: { code: string; team: NonNullable<Deployment['teams'][number]> }) {
  const { units } = team;
  return (
    <HexMap
      rowLengths={ROW_LENGTHS}
      cells={EMPTY_CELLS}
      label={`Positions of ${code}`}
      renderTile={(index) => {
        const unit = units.find((u) => u.tile === index);
        return unit ? <Portrait kind={unit.kind} name={unit.part || unit.hero} size={30} /> : undefined;
      }}
      tileTitle={(index) => {
        const unit = units.find((u) => u.tile === index);
        return unit ? (unit.part ? `${unit.hero} (${unit.part})` : unit.hero) : undefined;
      }}
    />
  );
}

interface Board {
  maps: GameMap[];
  heroes: Hero[];
  phantimals: Phantimal[];
  artifacts: Artifact[];
}

/** The most teams a Formation ID covers (Super League). */
const MOST_TEAMS = 5;

/** Types a code and places the units and artifact of each of its teams on a board, for a code that no record has named yet. */
function AddByHand({ onAdded, onCancel }: { onAdded: (code: string) => void; onCancel: () => void }) {
  // the map the player picked; until then the first Arena map that has deployment tiles
  const [pickedMap, setMapName] = useState('');
  const [code, setCode] = useState('');
  const [teams, setTeams] = useState<FormationState[]>(() => [emptyFormation()]);
  const [current, setCurrent] = useState(0);
  const { error: actionError, busy, run } = useAction();
  const loaded = useLoad<Board>(async () => {
    const [maps, heroes, phantimals, artifacts] = await Promise.all([api.maps(), api.heroes(), api.phantimals(), api.artifacts().catch(() => [] as Artifact[])]);
    return { maps: maps.filter((m) => m.cells.includes(TILE.PLAYER)), heroes, phantimals, artifacts };
  }, []);
  const board = loaded.data ?? null;
  const mapName = pickedMap || (board?.maps.find((m) => m.tags.includes('Arena'))?.name ?? board?.maps[0]?.name ?? '');
  const error = loaded.error ?? actionError;

  // A team without a unit is not part of the code, but the teams after it keep their numbers.
  const deployment = deploymentFrom(teams.map((t) => (t.placed.length === 0 && !t.phantimal ? null : { heroes: t.placed.map((p) => ({ tile: p.tile, hero: p.hero, part: p.part })), phantimal: t.phantimal, artifact: t.artifact || null })));
  while (deployment.teams.length > 0 && deployment.teams[deployment.teams.length - 1] === null) deployment.teams.pop();
  const normalized = normalizeFormationId(code);
  const problem = !isFormationId(normalized) ? 'A Formation ID is 8 characters: digits or capital letters' : deploymentProblem(deployment);

  const save = () => run(() => api.addFormationId(normalized, deployment), () => onAdded(normalized));

  const map = board?.maps.find((m) => m.name === mapName);
  return (
    <div className="panel">
      <h3>Add a Formation ID</h3>
      <p className="muted">Type the code, then place the units and choose the artifact of each team the code covers (up to {MOST_TEAMS}). The board only shows where units can stand; the map is not kept with the code.</p>
      <div className="filters">
        <label className="field">
          Code
          <input value={code} maxLength={8} aria-label="Formation ID" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </label>
        <label className="field">
          Board
          <select value={mapName} aria-label="Board map" onChange={(e) => setMapName(e.target.value)}>
            {board?.maps.map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="actions" role="group" aria-label="Teams">
        {teams.map((t, i) => (
          <button key={i} aria-pressed={i === current} className={i === current ? 'primary' : undefined} onClick={() => setCurrent(i)}>
            Team {i + 1}
            {t.placed.length > 0 || t.phantimal ? ` (${t.placed.length + (t.phantimal ? 1 : 0)})` : ''}
          </button>
        ))}
        {teams.length < MOST_TEAMS && (
          <button
            onClick={() => {
              setTeams((old) => [...old, emptyFormation()]);
              setCurrent(teams.length);
            }}
          >
            Add a team
          </button>
        )}
        {teams.length > 1 && (
          <button
            onClick={() => {
              setTeams((old) => old.slice(0, -1));
              setCurrent((old) => Math.min(old, teams.length - 2));
            }}
          >
            Remove team {teams.length}
          </button>
        )}
      </div>
      {board && !map && <Notice kind="error">No map has player deployment tiles. Paint some in Admin → Maps first.</Notice>}
      {map && board && (
        <FormationEditor
          key={current}
          map={map}
          heroes={board.heroes}
          artifacts={board.artifacts}
          phantimals={board.phantimals}
          value={teams[current]!}
          onChange={(next) => setTeams((old) => old.map((t, i) => (i === current ? next : t)))}
          heroSource="all"
          withAssist={false}
          mapLabel="Formation ID board"
        />
      )}
      {error && (
        <Notice kind="error">
          {error}
        </Notice>
      )}
      <div className="actions">
        <button className="primary" disabled={busy || problem !== null || !map} title={problem ?? undefined} onClick={() => void save()}>
          Add Formation ID
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** The player's Formation IDs: what each code stands for, where it was seen, and a way to remove one. */
export function FormationIdsAdmin() {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const loaded = useLoad(() => api.formationIds(), []);
  const entries = loaded.data ?? null;
  // a change reads the codes again
  const { error: actionError, busy, run } = useAction({ then: loaded.reload });
  const { confirmRun, dialog } = useConfirmActions(run);
  const error = loaded.error ?? actionError;

  const remove = (entry: FormationIdEntry) =>
    confirmRun(
      {
        title: `Delete the Formation ID ${entry.code}?`,
        message: entry.records === 0 ? undefined : `${entry.records} record${entry.records === 1 ? ' names' : 's name'} it and will forget it.`.trim(),
        confirmLabel: 'Delete',
      },
      () => api.deleteFormationId(entry.code),
    );

  return (
    <section>
      <div className="toolbar">
        <span className="muted">{entries?.length ?? ''} codes</span>
      </div>
      <p className="muted">
        The game's codes for a deployment of 1 to 5 teams, kept with the units, the tiles and the artifact of each team. A code is saved when you give it to a record; the maps are where it was seen, and do not decide whether a deployment matches.
        Deleting a code never deletes a record.
      </p>
      {error && (
        <Notice kind="error">
          {error}
        </Notice>
      )}
      {adding ? (
        <AddByHand
          onAdded={() => {
            setAdding(false);
            void loaded.reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="actions">
          <button onClick={() => setAdding(true)}>Add by hand</button>
        </div>
      )}
      {entries?.length === 0 && <p className="muted">No Formation ID yet. Type one under a formation when you record a fight, or add one by hand.</p>}
      {entries && entries.length > 0 && (
        <table className="board" aria-label="Formation IDs">
          <thead>
            <tr>
              <th>Code</th>
              <th>Teams</th>
              <th>Maps</th>
              <th>Artifacts</th>
              <th>Records</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const teams = entry.deployment.teams;
              const units = teams.reduce((sum, t) => sum + (t ? t.units.length : 0), 0);
              const covered = teams.filter((t) => t !== null).length;
              const artifacts = teams.flatMap((t, k) => (t?.artifact ? [teams.length > 1 ? `${k + 1}: ${t.artifact}` : t.artifact] : []));
              return (
                <Fragment key={entry.code}>
                  <tr>
                    <td>
                      <code>{entry.code}</code>
                    </td>
                    <td>
                      <button className="small" aria-expanded={open === entry.code} onClick={() => setOpen(open === entry.code ? null : entry.code)}>
                        {covered} {covered === 1 ? 'team' : 'teams'}, {units} {units === 1 ? 'unit' : 'units'}
                      </button>
                    </td>
                    <td>{entry.maps.join(', ') || <span className="muted">–</span>}</td>
                    <td>{artifacts.join(', ') || <span className="muted">–</span>}</td>
                    <td>{entry.records}</td>
                    <td>
                      <button className="danger small" disabled={busy} onClick={() => void remove(entry)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                  {open === entry.code && (
                    <tr>
                      <td colSpan={6}>
                        {teams.map((team, k) =>
                          team ? (
                            <div key={k}>
                              {teams.length > 1 && <h4>Team {k + 1}</h4>}
                              <LayoutMap code={teams.length > 1 ? `${entry.code} team ${k + 1}` : entry.code} team={team} />
                            </div>
                          ) : null,
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {dialog}
    </section>
  );
}
