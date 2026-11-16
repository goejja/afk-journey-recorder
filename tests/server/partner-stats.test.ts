import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { partnerStats, partnerTags } from '../../src/query/index.js';
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
  app.request('/api/pvp/battles', {
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
