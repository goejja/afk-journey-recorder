import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { partnerStats, partnerTags, positionalPartners } from '../../src/query/index.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['Gunnar', 'Alna', 'B', 'C', 'X', 'Y']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  const attribute = db.prepare("INSERT INTO hero_attribute (hero, range, energy, mechanics, released_season, set_on, source) VALUES (?, NULL, '[]', ?, NULL, '2026-11-16', 'manual')");
  attribute.run('Gunnar', JSON.stringify(['protect', 'temp-buff']));
  attribute.run('Alna', JSON.stringify(['protect']));
  app = createApp(db);
});

const battle = (a: string[], b: string[], outcome: 'Win' | 'Loss', extra: object = {}) =>
  app.request('/api/pvp/fights', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'Arena', mapName: 'Open', outcome,
      formation: { heroes: a.map((hero, i) => ({ tile: 38 + i, hero })), phantimal: null, assistHero: null, artifact: null },
      opponent: { heroes: b.map((hero, i) => ({ tile: i, hero })) },
      ...extra,
    }),
  });

describe('partner statistics', () => {
  it('counts the heroes fielded on the same side as a hero, with their share of its games, and never the other side', async () => {
    await battle(['Gunnar', 'B', 'C'], ['X', 'Y'], 'Win');
    await battle(['Gunnar', 'B'], ['X'], 'Loss');
    await battle(['Gunnar', 'C'], ['Y'], 'Win');
    const report = partnerStats(db, 'Gunnar');
    expect(report).toMatchObject({ hero: 'Gunnar', games: 3, wins: 2, winRate: 0.667 });
    expect(report.partners).toEqual([
      { hero: 'C', games: 2, wins: 2, winRate: 1, share: 0.667 }, // the same games, the better win rate first
      { hero: 'B', games: 2, wins: 1, winRate: 0.5, share: 0.667 },
    ]);
  });

  it('answers for a hero with no records, and finds the hero without regard to case', async () => {
    expect(partnerStats(db, 'Alna')).toEqual({ hero: 'Alna', games: 0, wins: 0, winRate: 0, partners: [] });
    await battle(['Gunnar', 'B'], ['X'], 'Win');
    expect(partnerStats(db, 'gunnar').games).toBe(1);
  });

  it('applies the mode, player and season filters, and the minimum games', async () => {
    await battle(['Gunnar', 'B'], ['X'], 'Win', { mode: 'Supreme Arena' });
    await battle(['Gunnar', 'C'], ['X'], 'Win');
    expect(partnerStats(db, 'Gunnar', { mode: ['Arena'] }).partners.map((p) => p.hero)).toEqual(['C']);
    expect(partnerStats(db, 'Gunnar', { minGames: 2 }).partners).toEqual([]);
    expect(partnerStats(db, 'Gunnar', { playedIn: [99] }).games).toBe(0);
  });

  it('lists the mechanic tags with their heroes, the most carried first', () => {
    expect(partnerTags(db)).toEqual([
      { tag: 'protect', heroes: ['Alna', 'Gunnar'] },
      { tag: 'temp-buff', heroes: ['Gunnar'] },
    ]);
  });

  it('serves both views, and asks for a hero', async () => {
    await battle(['Gunnar', 'B'], ['X'], 'Win');
    const answer = await app.request('/api/stats/partners?hero=Gunnar&mode=Arena');
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { partners: unknown[] }).partners).toHaveLength(1);
    expect((await app.request('/api/stats/partners')).status).toBe(400);
    expect(await (await app.request('/api/stats/partner-tags')).json()).toHaveLength(2);
  });
});

describe('positional partner statistics', () => {
  /** A battle with each side's heroes on named tiles (the opponent's in the map's own numbering, as the editor records them). */
  const placed = (mine: Record<string, number>, theirs: Record<string, number>, outcome: 'Win' | 'Loss', extra: object = {}) =>
    app.request('/api/pvp/fights', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'Arena', mapName: 'Open', outcome,
        formation: { heroes: Object.entries(mine).map(([hero, tile]) => ({ tile, hero })), phantimal: null, assistHero: null, artifact: null },
        opponent: { heroes: Object.entries(theirs).map(([hero, tile]) => ({ tile, hero })) },
        ...extra,
      }),
    });

  it('counts who stood behind a hero, with the Players and exact layouts behind each partner', async () => {
    await placed({ Gunnar: 40, B: 43 }, { X: 0 }, 'Win'); // B behind Gunnar
    await placed({ Gunnar: 40, B: 43, C: 39 }, { X: 0 }, 'Loss'); // the same partner in another layout
    await placed({ Gunnar: 40, C: 43 }, { X: 0 }, 'Win'); // C behind
    await placed({ Gunnar: 40, B: 39 }, { X: 0 }, 'Win'); // nobody behind
    const report = positionalPartners(db, 'Gunnar', 'behind');
    expect(report).toMatchObject({ hero: 'Gunnar', relation: 'behind', games: 4, wins: 3, empty: 1 });
    expect(report.partners).toEqual([
      { hero: 'B', games: 2, wins: 1, winRate: 0.5, share: 0.5, players: 0, layouts: 2, oneLayout: false },
      { hero: 'C', games: 1, wins: 1, winRate: 1, share: 0.25, players: 0, layouts: 1, oneLayout: false },
    ]);
  });

  it('reads Side B from its own back edge, the map turned', async () => {
    // the opponent's tiles 4 and 1 are tiles 40 and 43 once turned: Y stands behind Gunnar
    expect((await placed({ B: 38 }, { Gunnar: 4, Y: 1 }, 'Loss')).status).toBe(201);
    expect(positionalPartners(db, 'Gunnar', 'behind').partners.map((p) => p.hero)).toEqual(['Y']);
  });

  it('flags a partner seen at least five times, half or more in one exact layout, as one repeated formation', async () => {
    for (let i = 0; i < 5; i += 1) await placed({ Gunnar: 40, B: 43 }, { X: 0 }, 'Win');
    await placed({ Gunnar: 40, B: 43, C: 38 }, { X: 0 }, 'Win');
    expect(positionalPartners(db, 'Gunnar', 'behind').partners[0]).toMatchObject({ hero: 'B', games: 6, layouts: 2, oneLayout: true });
  });

  it('counts the minimum games, finds the hero without regard to case, and serves the view', async () => {
    await placed({ Gunnar: 40, B: 43 }, { X: 0 }, 'Win');
    expect(positionalPartners(db, 'gunnar', 'behind', { minGames: 2 }).partners).toEqual([]);
    const answer = await app.request('/api/stats/partner-positions?hero=Gunnar&relation=behind');
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { partners: { hero: string }[] }).partners.map((p) => p.hero)).toEqual(['B']);
    expect((await app.request('/api/stats/partner-positions?hero=Gunnar&relation=nowhere')).status).toBe(400);
    expect((await app.request('/api/stats/partner-positions?relation=behind')).status).toBe(400);
  });
});

