import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const rowLengths = '[2,5,6,6,7,6,6,5,2]';

function seed(target: Database.Database) {
  target.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\",\"Arena\"]', ?, ?, 'manual')").run(rowLengths, JSON.stringify(cells));
  for (const name of ['A', 'B', 'C', 'H']) target.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  for (const [rank, i] of [['Mythic', 1], ['Mythic+', 2]] as const) target.prepare('INSERT INTO rank (name, position) VALUES (?, ?)').run(rank, i);
  for (const name of ['A', 'B', 'C']) target.prepare('INSERT INTO roster (hero_name, rank) VALUES (?, ?)').run(name, 'Mythic');
  target.prepare("INSERT INTO boss (name, class) VALUES ('King Croaker', 'Mage')").run();
}

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const team = (names: string[], extra: object = {}) => ({
  heroes: names.map((hero, i) => ({ tile: 38 + i, hero, ...extra })),
  phantimal: null, assistHero: null, artifact: null,
});

describe('editing a stage attempt', () => {
  it('changes the heroes and note, keeping a stored rank the roster has outgrown', async () => {
    const stage = await json(send('POST', '/api/stages', { season: 8, phase: 0, kind: 'Normal', number: 10, mapName: 'Open' }));
    const created = await json(send('POST', '/api/attempts', { stageId: stage.id, formation: team(['A', 'B']) }));
    db.prepare("UPDATE roster SET rank = 'Mythic+'").run();
    const edited = await json(
      send('PUT', `/api/attempts/${created.id}`, {
        stageId: stage.id,
        note: 'typo',
        formation: { ...team(['A', 'C']), heroes: [{ tile: 38, hero: 'A', rank: 'Mythic' }, { tile: 39, hero: 'C' }] },
      }),
    );
    expect(edited).toMatchObject({ id: created.id, note: 'typo' });
    expect(edited.formation.heroes.map((h: any) => [h.name, h.rank])).toEqual([['A', 'Mythic'], ['C', 'Mythic+']]);
    expect(await json(send('GET', '/api/attempts'))).toHaveLength(1);
  });

  it('can move the attempt to another stage and rejects bad edits', async () => {
    const first = await json(send('POST', '/api/stages', { season: 8, phase: 0, kind: 'Normal', number: 10, mapName: 'Open' }));
    const second = await json(send('POST', '/api/stages', { season: 8, phase: 0, kind: 'Normal', number: 11, mapName: 'Open' }));
    const created = await json(send('POST', '/api/attempts', { stageId: first.id, formation: team(['A']) }));
    const moved = await json(send('PUT', `/api/attempts/${created.id}`, { stageId: second.id, formation: team(['A']) }));
    expect(moved.stage.number).toBe(11);
    expect((await send('PUT', '/api/attempts/999', { stageId: first.id, formation: team(['A']) })).status).toBe(404);
    expect((await send('PUT', `/api/attempts/${created.id}`, { stageId: first.id, outcome: 'Loss', formation: team(['A']) })).status).toBe(400);
  });

  it('saves an old Loss attempt as a clear', async () => {
    const stage = await json(send('POST', '/api/stages', { season: 8, phase: 0, kind: 'Normal', number: 10, mapName: 'Open' }));
    const created = await json(send('POST', '/api/attempts', { stageId: stage.id, formation: team(['A']) }));
    db.prepare("UPDATE attempt SET outcome = 'Loss' WHERE id = ?").run(created.id);
    expect(await json(send('GET', '/api/attempts'))).toHaveLength(1);
    expect((await send('PUT', `/api/attempts/${created.id}`, { stageId: stage.id, note: 'again', formation: team(['A']) })).status).toBe(200);
    expect(db.prepare('SELECT outcome FROM attempt WHERE id = ?').pluck().get(created.id)).toBe('Win');
  });
});

describe('editing a Dream Hunt fight', () => {
  const fight = (extra: object = {}) => ({ boss: 'King Croaker', mapName: 'Open', outcome: 'Win', timeSeconds: 90, formation: team(['A']), ...extra });

  it('fixes the time and team of a fight', async () => {
    const created = await json(send('POST', '/api/dream-hunt/attempts', fight()));
    const edited = await json(send('PUT', `/api/dream-hunt/attempts/${created.id}`, fight({ timeSeconds: 75, formation: team(['B']) })));
    expect(edited).toMatchObject({ id: created.id, timeSeconds: 75 });
    expect(edited.formation.heroes.map((h: any) => h.name)).toEqual(['B']);
    expect((await send('PUT', `/api/dream-hunt/attempts/${created.id}`, fight({ outcome: 'Win', timeSeconds: null }))).status).toBe(400);
    expect((await send('PUT', '/api/dream-hunt/attempts/999', fight())).status).toBe(404);
  });
});
