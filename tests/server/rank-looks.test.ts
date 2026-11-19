import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { FEATURES_VERSION } from '../../src/vision/rank-read.js';

let db: Database.Database;
let dir: string;

const tile = (seed: number) =>
  sharp(Buffer.from(Array.from({ length: 60 * 80 * 3 }, (_, i) => (i * 7 + seed * 31) % 256)), { raw: { width: 60, height: 80, channels: 3 } }).png().toBuffer();

async function addLook(file: string, seed = 1): Promise<number> {
  writeFileSync(join(dir, file), await tile(seed));
  return Number(db.prepare("INSERT INTO rank_look (rank, file) VALUES ('Elite', ?)").run(file).lastInsertRowid);
}

/** A copy of the module with an empty memory, as after a restart of the server. */
const freshModule = async () => {
  vi.resetModules();
  return import('../../src/server/reader/rank-looks.js');
};
const stored = (id: number) => db.prepare('SELECT version, size, mtime, vector FROM rank_look_feature WHERE look_id = ?').get(id) as { version: number; size: number; mtime: number; vector: Buffer } | undefined;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO rank (name, position) VALUES ('Elite', 0)").run();
  dir = mkdtempSync(join(tmpdir(), 'afk-rank-looks-'));
  mkdirSync(dir, { recursive: true });
});

describe('rankFeaturesFor', () => {
  it('decodes a picture once and stores its vector with the version, size and modification time of the file', async () => {
    const id = await addLook('a.png');
    const { rankFeaturesFor } = await freshModule();
    const { features, unreadable } = await rankFeaturesFor(db, [{ id, file: 'a.png' }], dir);
    expect(unreadable).toEqual([]);
    const row = stored(id)!;
    expect(row.version).toBe(FEATURES_VERSION);
    expect(row.size).toBeGreaterThan(0);
    expect(Array.from(new Float32Array(row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength)))).toEqual(Array.from(features.get(id)!));
  });

  it('uses the stored vector after a restart, without decoding the picture again', async () => {
    const id = await addLook('a.png');
    await (await freshModule()).rankFeaturesFor(db, [{ id, file: 'a.png' }], dir);
    // a vector that no picture would give: it is only returned if it is read, not computed
    const marked = new Float32Array([0.25, 0.5, 0.75]);
    db.prepare('UPDATE rank_look_feature SET vector = ? WHERE look_id = ?').run(Buffer.from(marked.buffer), id);
    const { features } = await (await freshModule()).rankFeaturesFor(db, [{ id, file: 'a.png' }], dir);
    expect(Array.from(features.get(id)!)).toEqual([0.25, 0.5, 0.75]);
  });

  it('gives the same array while the file is unchanged, which the distance table needs', async () => {
    const id = await addLook('a.png');
    const { rankFeaturesFor } = await freshModule();
    const first = (await rankFeaturesFor(db, [{ id, file: 'a.png' }], dir)).features.get(id);
    expect((await rankFeaturesFor(db, [{ id, file: 'a.png' }], dir)).features.get(id)).toBe(first);
  });

  it('decodes again when the stored version is not the extractor’s, or the file has changed', async () => {
    const id = await addLook('a.png');
    await (await freshModule()).rankFeaturesFor(db, [{ id, file: 'a.png' }], dir);
    const real = Array.from(new Float32Array(stored(id)!.vector.buffer.slice(stored(id)!.vector.byteOffset, stored(id)!.vector.byteOffset + stored(id)!.vector.byteLength)));
    const mark = (set: string) => db.prepare(`UPDATE rank_look_feature SET vector = ?, ${set} WHERE look_id = ?`).run(Buffer.from(new Float32Array([9]).buffer), id);

    mark('version = version - 1');
    expect(Array.from((await (await freshModule()).rankFeaturesFor(db, [{ id, file: 'a.png' }], dir)).features.get(id)!)).toEqual(real);
    expect(stored(id)!.version).toBe(FEATURES_VERSION);

    mark('size = size + 1');
    expect(Array.from((await (await freshModule()).rankFeaturesFor(db, [{ id, file: 'a.png' }], dir)).features.get(id)!)).toEqual(real);

    mark('version = version');
    utimesSync(join(dir, 'a.png'), new Date(), new Date(Date.now() - 86_400_000));
    expect(Array.from((await (await freshModule()).rankFeaturesFor(db, [{ id, file: 'a.png' }], dir)).features.get(id)!)).toEqual(real);
  });

  it('reports a picture that cannot be decoded, stores nothing for it, and tries it again next time', async () => {
    const good = await addLook('good.png');
    writeFileSync(join(dir, 'bad.png'), 'not a picture');
    const bad = Number(db.prepare("INSERT INTO rank_look (rank, file) VALUES ('Elite', 'bad.png')").run().lastInsertRowid);
    const { rankFeaturesFor } = await freshModule();
    const looks = [{ id: good, file: 'good.png' }, { id: bad, file: 'bad.png' }, { id: 99, file: 'missing.png' }];
    const first = await rankFeaturesFor(db, looks, dir);
    expect([...first.features.keys()]).toEqual([good]);
    expect(first.unreadable).toEqual([bad]);
    expect(stored(bad)).toBeUndefined();
    writeFileSync(join(dir, 'bad.png'), await tile(5)); // the picture is put back
    const second = await rankFeaturesFor(db, looks, dir);
    expect(second.unreadable).toEqual([]);
    expect(second.features.has(bad)).toBe(true);
  });

  it('removes the vector with the look', async () => {
    const id = await addLook('a.png');
    await (await freshModule()).rankFeaturesFor(db, [{ id, file: 'a.png' }], dir);
    db.prepare('DELETE FROM rank_look WHERE id = ?').run(id);
    expect(stored(id)).toBeUndefined();
  });

  it('stores no vector for a look deleted while its picture was being read', async () => {
    const id = await addLook('a.png');
    const { rankFeaturesFor } = await freshModule();
    const reading = rankFeaturesFor(db, [{ id, file: 'a.png' }], dir);
    db.prepare('DELETE FROM rank_look WHERE id = ?').run(id);
    await reading;
    expect(stored(id)).toBeUndefined();
  });
});
