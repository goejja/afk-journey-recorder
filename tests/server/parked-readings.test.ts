import type Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';
import type { SideReading } from '../../src/server/reader/import-feedback.js';
import { PARK_CAPS, parkable } from '../../src/server/reader/parked-readings.js';

const side = (...heroes: string[]): SideReading => ({ heroes: heroes.map((hero) => ({ hero, rank: null, equipmentLevel: null })), artifact: null, phantimal: null });

describe('parkable', () => {
  const png = Buffer.from('x');
  const tile = (hero: string | null, over: { unsure?: boolean; candidates?: string[] } = {}) => ({ hero, png, ...over });

  it('parks every wrong tile when several were wrong, with the heroes the player added as candidates and then the Agent’s guesses', () => {
    const found = parkable(side('Evie', 'Zed', 'Fay'), side('Evie', 'Nara', 'Kai'), [tile('Evie'), tile('Zed'), tile('Fay'), tile(null, { candidates: ['Odo'] })], 'B');
    expect(found.map((f) => [f.kind, f.side, f.readHero, f.candidates])).toEqual([
      ['difference', 'B', 'Zed', ['Nara', 'Kai']],
      ['difference', 'B', 'Fay', ['Nara', 'Kai']],
      ['difference', 'B', null, ['Nara', 'Kai', 'Odo']],
    ]);
  });

  it('parks nothing for the case learnt by itself, for a hero only removed, or for a reading kept', () => {
    expect(parkable(side('Evie', 'Zed'), side('Evie', 'Fay'), [tile('Evie'), tile('Zed')], 'A')).toEqual([]); // one wrong, one added
    expect(parkable(side('Evie', 'Zed', 'Fay'), side('Evie'), [tile('Evie'), tile('Zed'), tile('Fay')], 'A')).toEqual([]); // two removed, none added
    expect(parkable(side('Evie'), side('Evie'), [tile('Evie')], 'A')).toEqual([]);
  });

  it('parks a hero the Agent was not sure of when the player kept it, even beside a case learnt by itself, but not one the player changed', () => {
    const found = parkable(side('Evie', 'Zed', 'Fay'), side('Evie', 'Nara', 'Fay'), [tile('Evie', { unsure: true }), tile('Zed', { unsure: true }), tile('Fay')], 'A');
    expect(found.map((f) => [f.kind, f.readHero, f.keptHero])).toEqual([['unsure', 'Evie', 'Evie']]);
  });
});

describe('the parked readings', () => {
  let db: Database.Database;
  let app: Hono;
  let images: string;
  beforeEach(() => {
    images = mkdtempSync(join(tmpdir(), 'afk-parked-'));
    db = openDb(':memory:');
    for (const name of ['Evie', 'Zed', 'Fay', 'Nara']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
    app = createApp(db, { imagesDir: images });
  });
  afterEach(() => rmSync(images, { recursive: true, force: true }));

  const png = async (color: string) => `data:image/png;base64,${(await sharp({ create: { width: 60, height: 70, channels: 3, background: color } }).png().toBuffer()).toString('base64')}`;
  const plain = { artifact: null, phantimal: null };
  const hero = (name: string) => ({ hero: name, rank: null, equipmentLevel: null });
  const headers = { 'content-type': 'application/json', 'x-afk-action': 'test' };
  const send = (body: unknown) => app.request('/api/import-feedback', { method: 'POST', headers, body: JSON.stringify(body) });
  /** A side where Zed and Fay were read and the player kept Evie and Nara: two wrong, two added, which cannot be paired. */
  const unpaired = async (colors: [string, string] = ['#3a7', '#a33'], side: 'A' | 'B' = 'A') => ({
    mode: 'Arena',
    sides: [{ side, read: { ...plain, heroes: [hero('Zed'), hero('Fay')] }, final: { ...plain, heroes: [hero('Evie'), hero('Nara')] }, crops: { tiles: [{ hero: 'Zed', png: await png(colors[0]) }, { hero: 'Fay', png: await png(colors[1]) }] } }],
  });
  const rows = () => db.prepare('SELECT kind, side, mode, read_hero AS readHero, kept_hero AS keptHero, candidates, file FROM parked_reading ORDER BY id').all() as { kind: string; side: string; mode: string; readHero: string | null; keptHero: string | null; candidates: string; file: string }[];

  it('parks the tiles it could not pair, with their pictures, and says how many', async () => {
    const response = await send(await unpaired());
    expect(await response.json()).toMatchObject({ heroExamples: 0, parked: 2, full: [] });
    expect(rows()).toEqual([
      { kind: 'difference', side: 'A', mode: 'Arena', readHero: 'Zed', keptHero: null, candidates: '["Evie","Nara"]', file: '1.png' },
      { kind: 'difference', side: 'A', mode: 'Arena', readHero: 'Fay', keptHero: null, candidates: '["Evie","Nara"]', file: '2.png' },
    ]);
    expect(readdirSync(join(images, 'custom', 'parked-reading')).sort()).toEqual(['1.png', '2.png']);
  });

  it('parks a hero the Agent was not sure of that the player kept, with the side it was on', async () => {
    const body = { mode: 'Arena', sides: [{ side: 'B', read: { ...plain, heroes: [hero('Evie')] }, final: { ...plain, heroes: [hero('Evie')] }, crops: { tiles: [{ hero: 'Evie', png: await png('#3a7'), unsure: true }] } }] };
    expect(await (await send(body)).json()).toMatchObject({ parked: 1 });
    expect(rows()).toEqual([{ kind: 'unsure', side: 'B', mode: 'Arena', readHero: 'Evie', keptHero: 'Evie', candidates: '[]', file: '1.png' }]);
  });

  it('keeps only the candidates that are heroes', async () => {
    const body = await unpaired();
    (body.sides[0]!.crops.tiles[0] as { candidates?: string[] }).candidates = ['Nobody', 'Fay'];
    await send(body);
    expect(JSON.parse(rows()[0]!.candidates)).toEqual(['Evie', 'Nara', 'Fay']);
  });

  it('does not park a tile again that looks like one already parked', async () => {
    await send(await unpaired());
    expect(await (await send(await unpaired())).json()).toMatchObject({ parked: 0 });
    expect(rows()).toHaveLength(2);
    expect(await (await send(await unpaired(['#33a', '#aa3']))).json()).toMatchObject({ parked: 2 });
    expect(rows()).toHaveLength(4);
  });

  it('does not compare a tile with one made by another version of the extractor', async () => {
    await send(await unpaired());
    db.prepare('UPDATE parked_reading SET version = 0').run();
    expect(await (await send(await unpaired())).json()).toMatchObject({ parked: 2 });
  });

  it('stops parking a kind that is full, says so, and drops nothing', async () => {
    const fill = db.prepare("INSERT INTO parked_reading (kind, side, file, version, vector) VALUES ('difference', 'A', ?, 0, ?)");
    for (let i = 0; i < PARK_CAPS.difference; i++) fill.run(`old${i}.png`, Buffer.alloc(4));
    const unsureBody = { mode: 'Arena', sides: [{ side: 'A', read: { ...plain, heroes: [hero('Evie')] }, final: { ...plain, heroes: [hero('Evie')] }, crops: { tiles: [{ hero: 'Evie', png: await png('#33a'), unsure: true }] } }] };
    const both = { mode: 'Arena', sides: [...(await unpaired()).sides, ...unsureBody.sides] };
    expect(await (await send(both)).json()).toMatchObject({ parked: 1, full: ['difference'] }); // only the unsure one found room
    expect(db.prepare("SELECT count(*) FROM parked_reading WHERE kind = 'difference'").pluck().get()).toBe(PARK_CAPS.difference);
    expect(db.prepare("SELECT count(*) FROM parked_reading WHERE kind = 'unsure'").pluck().get()).toBe(1);
  });

  describe('the review', () => {
    const post = (path: string, body?: unknown) => app.request(path, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
    const del = (path: string) => app.request(path, { method: 'DELETE', headers: { 'x-afk-action': 'test' } });

    it('lists them oldest first, a page at a time, with the counts and the caps', async () => {
      await send(await unpaired());
      const all = await (await app.request('/api/admin/parked-readings')).json();
      expect(all).toMatchObject({ total: 2, counts: { difference: 2, unsure: 0 }, caps: PARK_CAPS });
      expect(all.entries[0]).toMatchObject({ id: 1, kind: 'difference', side: 'A', readHero: 'Zed', keptHero: null, candidates: ['Evie', 'Nara'], mode: 'Arena' });
      const page = await (await app.request('/api/admin/parked-readings?offset=1&limit=1')).json();
      expect(page.entries.map((e: { id: number }) => e.id)).toEqual([2]);
      expect(page.total).toBe(2);
    });

    it('lists only one kind when asked, and still counts them all', async () => {
      await send(await unpaired());
      await send({ mode: 'Arena', sides: [{ side: 'B', read: { ...plain, heroes: [hero('Evie')] }, final: { ...plain, heroes: [hero('Evie')] }, crops: { tiles: [{ hero: 'Evie', png: await png('#33a'), unsure: true }] } }] });
      const unsure = await (await app.request('/api/admin/parked-readings?kind=unsure')).json();
      expect(unsure.entries.map((e: { kind: string }) => e.kind)).toEqual(['unsure']);
      expect(unsure).toMatchObject({ total: 1, counts: { difference: 2, unsure: 1 } });
      const differences = await (await app.request('/api/admin/parked-readings?kind=difference&limit=1')).json();
      expect(differences).toMatchObject({ total: 2, counts: { difference: 2, unsure: 1 } });
      expect(differences.entries).toHaveLength(1);
      expect((await (await app.request('/api/admin/parked-readings?kind=other')).json()).total).toBe(3); // a kind that is not one asks for all
    });

    it('serves the picture of a reading', async () => {
      await send(await unpaired());
      const response = await app.request('/api/admin/parked-readings/1/image');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect((await app.request('/api/admin/parked-readings/99/image')).status).toBe(404);
    });

    it('drops a reading whose picture is gone when the list is read', async () => {
      await send(await unpaired());
      rmSync(join(images, 'custom', 'parked-reading', '1.png'));
      const list = await (await app.request('/api/admin/parked-readings')).json();
      expect(list.entries.map((e: { id: number }) => e.id)).toEqual([2]);
      expect(db.prepare('SELECT count(*) FROM parked_reading').pluck().get()).toBe(1);
    });

    it('turns a confirmed reading into a hero example of the hero the player chose, and removes it', async () => {
      await send(await unpaired());
      const response = await post('/api/admin/parked-readings/1/confirm', { hero: 'Nara' });
      expect(await response.json()).toEqual({ learnt: true });
      const example = db.prepare('SELECT hero_name AS hero, file, source FROM hero_example').get() as { hero: string; file: string; source: string };
      expect(example).toMatchObject({ hero: 'Nara', source: 'review' });
      expect(existsSync(join(images, 'custom', 'hero-example', example.file))).toBe(true);
      expect(db.prepare('SELECT id FROM parked_reading').pluck().all()).toEqual([2]);
      expect(existsSync(join(images, 'custom', 'parked-reading', '1.png'))).toBe(false);
    });

    it('learns nothing from a tile just like one the hero already has, and still removes the reading', async () => {
      await send(await unpaired());
      await post('/api/admin/parked-readings/1/confirm', { hero: 'Nara' });
      await send(await unpaired()); // the first tile comes again, now that it is no longer parked; the second is still parked, so it is not parked twice
      const second = await post('/api/admin/parked-readings/3/confirm', { hero: 'Nara' });
      expect(await second.json()).toEqual({ learnt: false });
      expect(db.prepare('SELECT count(*) FROM hero_example').pluck().get()).toBe(1);
      expect(db.prepare('SELECT id FROM parked_reading ORDER BY id').pluck().all()).toEqual([2]);
    });

    it('refuses a hero that does not exist, and a reading that does not exist', async () => {
      await send(await unpaired());
      expect((await post('/api/admin/parked-readings/1/confirm', { hero: 'Nobody' })).status).toBe(400);
      expect((await post('/api/admin/parked-readings/1/confirm', {})).status).toBe(400);
      expect((await post('/api/admin/parked-readings/99/confirm', { hero: 'Nara' })).status).toBe(404);
      expect(db.prepare('SELECT count(*) FROM parked_reading').pluck().get()).toBe(2);
    });

    it('puts a reading aside: its row and its picture go, nothing is learnt', async () => {
      await send(await unpaired());
      expect((await del('/api/admin/parked-readings/1')).status).toBe(204);
      expect(db.prepare('SELECT id FROM parked_reading').pluck().all()).toEqual([2]);
      expect(existsSync(join(images, 'custom', 'parked-reading', '1.png'))).toBe(false);
      expect(db.prepare('SELECT count(*) FROM hero_example').pluck().get()).toBe(0);
      expect((await del('/api/admin/parked-readings/1')).status).toBe(404);
    });
  });
});
