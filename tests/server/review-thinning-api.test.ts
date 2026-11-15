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

/** A tile picture: a top of one colour with a band of another, like a frame with an ornament, over a plain body (as in learned.test). */
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
const get = async (path: string) => (await app.request(path)).json() as Promise<any>;
const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const put = (path: string, body: unknown) => app.request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const fileOf = (id: number) => join(images, 'custom', 'rank-look', `${id}.png`);

const GOLD: [number, number, number] = [250, 200, 0];
const BROWN: [number, number, number] = [120, 60, 20];

beforeEach(() => {
  images = mkdtempSync(join(tmpdir(), 'afk-thinning-'));
  db = openDb(':memory:');
  app = createApp(db, { imagesDir: images });
});

describe('the thinning proposal', () => {
  // these cases were found and shrunk at the distance of the save-time duplicate check
  beforeEach(async () => {
    await put('/api/thinning-settings', { rank: 0.015 });
  });

  it('proposes removing the Rank Looks beyond the floor of three when four of one rank are identical', async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await rankLook('Supreme+', await tile(GOLD, BROWN)));
    const body = await get('/api/admin/review/thinning');
    const rank = body.kinds.find((k: any) => k.kind === 'rank');
    expect(rank.groups).toEqual([{ group: 'Supreme+', keep: ids.slice(0, 3), remove: [ids[3]] }]);
  });

  it('does not offer a removal after which the rank reader would name more wrong ranks', async () => {
    // Found by search and shrunk by hand: read from the others, 3 of these 7 looks are named wrong; without the fourth R1 look (a duplicate
    // of the green ones) 4 are, because a mislabelled green R2 look is then read with a wider margin.
    const looks: [string, [number, number, number], [number, number, number], number][] = [
      ['R1', [93, 92, 131], [166, 100, 124], 1],
      ['R1', [21, 181, 26], [56, 202, 69], -1],
      ['R1', [23, 185, 28], [54, 200, 68], 1],
      ['R1', [19, 182, 24], [55, 199, 67], 0],
      ['R2', [21, 183, 28], [55, 202, 67], 1],
      ['R2', [91, 90, 131], [163, 100, 121], 0],
      ['R2', [91, 92, 133], [164, 101, 123], 0],
    ];
    for (const [rank, top, band, shift] of looks) await rankLook(rank, await tile(top, band, shift));
    const body = await get('/api/admin/review/thinning');
    expect(body.kinds.find((k: any) => k.kind === 'rank').groups).toEqual([]);
  });

  it('offers the removals that do no harm and holds back the one that does, within the same group', async () => {
    const looks: [string, [number, number, number], [number, number, number], number][] = [
      ['R1', [93, 92, 131], [166, 100, 124], 1],
      ['R1', [21, 181, 26], [56, 202, 69], -1],
      ['R1', [23, 185, 28], [54, 200, 68], 1],
      ['R1', [19, 182, 24], [55, 199, 67], 0],
      ['R2', [21, 183, 28], [55, 202, 67], 1],
      ['R2', [91, 90, 131], [163, 100, 121], 0],
      ['R2', [91, 92, 133], [164, 101, 123], 0],
      ['R1', [20, 40, 200], [200, 200, 20], 0], // two identical looks unlike all the others: nothing is lost by removing one
      ['R1', [20, 40, 200], [200, 200, 20], 0],
    ];
    const ids = [];
    for (const [rank, top, band, shift] of looks) ids.push(await rankLook(rank, await tile(top, band, shift)));
    const body = await get('/api/admin/review/thinning');
    const [group] = body.kinds.find((k: any) => k.kind === 'rank').groups;
    expect(group.group).toBe('R1');
    expect(group.remove).toContain(ids[8]);
    // the green duplicate (the fourth look) is held back: removing it makes the reader name more wrong ranks
    expect(group.remove).not.toContain(ids[3]);
    expect(group.keep).toContain(ids[3]);
  });
});

describe('the thinning distance', () => {
  it('decides which Rank Looks count as alike: the proposal follows the saved setting', async () => {
    // the first two differ by a distance of about 0.0385; the other two look unlike them and each other
    const ids = [
      await rankLook('R1', await tile(GOLD, BROWN, 0)),
      await rankLook('R1', await tile(GOLD, BROWN, 12)),
      await rankLook('R1', await tile([20, 40, 200], [200, 200, 20])),
      await rankLook('R1', await tile([21, 181, 26], [56, 202, 69])),
    ];
    const proposal = async () => (await get('/api/admin/review/thinning')).kinds.find((k: any) => k.kind === 'rank').groups;
    expect(await proposal()).toHaveLength(1);
    expect((await proposal())[0].remove).toHaveLength(1);
    expect([ids[0], ids[1]]).toContain((await proposal())[0].remove[0]);
    await put('/api/thinning-settings', { rank: 0.01 });
    expect(await proposal()).toEqual([]);
  });
});

describe('applying a thinning', () => {
  // these cases were found and shrunk at the distance of the save-time duplicate check
  beforeEach(async () => {
    await put('/api/thinning-settings', { rank: 0.015 });
  });

  it('removes the ticked Rank Looks with their pictures and leaves the others', async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await rankLook('Supreme+', await tile(GOLD, BROWN)));
    const response = await post('/api/admin/review/thinning/apply', { kind: 'rank', ids: [ids[3]] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1 });
    expect(db.prepare('SELECT id FROM rank_look ORDER BY id').pluck().all()).toEqual(ids.slice(0, 3));
    expect(existsSync(fileOf(ids[3]!))).toBe(false);
    expect(existsSync(fileOf(ids[0]!))).toBe(true);
  });

  it('refuses a selection with a Rank Look the proposal does not offer, removing nothing, even beside one it does', async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await rankLook('Supreme+', await tile(GOLD, BROWN)));
    for (const ticked of [[ids[3]!, ids[0]!], [ids[0]!], [9999]]) {
      const response = await post('/api/admin/review/thinning/apply', { kind: 'rank', ids: ticked });
      expect(response.status).toBe(409);
    }
    expect(db.prepare('SELECT id FROM rank_look ORDER BY id').pluck().all()).toEqual(ids);
    for (const id of ids) expect(existsSync(fileOf(id))).toBe(true);
  });

  it('re-checks the ticked set as a whole: a removal that is harmless only after others is refused alone', async () => {
    // Found by search and shrunk: 2 of these 10 looks are named wrong by the others. The proposal offers the 2nd, 1st and 8th in that
    // order and keeps the count at 2; but without the 8th alone it is 3, since the 2nd and the 1st make it harmless.
    const looks: [string, [number, number, number], [number, number, number], number][] = [
      ['R2', [50, 138, 184], [146, 171, 140], 1],
      ['R2', [52, 139, 186], [143, 171, 138], -1],
      ['R2', [166, 249, 13], [117, 219, 90], -1],
      ['R2', [52, 142, 185], [142, 175, 139], -1],
      ['R2', [49, 139, 185], [142, 175, 138], -1],
      ['R1', [52, 139, 185], [142, 171, 140], 1],
      ['R2', [163, 187, 151], [49, 31, 232], 0],
      ['R2', [50, 138, 182], [145, 174, 137], 1],
      ['R1', [162, 185, 152], [47, 28, 231], -1],
      ['R1', [164, 189, 154], [46, 28, 230], -1],
    ];
    const ids = [];
    for (const [rank, top, band, shift] of looks) ids.push(await rankLook(rank, await tile(top, band, shift)));
    const proposal = (await get('/api/admin/review/thinning')).kinds.find((k: any) => k.kind === 'rank').groups;
    expect(proposal[0].remove.slice().sort()).toEqual([ids[0], ids[1], ids[7]].sort());
    expect((await post('/api/admin/review/thinning/apply', { kind: 'rank', ids: [ids[7]] })).status).toBe(409);
    expect(db.prepare('SELECT count(*) FROM rank_look').pluck().get()).toBe(10);
    expect((await post('/api/admin/review/thinning/apply', { kind: 'rank', ids: [ids[0], ids[1], ids[7]] })).status).toBe(200);
    expect(db.prepare('SELECT count(*) FROM rank_look').pluck().get()).toBe(7);
  });

  it('counts the Rank Looks and the wrongly read ones before and after the offered removals', async () => {
    // the 10 looks of the re-check case below: 2 are named wrong by the others, and the 3 removals offered leave it at 2
    const looks: [string, [number, number, number], [number, number, number], number][] = [
      ['R2', [50, 138, 184], [146, 171, 140], 1],
      ['R2', [52, 139, 186], [143, 171, 138], -1],
      ['R2', [166, 249, 13], [117, 219, 90], -1],
      ['R2', [52, 142, 185], [142, 175, 139], -1],
      ['R2', [49, 139, 185], [142, 175, 138], -1],
      ['R1', [52, 139, 185], [142, 171, 140], 1],
      ['R2', [163, 187, 151], [49, 31, 232], 0],
      ['R2', [50, 138, 182], [145, 174, 137], 1],
      ['R1', [162, 185, 152], [47, 28, 231], -1],
      ['R1', [164, 189, 154], [46, 28, 230], -1],
    ];
    for (const [rank, top, band, shift] of looks) await rankLook(rank, await tile(top, band, shift));
    const rank = (await get('/api/admin/review/thinning')).kinds.find((k: any) => k.kind === 'rank');
    expect(rank.counts).toEqual({ looks: 10, looksAfter: 7, wrong: 2, wrongAfter: 2 });
  });

  it('answers 400 to a body that is not a list of Rank Look ids, changing nothing', async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await rankLook('Supreme+', await tile(GOLD, BROWN)));
    const bodies: unknown[] = [{}, { kind: 'rank' }, { kind: 'rank', ids: 'all' }, { kind: 'rank', ids: [1.5] }, { kind: 'rank', ids: [] }, { kind: 'hero', ids: [ids[3]] }, null];
    for (const body of bodies) expect((await post('/api/admin/review/thinning/apply', body)).status).toBe(400);
    const notJson = await app.request('/api/admin/review/thinning/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'rank' });
    expect(notJson.status).toBe(400);
    expect(db.prepare('SELECT count(*) FROM rank_look').pluck().get()).toBe(4);
  });
});
