import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
const open = Array(TILE_COUNT).fill(TILE.OPEN);

beforeEach(() => {
  const db = openDb(':memory:');
  const imported = JSON.stringify([...open.slice(0, 40), ...Array(5).fill(TILE.PLAYER)]);
  db.prepare(
    `INSERT INTO map (name, tags, row_lengths, cells, original_cells, source)
     VALUES ('Arena I', '["Arena"]', '[2,5,6,6,7,6,6,5,2]', ?, ?, 'import')`,
  ).run(imported, imported);
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const list = async () => (await (await send('GET', '/api/maps')).json()) as any[];
const get = async (name: string) => (await list()).find((m) => m.name === name);

describe('maps API', () => {
  it('lists maps with their tags and no restore option when untouched', async () => {
    const maps = await list();
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({ name: 'Arena I', tags: ['Arena'], source: 'import', canRestore: false, handMade: false });
    expect(maps[0].rowLengths).toEqual([2, 5, 6, 6, 7, 6, 6, 5, 2]);
  });

  it('creates a map', async () => {
    const response = await send('POST', '/api/maps', { name: ' Boss field ', tags: ['Stage'], cells: open });
    expect(response.status).toBe(201);
    expect(await get('Boss field')).toMatchObject({ source: 'manual', tags: ['Stage'], canRestore: false, handMade: false }); // a Stage map is never the source's
  });

  it('calls an Arena map made here hand-made, which the next import takes over when the source lists its name', async () => {
    await send('POST', '/api/maps', { name: 'Supreme Arena XV', tags: ['Arena'], cells: open });
    expect(await get('Supreme Arena XV')).toMatchObject({ source: 'manual', handMade: true });
  });

  it('rejects invalid and duplicate maps', async () => {
    expect((await send('POST', '/api/maps', { name: '', tags: [], cells: open })).status).toBe(400);
    expect((await send('POST', '/api/maps', { name: 'x', tags: [], cells: [1, 2] })).status).toBe(400);
    expect((await send('POST', '/api/maps', { name: 'Arena I', tags: [], cells: open })).status).toBe(409);
  });

  it('editing an import makes it manual and allows restoring the original', async () => {
    const edited = [...open];
    edited[0] = TILE.STONE_WALL;
    const response = await send('PUT', '/api/maps/Arena%20I', { name: 'Arena I', tags: ['Arena'], cells: edited });
    expect(await response.json()).toMatchObject({ source: 'manual', canRestore: true });

    const restored = await (await send('POST', '/api/maps/Arena%20I/restore')).json();
    expect(restored).toMatchObject({ source: 'import', canRestore: false });
    expect(restored.cells[0]).toBe(TILE.OPEN);
  });

  describe('Boost tiles', () => {
    // Arena I has player deployment tiles 40 to 44 and no enemy tile
    const save = (boostTiles: unknown, cells = (list().then((m) => m[0].cells) as Promise<number[]>)) => cells.then((c) => send('PUT', '/api/maps/Arena%20I', { name: 'Arena I', tags: ['Arena'], cells: c, boostTiles }));

    it('starts with none, and a map created without the list has none', async () => {
      expect((await list())[0].boostTiles).toEqual([]);
      await send('POST', '/api/maps', { name: 'Field', tags: ['Stage'], cells: open });
      expect((await get('Field')).boostTiles).toEqual([]);
    });

    it('keeps the Boost tiles of a map, sorted, as the player\'s own edit, and keeps them in a copy', async () => {
      const response = await save([44, 41]);
      expect(await response.json()).toMatchObject({ source: 'manual', boostTiles: [41, 44], canRestore: false });
      await send('POST', '/api/maps/Arena%20I/duplicate', { name: 'Copy' });
      expect((await get('Copy')).boostTiles).toEqual([41, 44]);
      expect((await (await save([])).json()).boostTiles).toEqual([]);
    });

    it('refuses a Boost tile that is not a deployment tile, one listed twice and one off the map', async () => {
      for (const bad of [[3], [41, 41], [45], [-1], [1.5], ['41']]) {
        const response = await save(bad);
        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: string }).error).toContain('A Boost tile must be a player or enemy deployment tile');
      }
      expect((await get('Arena I')).boostTiles).toEqual([]);
    });

    it('refuses a Boost tile on a tile that the same edit makes a wall', async () => {
      const cells = (await list())[0].cells.slice() as number[];
      cells[41] = TILE.WOOD_WALL;
      expect((await save([41], Promise.resolve(cells))).status).toBe(400);
    });

    it('keeps the marks when the imported original is restored, except on a tile that is no longer a deployment tile', async () => {
      const cells = (await list())[0].cells.slice() as number[];
      cells[3] = TILE.ENEMY; // the player turned a tile into an enemy deployment tile and marked it
      await save([3, 41], Promise.resolve(cells));
      expect((await (await send('POST', '/api/maps/Arena%20I/restore')).json())).toMatchObject({ source: 'import', boostTiles: [41] });
    });
  });

  it('leaves an import untouched when saved without changes', async () => {
    const current = await get('Arena I');
    const response = await send('PUT', '/api/maps/Arena%20I', { name: 'Arena I', tags: current.tags, cells: current.cells });
    expect(await response.json()).toMatchObject({ source: 'import' });
  });

  it('renames a map, but not onto an existing name', async () => {
    await send('POST', '/api/maps', { name: 'B', tags: [], cells: open });
    expect((await send('PUT', '/api/maps/B', { name: 'Arena I', tags: [], cells: open })).status).toBe(409);
    expect((await send('PUT', '/api/maps/B', { name: 'C', tags: [], cells: open })).status).toBe(200);
    expect(await get('B')).toBeUndefined();
  });

  it('duplicates a map as the player\'s own, without an original', async () => {
    const response = await send('POST', '/api/maps/Arena%20I/duplicate', { name: 'Arena I copy' });
    expect(response.status).toBe(201);
    expect(await get('Arena I copy')).toMatchObject({ source: 'manual', canRestore: false });
    expect((await send('POST', '/api/maps/Arena%20I/duplicate', { name: 'Arena I copy' })).status).toBe(409);
    expect((await send('POST', '/api/maps/Arena%20I%20copy/restore')).status).toBe(409);
  });

  it('deletes a map', async () => {
    expect((await send('DELETE', '/api/maps/Arena%20I')).status).toBe(204);
    expect(await get('Arena I')).toBeUndefined();
  });
});
