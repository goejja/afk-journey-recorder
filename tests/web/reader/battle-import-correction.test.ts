import { describe, expect, it } from 'vitest';
import { correctHeroes, feedbackOf, knownTeams, type KnownTeam } from '../../../web/reader/battle-import.js';
import type { BattleDraftSide } from '../../../web/backend.js';
import { draftSide } from '../../support/draft-side.js';

const side = (names: string[], unread: string[] = []): BattleDraftSide => draftSide({
  name: 'Rover',
  profile: null,
  heroes: names.map((hero, i) => ({ tile: `t${i}`, hero, rank: 'Supreme', equipmentLevel: 15 })),
  unread,
});
const team = (names: string[], from = 'a saved fight'): KnownTeam => ({ heroes: [...names].sort(), from });
const five = ['Alna', 'Bryn', 'Cade', 'Dora', 'Elio'];

describe('correctHeroes', () => {
  it('fills a hero nobody could name from one team that has all the others', () => {
    const fix = correctHeroes(side(five.slice(0, 4), ['u1']), [team(five)]);
    expect(fix?.corrected).toEqual([{ from: null, to: 'Elio' }]);
    expect(fix?.heroes.map((h) => h.hero).sort()).toEqual(five);
    expect(fix?.unread).toEqual([]);
  });

  it('replaces a named hero that differs only when two known teams agree', () => {
    const misread = side(['Alna', 'Bryn', 'Cade', 'Dora', 'Wrong']);
    expect(correctHeroes(misread, [team(five)])).toBeNull();
    const fix = correctHeroes(misread, [team(five), team(five, 'the other pictures')]);
    expect(fix?.corrected).toEqual([{ from: 'Wrong', to: 'Elio' }]);
    expect(fix?.heroes.find((h) => h.hero === 'Elio')?.rank).toBeNull();
    expect(fix?.heroes.find((h) => h.hero === 'Alna')?.rank).toBe('Supreme');
  });

  it('leaves an exact match, three differences and a tie as read', () => {
    expect(correctHeroes(side(five), [team(five)])).toBeNull();
    expect(correctHeroes(side(['Alna', 'Bryn', 'X', 'Y', 'Z']), [team(five), team(five)])).toBeNull();
    const rival = ['Alna', 'Bryn', 'Cade', 'Dora', 'Fynn'];
    expect(correctHeroes(side(five.slice(0, 4), ['u1']), [team(five), team(rival)])).toBeNull();
  });

  it('picks the team with the fewest differences', () => {
    const rival = ['Alna', 'Bryn', 'Gus', 'Hal', 'Ira'];
    const fix = correctHeroes(side(['Alna', 'Bryn', 'Cade', 'Dora', 'Wrong']), [team(five), team(five), team(rival)]);
    expect(fix?.corrected).toEqual([{ from: 'Wrong', to: 'Elio' }]);
  });

  it('takes the heroes of saved sides without their summons', () => {
    const saved = { heroes: [{ tile: 1, name: 'Alna' }, { tile: 2, name: 'Zanie' }, { tile: 3, name: 'Zanie', part: 'Laser Turret' }] } as never;
    expect(knownTeams([saved], 'x')[0]!.heroes).toEqual(['Alna', 'Zanie']);
  });
});

describe('feedbackOf with corrected heroes', () => {
  it('does not offer a corrected hero as something the player kept', () => {
    const placed = ['Alna', 'Elio'].map((hero, tile) => ({ hero, tile }));
    const form = { placed, snapshots: {}, phantimal: null, artifact: ''} as never;
    const imported = { read: { heroes: [{ hero: 'Alna', rank: null, equipmentLevel: null }], artifact: null, phantimal: null }, crops: { artifact: null, phantimal: null }, corrected: ['Elio'] };
    const [a] = feedbackOf([{ imported: { A: imported, B: imported }, formation: form, opponent: { placed: [], phantimal: null, artifact: ''} as never }]);
    expect(a!.final.heroes.map((h) => h.hero)).toEqual(['Alna']);
  });
});
