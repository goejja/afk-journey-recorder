import { describe, expect, it } from 'vitest';
import { swapSides, turnFormation } from '../../../web/arena/swap-sides.js';
import { emptyFormation } from '../../../web/FormationEditor.js';
import { emptyOpponent } from '../../../web/arena/OpponentEditor.js';
import type { Draft } from '../../../web/arena/draft.js';

const draft = (): Draft => ({
  mapName: 'Arena 1',
  rule: '',
  outcome: 'Win',
  note: 'n',
  tags: ['t'],
  playerIdA: '111',
  playerIdB: '222',
  unionLevel: '5',
  opponentUnionLevel: '9',
  formation: {
    ...emptyFormation(),
    placed: [{ tile: 3, hero: 'Lucius' }, { tile: 4, hero: 'Zanie', part: 'turret' }],
    phantimal: { tile: 10, name: 'Hellhound', partnerTile: 11 },
    phantimalChoice: 'Hellhound',
    assist: 'Reinier',
    artifact: 'Sword',
    formationId: 'AAAAAAAA',
    snapshots: { Lucius: { rank: 'Mythic', equipmentLevel: 9 }, Reinier: { rank: 'Elite', equipmentLevel: null } },
  },
  opponent: {
    ...emptyOpponent(),
    placed: [{ tile: 40, hero: 'Brutus', rank: 'Legendary', equipment: '5' }],
    assist: { hero: 'Talene', rank: 'Epic', equipment: '' },
    artifact: 'Shield',
    formationId: 'BBBBBBBB',
  },
});

describe('swapSides', () => {
  it('exchanges what each side owns, turning the tiles', () => {
    const s = swapSides(draft());
    expect(s.playerIdA).toBe('222');
    expect(s.playerIdB).toBe('111');
    expect(s.unionLevel).toBe('9');
    expect(s.opponentUnionLevel).toBe('5');
    expect(s.formation.placed).toEqual([{ tile: 4, hero: 'Brutus' }]);
    expect(s.formation.snapshots).toEqual({ Brutus: { rank: 'Legendary', equipmentLevel: 5 }, Talene: { rank: 'Epic', equipmentLevel: null } });
    expect(s.formation.assist).toBe('Talene');
    expect(s.formation.artifact).toBe('Shield');
    expect(s.formation.formationId).toBe('BBBBBBBB');
    expect(s.opponent.placed).toEqual([
      { tile: 41, hero: 'Lucius', rank: 'Mythic', equipment: '9' },
      { tile: 40, hero: 'Zanie', part: 'turret', rank: '', equipment: '' },
    ]);
    expect(s.opponent.phantimal).toEqual({ tile: 34, name: 'Hellhound', partnerTile: 33 });
    expect(s.opponent.assist).toEqual({ hero: 'Reinier', rank: 'Elite', equipment: '' });
    expect(s.opponent.artifact).toBe('Sword');
  });

  it('flips the result and keeps the map, note and tags', () => {
    const s = swapSides(draft());
    expect(s.outcome).toBe('Loss');
    expect(swapSides(s).outcome).toBe('Win');
    expect([s.mapName, s.note, s.tags]).toEqual(['Arena 1', 'n', ['t']]);
  });

  it('twice gives the draft back', () => {
    const d = draft();
    expect(swapSides(swapSides(d))).toEqual(d);
  });

  it('moves what a picture read and the tiles the form guessed along with their side', () => {
    const d = draft();
    const read = (hero: string) => [{ hero }] as any;
    d.seen = { A: read('Lucius'), B: read('Brutus') };
    d.guess = { A: { mapName: 'Arena 1', heroes: { Lucius: [3] }, phantimal: { tile: 10, partnerTile: 11 } }, B: undefined };
    d.imported = { A: { read: 'a' as any, crops: [] as any }, B: { read: 'b' as any, crops: [] as any } };
    const s = swapSides(d);
    expect(s.seen).toEqual({ A: read('Brutus'), B: read('Lucius') });
    expect(s.guess).toEqual({ A: undefined, B: { mapName: 'Arena 1', heroes: { Lucius: [41] }, phantimal: { tile: 34, partnerTile: 33 } } });
    expect([s.imported!.A.read, s.imported!.B.read]).toEqual(['b', 'a']);
    expect(swapSides(s)).toEqual(d);
  });
});

describe('turnFormation', () => {
  it('turns every unit tile and gives the formation back when turned twice', () => {
    const f = { ...emptyFormation(), placed: [{ tile: 3, hero: 'Lucius' }], phantimal: { tile: 10, name: 'Hellhound', partnerTile: 11 }, artifact: 'Sword' };
    const t = turnFormation(f);
    expect(t.placed).toEqual([{ tile: 41, hero: 'Lucius' }]);
    expect(t.phantimal).toEqual({ tile: 34, name: 'Hellhound', partnerTile: 33 });
    expect(t.artifact).toBe('Sword');
    expect(turnFormation(t)).toEqual(f);
  });
});
