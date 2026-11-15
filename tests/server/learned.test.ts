import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let db: Database.Database;
let app: Hono;
let images: string;
const ACT = { 'x-afk-action': 'learned', 'content-type': 'application/json' };

/** A tile picture: a top of one colour with a band of another, like a frame with an ornament, over a plain body (as in rank-read.test). */
const tile = (top: [number, number, number], band: [number, number, number], shift = 0) =>
  sharp({ create: { width: 90, height: 150, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .composite([
      { input: { create: { width: 90, height: 40, channels: 3, background: { r: top[0], g: top[1], b: top[2] } } }, left: 0, top: 0 },
      { input: { create: { width: 50, height: 12, channels: 3, background: { r: band[0], g: band[1], b: band[2] } } }, left: 20 + shift, top: 6 },
    ])
    .png()
    .toBuffer();

async function rankLook(rank: string, png: Buffer, source: string | null = 'roster') {
  const dir = join(images, 'custom', 'rank-look');
  mkdirSync(dir, { recursive: true });
  const id = Number(db.prepare('INSERT INTO rank_look (rank, file, source) VALUES (?, ?, ?)').run(rank, 'x', source).lastInsertRowid);
  db.prepare('UPDATE rank_look SET file = ? WHERE id = ?').run(`${id}.png`, id);
  writeFileSync(join(dir, `${id}.png`), png);
  return id;
}
async function unitLook(kind: 'artifact' | 'phantimal', name: string, source: string | null = 'battle') {
  const dir = join(images, 'custom', 'unit-look');
  mkdirSync(dir, { recursive: true });
  const id = Number(db.prepare('INSERT INTO unit_look (kind, name, file, source) VALUES (?, ?, ?, ?)').run(kind, name, 'x', source).lastInsertRowid);
  db.prepare('UPDATE unit_look SET file = ? WHERE id = ?').run(`${id}.png`, id);
  writeFileSync(join(dir, `${id}.png`), await tile([10, 10, 10], [250, 250, 250]));
  return id;
}
const get = async (path: string) => (await app.request(path)).json() as Promise<any>;
const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: ACT, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const GOLD: [number, number, number] = [250, 200, 0];
const BROWN: [number, number, number] = [120, 60, 20];

beforeEach(() => {
  images = mkdtempSync(join(tmpdir(), 'afk-learned-'));
  db = openDb(':memory:');
  db.prepare("INSERT INTO rank (name, position) VALUES ('Supreme+', 10), ('Paragon 3', 12), ('Paragon 4', 13)").run();
  db.prepare("INSERT INTO artifact (name, grp) VALUES ('Arc Burst', 'Pre-Season'), ('Awakening', 'Pre-Season')").run();
  app = createApp(db, { imagesDir: images });
});

describe('the learned review', () => {
  it('lists the Rank Looks by rank with their source, says which ranks the reader cannot name yet, and flags a look filed under the wrong rank', async () => {
    for (let i = 0; i < 3; i++) await rankLook('Paragon 4', await tile(GOLD, [255, 255, 255], i));
    for (let i = 0; i < 3; i++) await rankLook('Supreme+', await tile(BROWN, [200, 150, 90], i));
    const wrong = await rankLook('Supreme+', await tile(GOLD, [255, 255, 255], 5), 'offline'); // a Paragon 4 frame filed as Supreme+
    await rankLook('Paragon 3', await tile([40, 90, 200], [255, 255, 255]), null);
    const view = await get('/api/admin/learned');
    expect(view.ranks.map((r: any) => [r.rank, r.looks.length, r.readable])).toEqual([['Paragon 3', 1, false], ['Paragon 4', 3, true], ['Supreme+', 4, true]]);
    const flagged = view.ranks.flatMap((r: any) => r.looks.filter((l: any) => l.looksLike).map((l: any) => [l.id, r.rank, l.looksLike]));
    expect(flagged).toEqual([[wrong, 'Supreme+', 'Paragon 4']]);
    expect(view.ranks.find((r: any) => r.rank === 'Supreme+').looks.find((l: any) => l.id === wrong).source).toBe('offline');
    expect(view.ranks.find((r: any) => r.rank === 'Paragon 3').looks[0].source).toBeNull();
  });

  it('lists the Unit Looks by kind and name, the sources with their counts, and the accuracy of the readings', async () => {
    await unitLook('artifact', 'Arc Burst');
    await unitLook('artifact', 'Arc Burst', 'roster');
    await rankLook('Supreme+', await tile(BROWN, [200, 150, 90]), 'offline');
    db.prepare("INSERT INTO import_reading (source, screen, mode, field, subject, read_value, final_value) VALUES ('battle-form', 'report', 'Arena', 'rank', 'Evie', 'Supreme', 'Supreme'), ('battle-form', 'report', 'Arena', 'rank', 'Zed', 'Supreme', 'Paragon 1')").run();
    const view = await get('/api/admin/learned');
    expect(view.units).toEqual([{ kind: 'artifact', name: 'Arc Burst', looks: [expect.objectContaining({ source: 'battle' }), expect.objectContaining({ source: 'roster' })] }]);
    expect(view.sources).toEqual(expect.arrayContaining([{ source: 'battle', count: 1 }, { source: 'roster', count: 1 }, { source: 'offline', count: 1 }]));
    expect(view.choices).toMatchObject({ ranks: ['Supreme+', 'Paragon 3', 'Paragon 4'], artifacts: ['Arc Burst', 'Awakening'] });
    expect(view.accuracy).toEqual([{ source: 'battle-form', screen: 'report', field: 'rank', readings: 2, agreed: 1, agreedPercent: 50 }]);
  });

  it('serves the picture of a look', async () => {
    const id = await rankLook('Supreme+', await tile(BROWN, [200, 150, 90]));
    const response = await app.request(`/api/admin/learned/rank/${id}/image`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect((await app.request('/api/admin/learned/rank/999/image')).status).toBe(404);
    expect((await app.request(`/api/admin/learned/hero/${id}/image`)).status).toBe(404);
  });

  it('moves a Rank Look to another rank and says how many wrong readings that makes before and after', async () => {
    for (let i = 0; i < 3; i++) await rankLook('Paragon 4', await tile(GOLD, [255, 255, 255], i));
    for (let i = 0; i < 3; i++) await rankLook('Supreme+', await tile(BROWN, [200, 150, 90], i));
    const wrong = await rankLook('Supreme+', await tile(GOLD, [255, 255, 255], 5));
    const response = await send('PATCH', `/api/admin/learned/rank/${wrong}`, { rank: 'Paragon 4' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ wrongBefore: 1, wrongAfter: 0 });
    expect(db.prepare('SELECT rank FROM rank_look WHERE id = ?').pluck().get(wrong)).toBe('Paragon 4');
    expect((await send('PATCH', `/api/admin/learned/rank/${wrong}`, { rank: 'Nonsense' })).status).toBe(400);
    expect((await send('PATCH', '/api/admin/learned/rank/999', { rank: 'Paragon 4' })).status).toBe(404);
  });

  it('moves a Unit Look to another artifact of the same kind only', async () => {
    const id = await unitLook('artifact', 'Arc Burst');
    expect((await send('PATCH', `/api/admin/learned/unit/${id}`, { name: 'Awakening' })).status).toBe(204);
    expect(db.prepare('SELECT name FROM unit_look WHERE id = ?').pluck().get(id)).toBe('Awakening');
    expect((await send('PATCH', `/api/admin/learned/unit/${id}`, { name: 'Orson' })).status).toBe(400);
  });

  it('deletes a look with its picture, only when asked for from the app', async () => {
    const id = await rankLook('Supreme+', await tile(BROWN, [200, 150, 90]));
    const file = join(images, 'custom', 'rank-look', `${id}.png`);
    expect((await app.request(`/api/admin/learned/rank/${id}`, { method: 'DELETE' })).status).toBe(400);
    expect((await send('DELETE', `/api/admin/learned/rank/${id}`)).status).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect((await send('DELETE', `/api/admin/learned/rank/${id}`)).status).toBe(404);
  });

  it('deletes every look of one source in every table, and leaves the others', async () => {
    const keep = await rankLook('Supreme+', await tile(BROWN, [200, 150, 90]), 'roster');
    const gone = await rankLook('Supreme+', await tile(BROWN, [200, 150, 90], 2), 'offline');
    await unitLook('artifact', 'Arc Burst', 'offline');
    db.prepare("INSERT INTO hero (name) VALUES ('Evie')").run();
    db.prepare("INSERT INTO hero_example (hero_name, file, source) VALUES ('Evie', 'x', 'offline'), ('Evie', 'y', NULL)").run();
    const response = await send('DELETE', '/api/admin/learned/source/offline');
    expect(await response.json()).toEqual({ deleted: 3 });
    expect(db.prepare('SELECT id FROM rank_look').pluck().all()).toEqual([keep]);
    expect(existsSync(join(images, 'custom', 'rank-look', `${gone}.png`))).toBe(false);
    expect(db.prepare('SELECT count(*) FROM unit_look').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM hero_example').pluck().get()).toBe(1);
    expect((await send('DELETE', '/api/admin/learned/source/everything')).status).toBe(400);
  });
});

describe('moving a hero tile', () => {
  it('files a hero Example or Look under another hero', async () => {
    db.prepare("INSERT INTO hero (name) VALUES ('Evie'), ('Fay')").run();
    const id = Number(db.prepare("INSERT INTO hero_example (hero_name, file) VALUES ('Evie', 'x')").run().lastInsertRowid);
    expect((await send('PATCH', `/api/admin/reader/example/${id}`, { hero: 'Fay' })).status).toBe(204);
    expect(db.prepare('SELECT hero_name FROM hero_example WHERE id = ?').pluck().get(id)).toBe('Fay');
    expect((await send('PATCH', `/api/admin/reader/example/${id}`, { hero: 'Nobody' })).status).toBe(400);
    expect((await send('PATCH', '/api/admin/reader/example/999', { hero: 'Fay' })).status).toBe(404);
  });
});
