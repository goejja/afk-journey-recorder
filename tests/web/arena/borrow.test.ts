import { describe, expect, it } from 'vitest';
import { formationBorrow, withoutArtifact, withoutHero } from '../../../web/arena/borrow.js';
import { emptyFormation, type FormationState } from '../../../web/FormationEditor.js';

const team = (patch: Partial<FormationState>): { formation: FormationState } => ({ formation: { ...emptyFormation(), ...patch } });

describe('taking a hero out of a team', () => {
  it('removes every unit of the hero, with its state, and its place as assist hero', () => {
    const f = {
      ...emptyFormation(),
      placed: [{ tile: 38, hero: 'Alna' }, { tile: 39, hero: 'Elijah & Lailah', part: 'Elijah' }, { tile: 40, hero: 'Elijah & Lailah', part: 'Lailah' }],
      snapshots: { Alna: { rank: 'Epic', equipmentLevel: 5 }, 'Elijah & Lailah': { rank: 'Mythic+', equipmentLevel: 10 } },
    };
    const out = withoutHero(f, 'Elijah & Lailah');
    expect(out.placed).toEqual([{ tile: 38, hero: 'Alna' }]); // a pair goes whole
    expect(Object.keys(out.snapshots)).toEqual(['Alna']);
    expect(withoutHero({ ...f, assist: 'Alna', placed: [] }, 'Alna').assist).toBe('');
  });

  it('takes the summons of Zanie and Phraesto along', () => {
    const f = { ...emptyFormation(), placed: [{ tile: 38, hero: 'Zanie' }, { tile: 39, hero: 'Zanie', part: 'Laser Turret' }, { tile: 40, hero: 'Zanie', part: 'Laser Turret' }, { tile: 41, hero: 'Phraesto' }, { tile: 42, hero: 'Phraesto', part: 'Phraesto clone' }] };
    expect(withoutHero(f, 'Zanie').placed.map((p) => p.tile)).toEqual([41, 42]);
    expect(withoutHero(f, 'Phraesto').placed.map((p) => p.tile)).toEqual([38, 39, 40]);
  });

  it('leaves the artifact alone, and an artifact goes with its level', () => {
    const f = { ...emptyFormation(), artifact: 'Bladestorm', placed: [{ tile: 38, hero: 'Alna' }] };
    expect(withoutHero(f, 'Alna').artifact).toBe('Bladestorm');
    expect(withoutArtifact(f, 'Bladestorm')).toMatchObject({ artifact: '', placed: f.placed });
    expect(withoutArtifact(f, 'Other')).toBe(f);
  });
});

describe('formationBorrow', () => {
  const drafts = [team({ placed: [{ tile: 38, hero: 'Alna' }], artifact: 'Bladestorm' }), team({}), team({ assist: 'Rolan' })];

  it('says which other team holds a hero or an artifact, never the current one', () => {
    const borrow = formationBorrow(drafts, 1, 'fight', () => {}, true);
    expect([borrow.heroHolder('Alna'), borrow.heroHolder('Rolan'), borrow.heroHolder('Free')]).toEqual(['fight 1', 'fight 3', null]);
    expect(borrow.artifactHolder('Bladestorm')).toBe('fight 1');
    expect(formationBorrow(drafts, 0, 'fight', () => {}, true).heroHolder('Alna')).toBeNull();
    expect(formationBorrow(drafts, 1, 'team', () => {}, false).artifactHolder('Bladestorm')).toBeNull(); // artifacts are not shared out in every mode
  });

  it('releases from the team that holds it and nowhere else', () => {
    let state = drafts;
    const borrow = formationBorrow(drafts, 1, 'fight', (update) => (state = update(state)), true);
    borrow.releaseHero('Alna');
    borrow.releaseArtifact('Bladestorm');
    expect(state[0]!.formation).toMatchObject({ placed: [], artifact: '' });
    expect(state[2]).toBe(drafts[2]);
  });
});
