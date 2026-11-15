import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

const reads = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/vision/hero-read.js', async (original) => {
  const module = await original<typeof import('../../src/vision/hero-read.js')>();
  return { ...module, readHero: (...args: Parameters<typeof module.readHero>) => (reads.count++, module.readHero(...args)) };
});

let db: Database.Database;
let app: Hono;
let images: string;

/** A tile of one flat colour with a noisy centre, so that the reader tells it from a tile of another colour. */
const tile = (r: number, g: number, b: number) => sharp({ create: { width: 60, height: 60, channels: 3, background: { r, g, b } } }).png().toBuffer();

async function learn(kind: 'example' | 'look', hero: string, png: Buffer) {
  const table = kind === 'example' ? 'hero_example' : 'hero_look';
  const dir = join(images, 'custom', kind === 'example' ? 'hero-example' : 'look');
  mkdirSync(dir, { recursive: true });
  const id = Number(db.prepare(`INSERT INTO ${table} (hero_name, file) VALUES (?, 'x')`).run(hero).lastInsertRowid);
  db.prepare(`UPDATE ${table} SET file = ? WHERE id = ?`).run(`${id}.png`, id);
  writeFileSync(join(dir, `${id}.png`), png);
  return id;
}

beforeEach(() => {
  images = mkdtempSync(join(tmpdir(), 'afk-reader-'));
  db = openDb(':memory:');
  db.prepare("INSERT INTO hero (name) VALUES ('Evie'), ('Lily May'), ('Fay')").run();
  app = createApp(db, { imagesDir: images });
});

describe('the Reader review', () => {
  it('lists every hero with its tiles, both kinds, and the heroes with none', async () => {
    await learn('example', 'Evie', await tile(200, 20, 20));
    await learn('look', 'Evie', await tile(200, 30, 20));
    await learn('example', 'Lily May', await tile(20, 20, 200));
    const body = await (await app.request('/api/admin/reader')).json();
    expect(body.heroes.map((h: any) => [h.hero, h.examples.map((e: any) => e.kind)])).toEqual([['Evie', ['example', 'look']], ['Lily May', ['example']]]);
    expect(body.withoutExamples).toBe(1);
  });

  it('marks a tile that the other tiles would read as another hero', async () => {
    await learn('example', 'Evie', await tile(200, 20, 20));
    await learn('example', 'Evie', await tile(201, 20, 20));
    await learn('example', 'Lily May', await tile(20, 20, 200));
    await learn('example', 'Lily May', await tile(22, 20, 198));
    const wrong = await learn('example', 'Lily May', await tile(210, 30, 20)); // looks like Evie's
    const body = await (await app.request('/api/admin/reader')).json();
    const flagged = body.heroes.flatMap((h: any) => h.examples.filter((e: any) => e.looksLike).map((e: any) => [e.id, h.hero, e.looksLike]));
    expect(flagged).toEqual([[wrong, 'Lily May', 'Evie']]);
  });

  it('reads the tiles again only when an example is added, relabelled or deleted', async () => {
    await learn('example', 'Evie', await tile(200, 20, 20));
    await learn('example', 'Lily May', await tile(20, 20, 200));
    const first = await (await app.request('/api/admin/reader')).json();
    expect(reads.count).toBeGreaterThan(0);
    // a repeated request answers from the kept result: no tile is read again
    reads.count = 0;
    expect(await (await app.request('/api/admin/reader')).json()).toEqual(first);
    expect(reads.count).toBe(0);
    // a new example shows at once
    const added = await learn('example', 'Evie', await tile(201, 20, 20));
    const afterAdd = await (await app.request('/api/admin/reader')).json();
    expect(afterAdd.heroes.find((h: any) => h.hero === 'Evie').examples.map((e: any) => e.id)).toContain(added);
    // a relabel shows at once
    db.prepare("UPDATE hero_example SET hero_name = 'Fay' WHERE id = ?").run(added);
    const afterRelabel = await (await app.request('/api/admin/reader')).json();
    expect(afterRelabel.heroes.map((h: any) => h.hero)).toEqual(['Evie', 'Fay', 'Lily May']);
    // a delete shows at once
    await app.request(`/api/admin/reader/example/${added}`, { method: 'DELETE', headers: { 'x-afk-action': 'delete-example' } });
    const afterDelete = await (await app.request('/api/admin/reader')).json();
    expect(afterDelete.heroes.map((h: any) => h.hero)).toEqual(['Evie', 'Lily May']);
  });

  it('serves the picture of a tile', async () => {
    const id = await learn('look', 'Evie', await tile(200, 20, 20));
    const response = await app.request(`/api/admin/reader/look/${id}/image`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect((await app.request('/api/admin/reader/look/999/image')).status).toBe(404);
  });

  it('deletes a tile with its row and its picture, only when asked for from the app', async () => {
    const id = await learn('example', 'Evie', await tile(200, 20, 20));
    const file = join(images, 'custom', 'hero-example', `${id}.png`);
    expect((await app.request(`/api/admin/reader/example/${id}`, { method: 'DELETE' })).status).toBe(400);
    expect(existsSync(file)).toBe(true);
    expect((await app.request(`/api/admin/reader/example/${id}`, { method: 'DELETE', headers: { 'x-afk-action': 'delete-example' } })).status).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect(db.prepare('SELECT count(*) FROM hero_example').pluck().get()).toBe(0);
    expect((await app.request(`/api/admin/reader/example/${id}`, { method: 'DELETE', headers: { 'x-afk-action': 'delete-example' } })).status).toBe(404);
    expect((await app.request('/api/admin/reader/rank/1', { method: 'DELETE', headers: { 'x-afk-action': 'delete-example' } })).status).toBe(404);
  });
});
