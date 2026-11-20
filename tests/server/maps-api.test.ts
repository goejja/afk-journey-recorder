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
    expect(maps[0]).toMatchObject({ name: 'Arena I', tags: ['Arena'], source: 'import', canRestore: false });
    expect(maps[0].rowLengths).toEqual([2, 5, 6, 6, 7, 6, 6, 5, 2]);
  });

  it('creates a map', async () => {
    const response = await send('POST', '/api/maps', { name: ' Boss field ', tags: ['Stage'], cells: open });
    expect(response.status).toBe(201);
    expect(await get('Boss field')).toMatchObject({ source: 'manual', tags: ['Stage'], canRestore: false });
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
