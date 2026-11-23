import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let app: Hono;
let dir: string;

beforeEach(() => {
  // images/ lives inside a project-like folder so imported paths such as "images/heroes/Evie.png" resolve.
  const project = mkdtempSync(join(tmpdir(), 'afk-img-'));
  dir = join(project, 'images');
  mkdirSync(join(dir, 'heroes'), { recursive: true });
  writeFileSync(join(dir, 'heroes', 'Evie.png'), PNG);
  writeFileSync(join(dir, 'heroes', 'Gervan.png'), PNG);

  const db = openDb(':memory:');
  db.prepare("INSERT INTO hero (name, image_path) VALUES ('Evie', 'images/heroes/Evie.png'), ('Fay', NULL)").run();
  db.prepare("INSERT INTO enemy (name, kind) VALUES ('Grunt', 'Common')").run();
  db.prepare("INSERT INTO boss (name) VALUES ('King Croaker')").run();
  db.prepare("INSERT INTO artifact (name, grp) VALUES ('Bladestorm', 'Season 8')").run();
  db.prepare("INSERT INTO phantimal (name) VALUES ('Gervan'), ('Seralyth')").run();
  app = createApp(db, { imagesDir: dir });
});

const put = (path: string, body: Uint8Array | string, type = 'image/png') =>
  app.request(path, { method: 'PUT', headers: { 'content-type': type }, body: body as BodyInit });
const portrait = (kind: string, name: string) => app.request(`/api/portrait/${kind}/${encodeURIComponent(name)}`);
const list = async (kind: string) => (await (await app.request(`/api/images/${kind}`)).json()) as { name: string; source: string }[];

describe('artifact images', () => {
  it('serves an imported artifact image', async () => {
    mkdirSync(join(dir, 'artifacts'), { recursive: true });
    writeFileSync(join(dir, 'artifacts', 'Bladestorm.webp'), PNG);
    const db = openDb(':memory:');
    db.prepare("INSERT INTO artifact (name, grp, image_path) VALUES ('Bladestorm', 'Season 8', 'images/artifacts/Bladestorm.webp')").run();
    const response = await createApp(db, { imagesDir: dir }).request('/api/portrait/artifact/Bladestorm');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
  });

  it('has none imported, lists them as missing, and takes an upload', async () => {
    expect((await portrait('artifact', 'Bladestorm')).status).toBe(404);
    expect(await list('artifact')).toEqual([{ name: 'Bladestorm', source: 'none' }]);
    expect((await put('/api/images/artifact/Bladestorm', PNG)).status).toBe(200);
    expect((await portrait('artifact', 'Bladestorm')).status).toBe(200);
    expect(await list('artifact')).toEqual([{ name: 'Bladestorm', source: 'custom' }]);
    expect((await put('/api/images/artifact/Nothing', PNG)).status).toBe(404);
  });
});

describe('portraits', () => {
  it('serves the imported image and 404s when there is none', async () => {
    const response = await portrait('hero', 'Evie');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect((await portrait('hero', 'Fay')).status).toBe(404);
    expect((await portrait('hero', 'Nobody')).status).toBe(404);
    expect((await portrait('weapon', 'Evie')).status).toBe(404);
  });

  it('finds phantimal images among the imported boss and hero images', async () => {
    expect((await portrait('phantimal', 'Gervan')).status).toBe(200);
    expect((await portrait('phantimal', 'Seralyth')).status).toBe(404);
  });

  it('lists which units have no image', async () => {
    expect(await list('hero')).toEqual([
      { name: 'Evie', source: 'imported' },
      { name: 'Fay', source: 'none' },
    ]);
    expect((await list('enemy'))[0]).toEqual({ name: 'Grunt', source: 'none' });
  });
});

describe('uploads', () => {
  it('stores a custom image that takes priority over the imported one', async () => {
    expect((await put('/api/images/hero/Fay', JPEG, 'image/jpeg')).status).toBe(200);
    const response = await portrait('hero', 'Fay');
    expect(response.headers.get('content-type')).toBe('image/jpeg');

    await put('/api/images/hero/Evie', JPEG, 'image/jpeg');
    expect(new Uint8Array(await (await portrait('hero', 'Evie')).arrayBuffer())).toEqual(JPEG);
    expect((await list('hero')).map((u) => u.source)).toEqual(['custom', 'custom']);
  });

  it('replaces an earlier custom image even when the format changes', async () => {
    await put('/api/images/hero/Fay', PNG);
    await put('/api/images/hero/Fay', JPEG, 'image/jpeg');
    expect((await portrait('hero', 'Fay')).headers.get('content-type')).toBe('image/jpeg');
    expect(existsSync(join(dir, 'custom', 'hero', 'Fay.png'))).toBe(false);
  });

  it('keeps the earlier custom image when the new one cannot be written', async () => {
    expect((await put('/api/images/hero/Fay', PNG)).status).toBe(200);
    mkdirSync(join(dir, 'custom', 'hero', 'Fay.webp')); // a folder where the new file would go, so writing it fails
    const response = await put('/api/images/hero/Fay', new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]), 'image/webp');
    expect(response.status).toBe(500);
    expect(existsSync(join(dir, 'custom', 'hero', 'Fay.png'))).toBe(true);
  });

  it('removing the custom image brings the imported one back', async () => {
    await put('/api/images/hero/Evie', JPEG, 'image/jpeg');
    expect((await app.request('/api/images/hero/Evie', { method: 'DELETE', headers: { 'x-afk-action': 'app' } })).status).toBe(204);
    expect((await portrait('hero', 'Evie')).headers.get('content-type')).toBe('image/png');
    expect((await list('hero'))[0]).toEqual({ name: 'Evie', source: 'imported' });
  });

  it('rejects unknown units, wrong types, fake images, empty and oversized files', async () => {
    expect((await put('/api/images/hero/Nobody', PNG)).status).toBe(404);
    expect((await put('/api/images/hero/Fay', PNG, 'text/html')).status).toBe(415);
    expect((await put('/api/images/hero/Fay', '<script>alert(1)</script>')).status).toBe(400);
    expect((await put('/api/images/hero/Fay', JPEG)).status).toBe(400); // JPEG bytes sent as PNG
    expect((await put('/api/images/hero/Fay', new Uint8Array())).status).toBe(400);
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await put('/api/images/hero/Fay', big)).status).toBe(413);
  });

  it('keeps unit names with special characters inside the images folder', async () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO hero (name) VALUES ('../../evil')").run();
    const evil = createApp(db, { imagesDir: dir });
    const response = await evil.request('/api/images/hero/..%2F..%2Fevil', {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: PNG as BodyInit,
    });
    expect(response.status).toBe(200);
    expect(existsSync(join(dir, 'custom', 'hero', '.._.._evil.png'))).toBe(true);
    expect(existsSync(join(dir, '..', '..', 'evil.png'))).toBe(false);
  });
});

describe('images of the units of a pair and of summons', () => {
  it('shows a part like its pair until it has its own image, and lists summons next to their hero', async () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO hero (name, image_path) VALUES ('Elijah & Lailah', 'images/heroes/Evie.png'), ('Zanie', NULL)").run();
    const units = createApp(db, { imagesDir: dir });
    const names = async () => ((await (await units.request('/api/images/hero')).json()) as { name: string; source: string }[]).map((u) => [u.name, u.source]);
    expect(await names()).toEqual([['Elijah & Lailah', 'imported'], ['Zanie', 'none'], ['Elijah', 'imported'], ['Lailah', 'imported'], ['Laser Turret', 'none']]);
    writeFileSync(join(dir, 'heroes', 'Laser Turret.png'), JPEG);
    expect((await names())[4]).toEqual(['Laser Turret', 'imported']); // a default image kept beside the hero images
    expect((await units.request('/api/portrait/hero/Lailah')).status).toBe(200);
    const upload = await units.request('/api/images/hero/Laser%20Turret', { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG as BodyInit });
    expect(upload.status).toBe(200);
    expect((await names())[4]).toEqual(['Laser Turret', 'custom']);
  });
});

describe('class and faction icons', () => {
  it('serves an icon kept in images/icons by its lower-case name', async () => {
    mkdirSync(join(dir, 'icons', 'class'), { recursive: true });
    writeFileSync(join(dir, 'icons', 'class', 'mage.png'), PNG);
    const res = await app.request('/api/icon/class/Mage');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('reads factions from the factions folder', async () => {
    mkdirSync(join(dir, 'icons', 'factions'), { recursive: true });
    writeFileSync(join(dir, 'icons', 'factions', 'wilder.png'), PNG);
    expect((await app.request('/api/icon/faction/Wilder')).status).toBe(200);
  });

  it('answers 404 for a missing icon, an unknown kind and a name that climbs out of the folder', async () => {
    expect((await app.request('/api/icon/class/Mage')).status).toBe(404);
    expect((await app.request('/api/icon/tier/S')).status).toBe(404);
    expect((await app.request('/api/icon/class/..%2F..%2Fheroes%2FEvie')).status).toBe(404);
  });
});
