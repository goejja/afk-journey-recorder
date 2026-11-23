import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { formationArchetypes, formationGroups } from '../../src/query/index.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of 'ABCDEFGHIJKLM'.split('')) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  app = createApp(db);
});

const team = (names: string[]) => ({ heroes: names.map((hero, i) => ({ tile: 38 + i, hero })), phantimal: null, assistHero: null, artifact: null});
/** A fight of `mine` against a lone hero `Z`-side stand-in (`M`), which is too small to form a group. */
const fight = (outcome: 'Win' | 'Loss', mine: string[], extra: Record<string, unknown> = {}) =>
  app.request('/api/pvp/fights', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'Arena', mapName: 'Open', outcome, formation: team(mine), opponent: { heroes: [{ tile: 0, hero: 'M' }] }, ...extra }),
  });
const record = async (times: number, outcome: 'Win' | 'Loss', mine: string[], extra: Record<string, unknown> = {}) => {
  for (let i = 0; i < times; i += 1) await fight(outcome, mine, extra);
};
const groupOf = (hero: string) => formationGroups(db).find((g) => g.core.some((c) => c.hero === hero));

describe('formation groups: core and flex by share of appearances', () => {
  it('calls a hero in at least 80% of the appearances core and one in 15% to below 80% flex, each with its share', async () => {
    await record(8, 'Win', ['A', 'B', 'C', 'D', 'E']);
    await record(2, 'Loss', ['A', 'B', 'C', 'D', 'F']);

    const group = groupOf('A')!;
    expect(group.games).toBe(10);
    expect(group.core).toEqual([
      { hero: 'A', share: 1 },
      { hero: 'B', share: 1 },
      { hero: 'C', share: 1 },
      { hero: 'D', share: 1 },
      { hero: 'E', share: 0.8 },
    ]);
    expect(group.flex).toEqual([{ hero: 'F', share: 0.2 }]);
  });

  it('leaves out a hero in fewer than 15% of the appearances', async () => {
    await record(9, 'Win', ['A', 'B', 'C', 'D', 'E']);
    await record(1, 'Loss', ['A', 'B', 'C', 'D', 'F']);

    const group = groupOf('A')!;
    expect(group.core.map((c) => c.hero)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(group.flex).toEqual([]);
  });
});

describe('formation groups: players and the hero picker', () => {
  it('counts the different Players behind a group and leaves out sides with no known Player', async () => {
    await record(2, 'Win', ['A', 'B', 'C', 'D', 'E'], { playerIdA: '111' });
    await record(1, 'Loss', ['A', 'B', 'C', 'D', 'E'], { playerIdA: '222' });
    await record(1, 'Win', ['A', 'B', 'C', 'D', 'E']);

    expect(groupOf('A')!.players).toBe(2);
  });

  it('keeps only the groups that hold every hero picked, as core or flex', async () => {
    await record(4, 'Win', ['A', 'B', 'C', 'D', 'E']);
    await record(1, 'Loss', ['A', 'B', 'C', 'D', 'F']);
    await record(3, 'Win', ['G', 'H', 'I', 'J', 'K']);

    const named = (heroes: string[]) => formationGroups(db, { hero: heroes }).map((g) => g.core[0]!.hero);
    expect(named(['F'])).toEqual(['A']);
    expect(named(['A', 'E'])).toEqual(['A']);
    expect(named(['A', 'G'])).toEqual([]);
    expect(named([])).toEqual(expect.arrayContaining(['A', 'G']));
  });
});

describe('archetypes: groups that share two or more core heroes', () => {
  it('lists them under one row that counts their games together and names what they share', async () => {
    await record(3, 'Win', ['A', 'B', 'C', 'D', 'E']);
    await record(1, 'Loss', ['A', 'B', 'C', 'F', 'G']);
    await record(2, 'Win', ['H', 'I', 'J', 'K', 'L']);

    const rows = formationArchetypes(formationGroups(db)).filter((r) => r.core.some((c) => c.hero === 'A' || c.hero === 'H'));
    expect(rows.map((r) => [r.core.map((c) => c.hero), r.games, r.wins, r.groups.length])).toEqual([
      [['A', 'B', 'C'], 4, 3, 2],
      [['H', 'I', 'J', 'K', 'L'], 2, 2, 1],
    ]);
    expect(rows[0]!.core.map((c) => c.share)).toEqual([1, 1, 1]);
    expect(rows[0]!.flex).toEqual([{ hero: 'D', share: 0.75 }, { hero: 'E', share: 0.75 }, { hero: 'F', share: 0.25 }, { hero: 'G', share: 0.25 }]);
    expect(rows[0]!.groups.map((g) => g.games)).toEqual([3, 1]);
  });

  it('counts the Players behind an archetype once each across its groups', async () => {
    await record(1, 'Win', ['A', 'B', 'C', 'D', 'E'], { playerIdA: '111' });
    await record(1, 'Win', ['A', 'B', 'C', 'F', 'G'], { playerIdA: '111' });
    await record(1, 'Loss', ['A', 'B', 'C', 'F', 'G'], { playerIdA: '222' });

    const row = formationArchetypes(formationGroups(db)).find((r) => r.core.some((c) => c.hero === 'A'))!;
    expect(row.players).toBe(2);
  });

  it('keeps a group that shares only one core hero with a row apart from it', async () => {
    await record(2, 'Win', ['A', 'B', 'C', 'D', 'E']);
    await record(2, 'Win', ['A', 'H', 'I', 'J', 'K']);

    const rows = formationArchetypes(formationGroups(db)).filter((r) => r.core.some((c) => c.hero === 'A'));
    expect(rows.map((r) => r.groups.length)).toEqual([1, 1]);
  });
});
