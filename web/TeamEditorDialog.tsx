import { useState } from 'react';
import { TILE } from '../src/domain/map.js';
import type { RoundTeam } from '../src/domain/round-deployment.js';
import type { Artifact, GameMap, Hero, Phantimal, Rules } from './backend.js';
import { emptyFormation, FormationEditor, type FormationState } from './FormationEditor.js';
import { guessOf, ownFromTeam, pruneGuess, standsOn, teamOfOwn, withoutGuess, type GuessTiles } from './arena/round-deployment.js';
import { Dialog } from './ui/Dialog.js';

/**
 * The form's own placement control for one team of a Round Deployment (ADR 0021): the five teams of a Round have their tiles placed here,
 * on a Map, when a saved Battle has not shown them yet. Tiles the control only guessed stay unknown when the team is saved.
 */
export function TeamEditorDialog({ title, team, maps, heroes, artifacts, phantimals, rules, onSave, onClose }: {
  title: string;
  team: RoundTeam;
  maps: GameMap[];
  heroes: Hero[];
  artifacts: Artifact[];
  phantimals: Phantimal[];
  rules: Rules;
  onSave: (team: RoundTeam) => void;
  onClose: () => void;
}) {
  const arenaMaps = maps.filter((m) => m.tags.includes('Arena'));
  const firstMap = arenaMaps[0] ?? maps[0];
  const startFor = (map: GameMap | undefined): { formation: FormationState; guess: GuessTiles | undefined } => {
    if (!map) return { formation: emptyFormation(), guess: undefined };
    const formation = ownFromTeam(team, map.cells);
    // tiles the team already knows and that fit the map are a placement; the rest are the form's first free tiles
    return { formation, guess: standsOn(team, map.cells, TILE.PLAYER) ? undefined : pruneGuess(guessOf(map.name, formation.placed, formation.phantimal), team) };
  };
  const [mapName, setMapName] = useState(team.mapName ?? firstMap?.name ?? '');
  const [state, setState] = useState(() => startFor(maps.find((m) => m.name === (team.mapName ?? firstMap?.name))));

  const changeMap = (name: string) => {
    const map = maps.find((m) => m.name === name);
    setMapName(name);
    if (map) setState(startFor(map));
  };

  const save = () => {
    const map = maps.find((m) => m.name === mapName);
    const made = teamOfOwn(state.formation);
    if (!map || !made) return onClose();
    const known = state.guess ? withoutGuess(made, state.guess, map.name) : made;
    // the Map says where the tiles were placed, so a team left with no tile has none
    const placed = known.heroes.some((h) => h.tile !== null) || known.phantimal?.tile != null;
    onSave({ ...known, ...(placed ? { mapName: map.name } : {}), ...(team.seenAs ? { seenAs: team.seenAs } : {}) });
  };

  const map = maps.find((m) => m.name === mapName);
  return (
    <Dialog
      title={title}
      message="Place the team on the Map you have seen it on. Tiles you do not place stay unknown, and the first saved Battle of the Round fills them."
      closeOnBackdrop
      onCancel={onClose}
      actions={
        <div className="overlay-actions">
          <button className="primary" data-confirm onClick={save} disabled={!map}>
            Save the team
          </button>
          <button data-cancel onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <label className="field dialog-field">
        Map
        <select aria-label="Map of the team" value={mapName} onChange={(e) => changeMap(e.target.value)}>
          {arenaMaps.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {map ? (
        <FormationEditor
          map={map}
          heroes={heroes}
          artifacts={artifacts}
          phantimals={phantimals}
          rules={rules}
          value={state.formation}
          onChange={(formation) => setState((old) => ({ ...old, formation }))}
          withAssist={false}
          mapLabel={`Team of ${title}`}
        />
      ) : (
        <p className="error" role="alert">This Round has no Arena Map to place the team on. Add one in Admin → Maps first.</p>
      )}
    </Dialog>
  );
}
