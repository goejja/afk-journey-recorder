import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';
import { compareReadings, learnable, MAX_LOOKS_PER_UNIT, type SideReading } from '../../src/server/reader/import-feedback.js';
import { namedReferences } from '../../src/server/reader/import-pictures.js';

const side = (over: Partial<SideReading> = {}): SideReading => ({ heroes: [], artifact: null, phantimal: null, ...over });

describe('compareReadings', () => {
  it('compares heroes by name wherever they ended up, and rank and equipment only for heroes on both sides', () => {
    const read = side({ heroes: [{ hero: 'Evie', rank: 'Supreme', equipmentLevel: 5 }, { hero: 'Zed', rank: 'Supreme', equipmentLevel: null }, { hero: 'Fay', rank: null, equipmentLevel: null }] });
    const final = side({ heroes: [{ hero: 'Fay', rank: 'Mythic', equipmentLevel: null }, { hero: 'Evie', rank: 'Paragon 1', equipmentLevel: 5 }, { hero: 'Nara', rank: null, equipmentLevel: null }] });
    expect(compareReadings(read, final)).toEqual([
      { field: 'hero', subject: '', read: 'Evie', final: 'Evie' },
      { field: 'rank', subject: 'Evie', read: 'Supreme', final: 'Paragon 1' },
      { field: 'equipment', subject: 'Evie', read: '5', final: '5' },
      { field: 'hero', subject: '', read: 'Zed', final: null },
      { field: 'hero', subject: '', read: 'Fay', final: 'Fay' },
      { field: 'hero', subject: '', read: null, final: 'Nara' },
    ]);
  });

  it('compares the artifact and the phantimal, and says nothing of what neither side had', () => {
    expect(compareReadings(side({ artifact: { name: 'Arc Burst', level: 24 }, phantimal: 'Orson' }), side({ artifact: { name: 'Awakening', level: 24 }, phantimal: null }))).toEqual([
      { field: 'artifact', subject: '', read: 'Arc Burst', final: 'Awakening' },
      { field: 'phantimal', subject: '', read: 'Orson', final: null },
    ]);
    expect(compareReadings(side(), side())).toEqual([]);
  });
});

describe('learnable', () => {
  const png = Buffer.from('x');
  const tile = (hero: string | null) => ({ hero, png });
  const h = (hero: string, rank: string | null = null) => ({ hero, rank, equipmentLevel: null });

  it('pairs the one tile that was wrong with the one hero that was added', () => {
    const read = side({ heroes: [h('Evie'), h('Zed')] });
    // Zed was read, the player put Fay instead
    expect(learnable(read, side({ heroes: [h('Evie'), h('Fay')] }), [tile('Evie'), tile('Zed')], new Set()).heroes).toEqual([{ hero: 'Fay', png }]);
    // a tile the reading did not name, and a hero the player added
    expect(learnable(side({ heroes: [h('Evie')] }), side({ heroes: [h('Evie'), h('Fay')] }), [tile('Evie'), tile(null)], new Set()).heroes).toEqual([{ hero: 'Fay', png }]);
  });

  it('learns nothing from a reading that was kept, or from corrections it cannot pair', () => {
    expect(learnable(side({ heroes: [h('Evie')] }), side({ heroes: [h('Evie')] }), [tile('Evie')], new Set()).heroes).toEqual([]);
    const read = side({ heroes: [h('Evie'), h('Zed')] });
    expect(learnable(read, side({ heroes: [h('Fay'), h('Nara')] }), [tile('Evie'), tile('Zed')], new Set()).heroes).toEqual([]); // two wrong, two added: which is which?
    expect(learnable(read, side({ heroes: [h('Evie'), h('Fay'), h('Nara')] }), [tile('Evie'), tile('Zed')], new Set()).heroes).toEqual([]);
  });

  it('learns a rank the player changed on a hero they kept, unless a roster may have filled it in', () => {
    const read = side({ heroes: [h('Evie', 'Supreme'), h('Zed', 'Supreme'), h('Fay', null)] });
    const final = side({ heroes: [h('Evie', 'Paragon 1'), h('Zed', 'Paragon 1'), h('Fay', 'Mythic')] });
    const tiles = [tile('Evie'), tile('Zed'), tile('Fay')];
    // Fay's reading gave no rank and the player typed one: that is a look too
    expect(learnable(read, final, tiles, new Set(['Zed'])).ranks).toEqual([{ rank: 'Paragon 1', hero: 'Evie', png }, { rank: 'Mythic', hero: 'Fay', png }]);
  });

  it('learns a rank kept as read only while that rank has few looks, and never one a roster may have filled in', () => {
    const read = side({ heroes: [h('Evie', 'Paragon 3'), h('Zed', 'Supreme+'), h('Fay', 'Paragon 3')] });
    const tiles = [tile('Evie'), tile('Zed'), tile('Fay')];
    expect(learnable(read, read, tiles, new Set(['Fay']), new Set(['Paragon 3'])).ranks).toEqual([{ rank: 'Paragon 3', hero: 'Evie', png }]);
    expect(learnable(read, read, tiles, new Set(), new Set()).ranks).toEqual([]); // every rank has enough looks
  });
});

describe('POST /api/import-feedback', () => {
  let db: Database.Database;
  let app: Hono;
  let images: string;

  beforeEach(() => {
    images = mkdtempSync(join(tmpdir(), 'afk-feedback-'));
    db = openDb(':memory:');
    for (const name of ['Evie', 'Zed']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
    db.prepare("INSERT INTO artifact (name, grp) VALUES ('Arc Burst', 'Pre-Season')").run();
    db.prepare("INSERT INTO phantimal (name) VALUES ('Orson')").run();
    app = createApp(db, { imagesDir: images });
  });
  afterEach(() => rmSync(images, { recursive: true, force: true }));

  const crop = async () => `data:image/png;base64,${(await sharp({ create: { width: 40, height: 30, channels: 3, background: '#a33' } }).png().toBuffer()).toString('base64')}`;
  const send = (body: unknown, asked = true) =>
    app.request('/api/import-feedback', { method: 'POST', headers: asked ? { 'content-type': 'application/json', 'x-afk-action': 'import-feedback' } : { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
  const reading = (over: object = {}) => ({ heroes: [{ hero: 'Evie', rank: 'Supreme', equipmentLevel: null }], artifact: { name: 'Arc Burst', level: 24 }, phantimal: 'Orson', ...over });

  it('refuses a request any web page could send blindly, and needs what was read and what was kept', async () => {
    expect((await send({ mode: 'Arena', sides: [] }, false)).status).toBe(400);
    expect((await send({ mode: 'Arena' })).status).toBe(400);
    expect((await send({ mode: 'Arena', sides: [{ read: reading() }] })).status).toBe(400);
  });

  it('logs each reading against what was kept, and the view gives the share that agreed', async () => {
    const response = await send({ mode: 'Guild Duel', sides: [{ read: reading(), final: reading({ heroes: [{ hero: 'Evie', rank: 'Paragon 1', equipmentLevel: null }] }), crops: {} }] });
    expect(await response.json()).toMatchObject({ logged: 4, looks: 0 });
    expect(db.prepare("SELECT field, agreed, readings FROM v_import_accuracy WHERE source = 'battle-form' ORDER BY field").all()).toEqual([
      { field: 'artifact', agreed: 1, readings: 1 },
      { field: 'hero', agreed: 1, readings: 1 },
      { field: 'phantimal', agreed: 1, readings: 1 },
      { field: 'rank', agreed: 0, readings: 1 },
    ]);
    expect(db.prepare('SELECT DISTINCT mode FROM import_reading').pluck().all()).toEqual(['Guild Duel']);
  });

  it('keeps the crops of the artifact and phantimal that were kept as looks for the reference sheets, up to a few of each', async () => {
    const body = { mode: 'Arena', sides: [{ read: reading(), final: reading(), crops: { artifact: await crop(), phantimal: await crop() } }] };
    expect(await (await send(body)).json()).toMatchObject({ looks: 2 });
    const looks = db.prepare('SELECT kind, name, file FROM unit_look ORDER BY kind').all() as { kind: string; name: string; file: string }[];
    expect(looks.map((l) => [l.kind, l.name])).toEqual([['artifact', 'Arc Burst'], ['phantimal', 'Orson']]);
    expect(existsSync(join(images, 'custom', 'unit-look', looks[0]!.file))).toBe(true);
    expect(namedReferences(db, images, 'phantimal').map((r) => r.label)).toEqual(['Orson (seen)']);

    for (let i = 0; i < MAX_LOOKS_PER_UNIT + 2; i++) await send(body);
    expect(db.prepare("SELECT count(*) FROM unit_look WHERE name = 'Orson'").pluck().get()).toBe(MAX_LOOKS_PER_UNIT);
  });

  const tile = async (hero: string | null, color: string) => ({ hero, png: `data:image/png;base64,${(await sharp({ create: { width: 60, height: 70, channels: 3, background: color } }).png().toBuffer()).toString('base64')}` });
  const plain = { artifact: null, phantimal: null };

  it('teaches the hero reader the tile of a hero the player put right, once for a tile that looks the same', async () => {
    const body = { mode: 'Guild Duel', sides: [{ read: { ...plain, heroes: [{ hero: 'Zed', rank: null, equipmentLevel: null }] }, final: { ...plain, heroes: [{ hero: 'Evie', rank: null, equipmentLevel: null }] }, crops: { tiles: [await tile('Zed', '#3a7')] } }] };
    expect(await (await send(body)).json()).toMatchObject({ heroExamples: 1, rankLooks: 0 });
    const saved = db.prepare('SELECT hero_name AS hero, file FROM hero_example').all() as { hero: string; file: string }[];
    expect(saved.map((r) => r.hero)).toEqual(['Evie']);
    expect(existsSync(join(images, 'custom', 'hero-example', saved[0]!.file))).toBe(true);
    expect(await (await send(body)).json()).toMatchObject({ heroExamples: 0 });
    expect(db.prepare('SELECT count(*) FROM hero_example').pluck().get()).toBe(1);
  });

  it('keeps neither rows nor files when one of the pictures cannot be written', async () => {
    // a file where the folder of the looks should be: the hero example is written first, then the look fails
    mkdirSync(join(images, 'custom'), { recursive: true });
    writeFileSync(join(images, 'custom', 'unit-look'), 'in the way');
    const body = { mode: 'Guild Duel', sides: [{ read: { ...plain, heroes: [{ hero: 'Zed', rank: null, equipmentLevel: null }] }, final: { ...plain, artifact: { name: 'Arc Burst', level: 24 }, heroes: [{ hero: 'Evie', rank: null, equipmentLevel: null }] }, crops: { artifact: await crop(), tiles: [await tile('Zed', '#3a7')] } }] };
    expect((await send(body)).status).toBe(500);
    expect(db.prepare('SELECT count(*) FROM hero_example').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM unit_look').pluck().get()).toBe(0);
    expect(readdirSync(join(images, 'custom', 'hero-example'))).toEqual([]);
  });

  it('teaches the rank reader a rank the player changed, but not one a roster may have filled in', async () => {
    for (const [i, name] of ['Supreme', 'Paragon 1'].entries()) db.prepare('INSERT INTO rank (name, position) VALUES (?, ?)').run(name, i);
    const hero = (rank: string) => ({ ...plain, heroes: [{ hero: 'Evie', rank, equipmentLevel: null }] });
    const crops = { tiles: [await tile('Evie', '#37a')] };
    await send({ mode: 'Guild Duel', sides: [{ read: hero('Supreme'), final: hero('Paragon 1'), crops, skipRank: ['Evie'] }] });
    expect(db.prepare('SELECT count(*) FROM rank_look').pluck().get()).toBe(0);
    expect(await (await send({ mode: 'Guild Duel', sides: [{ read: hero('Supreme'), final: hero('Paragon 1'), crops }] })).json()).toMatchObject({ rankLooks: 1 });
    expect(db.prepare('SELECT rank FROM rank_look').pluck().all()).toEqual(['Paragon 1']);
    expect(db.prepare('SELECT source FROM rank_look').pluck().all()).toEqual(['battle']);
  });

  it('teaches nothing when the reading was kept, or the tile is not a PNG', async () => {
    const same = { ...plain, heroes: [{ hero: 'Evie', rank: null, equipmentLevel: null }] };
    await send({ mode: 'Guild Duel', sides: [{ read: same, final: same, crops: { tiles: [await tile('Evie', '#3a7')] } }] });
    await send({ mode: 'Guild Duel', sides: [{ read: { ...plain, heroes: [] }, final: same, crops: { tiles: [{ hero: null, png: 'nonsense' }] } }] });
    expect(db.prepare('SELECT count(*) FROM hero_example').pluck().get()).toBe(0);
  });

  it('learns nothing from a side that kept no artifact or phantimal, a name that is not one, or a crop that is not a PNG', async () => {
    await send({ mode: 'Arena', sides: [{ read: reading(), final: reading({ artifact: null, phantimal: null }), crops: { artifact: await crop(), phantimal: await crop() } }] });
    await send({ mode: 'Arena', sides: [{ read: reading(), final: reading({ artifact: { name: 'Nothing', level: 1 }, phantimal: 'Nobody' }), crops: { artifact: await crop(), phantimal: await crop() } }] });
    await send({ mode: 'Arena', sides: [{ read: reading(), final: reading(), crops: { artifact: 'data:text/html;base64,AAAA', phantimal: 'nonsense' } }] });
    expect(db.prepare('SELECT count(*) FROM unit_look').pluck().get()).toBe(0);
  });
});
