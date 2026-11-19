import { Fragment, useCallback, useEffect, useState } from 'react';
import { ROW_LENGTHS, TILE, TILE_COUNT } from '../../src/domain/map.js';
import { deploymentFrom, deploymentProblem, isFormationId, normalizeFormationId, type Deployment } from '../../src/domain/layout.js';
import { api, type Artifact, type FormationIdEntry, type GameMap, type Hero, type Phantimal } from '../backend.js';
import { emptyFormation, FormationEditor, type FormationState } from '../FormationEditor.js';
import { HexMap } from '../HexMap.js';
import { Portrait } from '../Portrait.js';
import { useCrud } from '../useCrud.js';

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
  const [board, setBoard] = useState<Board | null>(null);
  const [mapName, setMapName] = useState('');
  const [code, setCode] = useState('');
  const [teams, setTeams] = useState<FormationState[]>(() => [emptyFormation()]);
  const [current, setCurrent] = useState(0);
  const { error, run } = useCrud();
  useEffect(() => {
    void run(
      () => Promise.all([api.maps(), api.heroes(), api.phantimals(), api.artifacts().catch(() => [] as Artifact[])]),
      ([maps, heroes, phantimals, artifacts]) => {
        const usable = maps.filter((m) => m.cells.includes(TILE.PLAYER));
        setBoard({ maps: usable, heroes, phantimals, artifacts });
        setMapName(usable.find((m) => m.tags.includes('Arena'))?.name ?? usable[0]?.name ?? '');
      },
    );
  }, [run]);

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
      {board && !map && <p className="error" role="alert">No map has player deployment tiles. Paint some in Admin → Maps first.</p>}
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
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="primary" disabled={problem !== null || !map} title={problem ?? undefined} onClick={() => void save()}>
          Add Formation ID
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** The player's Formation IDs: what each code stands for, where it was seen, and a way to remove one. */
export function FormationIdsAdmin() {
  const [entries, setEntries] = useState<FormationIdEntry[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { error, run, confirm, dialog } = useCrud();
  const reload = useCallback(() => run(() => api.formationIds(), setEntries), [run]);
  useEffect(() => void reload(), [reload]);

  async function remove(entry: FormationIdEntry) {
    const named = entry.records === 0 ? '' : ` ${entry.records} record${entry.records === 1 ? ' names' : 's name'} it and will forget it.`;
    if (
      !(await confirm({
        title: `Delete the Formation ID ${entry.code}?`,
        message: named.trim() || undefined,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    await run(() => api.deleteFormationId(entry.code), reload);
  }

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
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {adding ? (
        <AddByHand
          onAdded={() => {
            setAdding(false);
            reload();
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
                      <button className="danger small" onClick={() => void remove(entry)}>
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
