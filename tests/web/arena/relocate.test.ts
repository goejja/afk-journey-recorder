import { describe, expect, it } from 'vitest';
import { TILE } from '../../../src/domain/map.js';
import { emptyFormation } from '../../../web/FormationEditor.js';
import { emptyOpponent } from '../../../web/arena/OpponentEditor.js';
import { keepOnMap } from '../../../web/relocate.js';

// Ten tiles: 0-2 enemy, 3-4 open, 5-9 player.
const cells = (enemy: number[], player: number[]) => Array.from({ length: 10 }, (_, i) => (enemy.includes(i) ? TILE.ENEMY : player.includes(i) ? TILE.PLAYER : TILE.OPEN));
const a = (hero: string, tile: number) => ({ tile, hero });
const b = (hero: string, tile: number) => ({ tile, hero, rank: 'Elite', equipment: '5' });

describe('keepOnMap', () => {
  it('leaves units where they stand when the new map has a deployment tile there', () => {
    const formation = { ...emptyFormation(), placed: [a('Evie', 5), a('Fay', 6)] };
    const opponent = { ...emptyOpponent(), placed: [b('Zed', 0)] };
    const kept = keepOnMap(cells([0, 1, 2], [5, 6, 7]), formation, opponent);
    expect(kept.formation.placed.map((p) => p.tile)).toEqual([5, 6]);
    expect(kept.opponent.placed.map((p) => p.tile)).toEqual([0]);
  });

  it('moves a unit off an invalid tile to the lowest free tile of its side, never onto a unit that stays', () => {
    const formation = { ...emptyFormation(), placed: [a('Evie', 5), a('Fay', 6)] };
    const kept = keepOnMap(cells([0], [6, 7, 8]), formation, emptyOpponent()); // tile 5 is no longer ours; 6 stays
    expect(kept.formation.placed).toEqual([a('Evie', 7), a('Fay', 6)]);
  });

  it('keeps ranks, equipment, artifact, phantimal state, and relocates the phantimal too', () => {
    const formation = { ...emptyFormation(), artifact: 'Bladestorm', placed: [a('Evie', 5)], phantimal: { tile: 6, name: 'Gervan' }, snapshots: { Evie: { rank: 'Elite', equipmentLevel: 5 } } };
    const opponent = { ...emptyOpponent(), artifact: 'Arc Burst', placed: [b('Zed', 3)], phantimal: { tile: 4, name: 'Olden' } };
    const kept = keepOnMap(cells([0, 1], [8, 9]), formation, opponent);
    expect(kept.formation).toMatchObject({ artifact: 'Bladestorm', snapshots: formation.snapshots, placed: [a('Evie', 8)], phantimal: { tile: 9, name: 'Gervan' } });
    expect(kept.opponent).toMatchObject({ artifact: 'Arc Burst', placed: [b('Zed', 0)], phantimal: { tile: 1, name: 'Olden' } });
  });

  it('drops a unit only when its side has no free tile left', () => {
    const formation = { ...emptyFormation(), placed: [a('Evie', 5), a('Fay', 6)] };
    const kept = keepOnMap(cells([0], [9]), formation, emptyOpponent());
    expect(kept.formation.placed).toEqual([a('Evie', 9)]);
  });

  it('relocates each part of a phantimal pair on its own, and leaves the second part out when no tile is left', () => {
    const formation = { ...emptyFormation(), phantimal: { tile: 5, name: 'Wedge of Matter', partnerTile: 6 } };
    const moved = keepOnMap(cells([0], [7, 8]), formation, emptyOpponent());
    expect(moved.formation.phantimal).toEqual({ tile: 7, name: 'Wedge of Matter', partnerTile: 8 });
    const short = keepOnMap(cells([0], [7]), formation, emptyOpponent());
    expect(short.formation.phantimal).toEqual({ tile: 7, name: 'Wedge of Matter', partnerTile: null });
  });
});
