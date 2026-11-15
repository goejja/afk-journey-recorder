import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let db: Database.Database;
let app: Hono;
let images: string;

beforeEach(() => {
  db = openDb(':memory:');
  images = mkdtempSync(join(tmpdir(), 'afk-kept-'));
  app = createApp(db, { imagesDir: images });
});
afterEach(() => rmSync(images, { recursive: true, force: true }));

const picture = (colour: string) => sharp({ create: { width: 20, height: 30, channels: 3, background: colour } }).jpeg().toBuffer();
const dataUrl = (bytes: Buffer, type = 'jpeg') => `data:image/${type};base64,${bytes.toString('base64')}`;
const attempt = () => Number(db.prepare("INSERT INTO attempt (mode, outcome, note) VALUES ('Arena', 'Win', 'Imported from IMG_1.jpeg: a against b')").run().lastInsertRowid);
const keep = (body: unknown) =>
  app.request('/api/kept-pictures', { method: 'POST', headers: { 'content-type': 'application/json', 'x-afk-action': 'keep-picture' }, body: JSON.stringify(body) });
const folder = () => (existsSync(join(images, 'imports', 'report')) ? readdirSync(join(images, 'imports', 'report')) : []);

describe('keeping the picture of a saved fight', () => {
  it('stores the picture under its hash, links it to the fight and serves it back', async () => {
    const id = attempt();
    const bytes = await picture('#336699');
    const response = await keep({ attemptId: id, label: 'IMG_1.jpeg', data: dataUrl(bytes) });
    expect(response.status).toBe(201);
    const row = db.prepare('SELECT hash, screen, label, file FROM import_picture WHERE attempt_id = ?').get(id) as any;
    expect(row).toMatchObject({ screen: 'report', label: 'IMG_1.jpeg', file: `${row.hash}.jpg` });
    expect(folder()).toEqual([row.file]);
    const served = await app.request(`/api/kept-pictures/${id}`);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await served.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('stores a picture once when it is kept for two fights', async () => {
    const [a, b] = [attempt(), attempt()];
    const data = dataUrl(await picture('#336699'));
    await keep({ attemptId: a, label: null, data });
    await keep({ attemptId: b, label: null, data });
    expect(folder()).toHaveLength(1);
    expect(db.prepare('SELECT count(*) FROM import_picture').pluck().get()).toBe(2);
  });

  it('refuses what is not a picture, an unknown fight, and a request that this app did not ask for', async () => {
    const id = attempt();
    expect((await keep({ attemptId: id, data: dataUrl(Buffer.from('not a picture')) })).status).toBe(422);
    expect((await keep({ attemptId: 999, data: dataUrl(await picture('#336699')) })).status).toBe(422);
    expect((await keep({ attemptId: id, data: 'data:text/html;base64,AAAA' })).status).toBe(400);
    const blind = await app.request('/api/kept-pictures', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ attemptId: id, data: dataUrl(await picture('#336699')) }) });
    expect(blind.status).toBe(400);
    expect(db.prepare('SELECT count(*) FROM import_picture').pluck().get()).toBe(0);
    expect(folder()).toEqual([]);
  });

  it('drops the link with the record and leaves the file', async () => {
    const id = attempt();
    await keep({ attemptId: id, label: null, data: dataUrl(await picture('#336699')) });
    db.prepare('DELETE FROM attempt WHERE id = ?').run(id);
    expect(db.prepare('SELECT count(*) FROM import_picture').pluck().get()).toBe(0);
    expect(folder()).toHaveLength(1);
    expect((await app.request(`/api/kept-pictures/${id}`)).status).toBe(404);
  });
});
