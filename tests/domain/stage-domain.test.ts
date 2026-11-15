import { describe, expect, it } from 'vitest';
import { validateFormation, type FormationContext } from '../../src/domain/formation.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { artifactsForSeason, selectableArtifacts, validateStageEnemies, validateStageKey } from '../../src/domain/stage.js';

describe('validateStageKey', () => {
  it('accepts Normal and Phantisomal without a phase, up to 2700', () => {
    expect(validateStageKey({ season: 8, phase: 0, kind: 'Normal', number: 2700 })).toBeNull();
    expect(validateStageKey({ season: 8, phase: 0, kind: 'Phantisomal', number: 1 })).toBeNull();
  });
  it('requires a phase for Apex stages, with numbers up to 1000', () => {
    expect(validateStageKey({ season: 8, phase: 2, kind: 'Apex Normal', number: 1000 })).toBeNull();
    expect(validateStageKey({ season: 8, phase: 0, kind: 'Apex Phantisomal', number: 5 })).toMatch(/phase/);
    expect(validateStageKey({ season: 8, phase: 2, kind: 'Apex Normal', number: 1001 })).toMatch(/1 to 1000/);
  });
  it('rejects a phase on standard stages, bad kinds, seasons and numbers', () => {
    expect(validateStageKey({ season: 8, phase: 1, kind: 'Normal', number: 5 })).toMatch(/no phase/);
    expect(validateStageKey({ season: 8, phase: 0, kind: 'Boss', number: 5 })).toMatch(/kind/);
    expect(validateStageKey({ season: 0, phase: 0, kind: 'Normal', number: 5 })).toMatch(/Season/);
    expect(validateStageKey({ season: 8, phase: 0, kind: 'Normal', number: 2701 })).toMatch(/1 to 2700/);
  });
});

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

describe('validateStageEnemies', () => {
  const known = new Set(['Grunt', 'Boss']);
  const heroes = new Set(['Alna']);
  it('accepts enemies and heroes with a count', () => {
    expect(validateStageEnemies([{ enemy: 'Grunt', count: 3 }, { enemy: 'Boss', count: 1 }, { hero: 'Alna', count: 2 }], known, heroes)).toBeNull();
    expect(validateStageEnemies([], known)).toBeNull();
  });
  it('rejects bad counts, unknown names, both names and a name listed twice', () => {
    expect(validateStageEnemies([{ enemy: 'Grunt', count: 0 }], known)).toMatch(/count/);
    expect(validateStageEnemies([{ enemy: 'Grunt', count: 1.5 }], known)).toMatch(/count/);
    expect(validateStageEnemies([{ enemy: 'Ghost', count: 1 }], known)).toMatch(/Unknown enemy/);
    expect(validateStageEnemies([{ hero: 'Nobody', count: 1 }], known, heroes)).toMatch(/Unknown hero/);
    expect(validateStageEnemies([{ enemy: 'Grunt', hero: 'Alna', count: 1 }], known, heroes)).toMatch(/either/);
    expect(validateStageEnemies([{ enemy: 'Grunt', count: 1 }, { enemy: 'Grunt', count: 2 }], known)).toMatch(/listed twice/);
  });
});

const ctx = (overrides: Partial<FormationContext> = {}): FormationContext => ({
  cells,
  phantimalAllowed: false,
  ownedHeroes: new Set(['A', 'B', 'C', 'D', 'E', 'F']),
  artifacts: new Set(['Awakening', 'Bladestorm']),
  seasonPhantimals: new Set(['Gervan']),
  heroFactions: new Map(),
  phantimalFactions: new Map(),
  ...overrides,
});
const heroes = (names: string[]) => names.map((hero, i) => ({ tile: 38 + i, hero }));
const base = { phantimal: null, assistHero: null, artifact: 'Bladestorm' };

describe('validateFormation', () => {
  it('accepts five owned heroes on player tiles with an artifact', () => {
    expect(validateFormation({ ...base, heroes: heroes(['A', 'B', 'C', 'D', 'E']) }, ctx())).toBeNull();
  });
  it('accepts a formation without an artifact', () => {
    expect(validateFormation({ ...base, heroes: heroes(['A']), artifact: null}, ctx())).toBeNull();
  });
  it('rejects zero, six, duplicate and unowned heroes', () => {
    expect(validateFormation({ ...base, heroes: [] }, ctx())).toMatch(/at least one/);
    expect(validateFormation({ ...base, heroes: heroes(['A', 'B', 'C', 'D', 'E', 'F']) }, ctx())).toMatch(/At most 5/);
    expect(validateFormation({ ...base, heroes: [{ tile: 38, hero: 'A' }, { tile: 39, hero: 'A' }] }, ctx())).toMatch(/twice/);
    expect(validateFormation({ ...base, heroes: heroes(['Z']) }, ctx())).toMatch(/not in your roster/);
  });
  it('rejects heroes off player tiles or sharing a tile', () => {
    expect(validateFormation({ ...base, heroes: [{ tile: 10, hero: 'A' }] }, ctx())).toMatch(/player deployment tile/);
    expect(validateFormation({ ...base, heroes: [{ tile: 38, hero: 'A' }, { tile: 38, hero: 'B' }] }, ctx())).toMatch(/used twice/);
  });
  it('allows a phantimal only on Phantisomal kinds and only if available in the season', () => {
    const withPhantimal = { ...base, heroes: heroes(['A']), phantimal: { tile: 40, name: 'Gervan' } };
    expect(validateFormation(withPhantimal, ctx())).toMatch(/does not allow a phantimal/);
    expect(validateFormation(withPhantimal, ctx({ phantimalAllowed: true }))).toBeNull();
    expect(validateFormation({ ...withPhantimal, phantimal: { tile: 40, name: 'Aurelian' } }, ctx({ phantimalAllowed: true }))).toMatch(/not available in this season/);
    expect(validateFormation({ ...withPhantimal, phantimal: { tile: 38, name: 'Gervan' } }, ctx({ phantimalAllowed: true }))).toMatch(/used twice/);
  });
  it('requires the assist hero to be owned and not placed', () => {
    expect(validateFormation({ ...base, heroes: heroes(['A']), assistHero: 'F' }, ctx())).toBeNull();
    expect(validateFormation({ ...base, heroes: heroes(['A']), assistHero: 'Z' }, ctx())).toMatch(/assist hero must be in your roster/);
    expect(validateFormation({ ...base, heroes: heroes(['A']), assistHero: 'A' }, ctx())).toMatch(/cannot also be placed/);
  });
  it('knows the artifact', () => {
    expect(validateFormation({ ...base, heroes: heroes(['A']), artifact: 'Awakening' }, ctx())).toBeNull();
    expect(validateFormation({ ...base, heroes: heroes(['A']), artifact: 'Nope' }, ctx())).toMatch(/Unknown artifact/);
    expect(validateFormation({ ...base, heroes: heroes(['A']), artifact: null }, ctx())).toBeNull();
  });

});

describe('artifactsForSeason', () => {
  const all = [
    { name: 'Awakening', group: 'Pre-Season' },
    { name: 'Arc Burst', group: 'Season 7' },
    { name: 'Bladestorm', group: 'Season 8' },
  ];

  it('keeps the pre-season artifacts and the season’s own', () => {
    expect(artifactsForSeason(all, 8).map((a) => a.name)).toEqual(['Awakening', 'Bladestorm']);
    expect(artifactsForSeason(all, 7).map((a) => a.name)).toEqual(['Awakening', 'Arc Burst']);
    expect(artifactsForSeason(all, 9).map((a) => a.name)).toEqual(['Awakening']);
  });
});

describe('selectableArtifacts', () => {
  const all = [
    { name: 'Awakening', group: 'Pre-Season' },
    { name: 'Arc Burst', group: 'Season 7' },
    { name: 'Bladestorm', group: 'Season 8' },
  ];

  it('adds an artifact already chosen even when it is from another season', () => {
    expect(selectableArtifacts(all, 8).map((a) => a.name)).toEqual(['Awakening', 'Bladestorm']);
    expect(selectableArtifacts(all, 8, ['Arc Burst']).map((a) => a.name)).toEqual(['Awakening', 'Arc Burst', 'Bladestorm']);
  });
});
