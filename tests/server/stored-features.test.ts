import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { HERO_FEATURES_VERSION } from '../../src/vision/hero-read.js';
import { UNIT_FEATURES_VERSION } from '../../src/vision/unit-read.js';

let db: Database.Database;
let dir: string;

const tile = (seed: number) =>
  sharp(Buffer.from(Array.from({ length: 60 * 80 * 3 }, (_, i) => (i * 7 + seed * 31) % 256)), { raw: { width: 60, height: 80, channels: 3 } }).png().toBuffer();

/** A copy of the module with an empty memory, as after a restart of the server. */
const freshModule = async () => {
  vi.resetModules();
  return import('../../src/server/reader/stored-features.js');
};

// the kinds of look whose vectors are kept besides the Rank Looks (tests/server/rank-looks.test.ts)
const KINDS = [
  { name: 'hero examples', spec: 'HERO_EXAMPLES', table: 'hero_example', version: HERO_FEATURES_VERSION, insert: "INSERT INTO hero_example (hero_name, file) VALUES ('Evie', ?)" },
  { name: 'Hero Looks', spec: 'HERO_LOOKS', table: 'hero_look', version: HERO_FEATURES_VERSION, insert: "INSERT INTO hero_look (hero_name, file) VALUES ('Evie', ?)" },
  { name: 'Unit Looks', spec: 'UNIT_LOOKS', table: 'unit_look', version: UNIT_FEATURES_VERSION, insert: "INSERT INTO unit_look (kind, name, file) VALUES ('artifact', 'Bladestorm', ?)" },
] as const;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO hero (name) VALUES ('Evie')").run();
  dir = mkdtempSync(join(tmpdir(), 'afk-stored-features-'));
  mkdirSync(dir, { recursive: true });
});

describe.each(KINDS)('the stored features of $name', ({ spec, table, version, insert }) => {
  const add = async (file: string, seed = 1) => {
    writeFileSync(join(dir, file), await tile(seed));
    return Number(db.prepare(insert).run(file).lastInsertRowid);
  };
  const stored = (id: number) => db.prepare(`SELECT version, size, mtime, vector FROM ${table}_feature WHERE look_id = ?`).get(id) as { version: number; size: number; mtime: number; vector: Buffer } | undefined;
  const vectorOf = (row: { vector: Buffer }) => Array.from(new Float32Array(row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength)));

  it('decodes a picture once and keeps its vector with the version, size and modification time of the file', async () => {
    const id = await add('a.png');
    const module = await freshModule();
    const { features, unreadable } = await module.storedFeaturesFor(db, module[spec], [{ id, file: 'a.png' }], dir);
    expect(unreadable).toEqual([]);
    const row = stored(id)!;
    expect(row.version).toBe(version);
    expect(row.size).toBeGreaterThan(0);
    expect(vectorOf(row)).toEqual(Array.from(features.get(id)!));
  });

  it('uses the stored vector after a restart, without decoding the picture again', async () => {
    const id = await add('a.png');
    const first = await freshModule();
    await first.storedFeaturesFor(db, first[spec], [{ id, file: 'a.png' }], dir);
    // a vector that no picture would give: it is only returned if it is read, not computed
    db.prepare(`UPDATE ${table}_feature SET vector = ? WHERE look_id = ?`).run(Buffer.from(new Float32Array([0.25, 0.5, 0.75]).buffer), id);
    const second = await freshModule();
    const { features } = await second.storedFeaturesFor(db, second[spec], [{ id, file: 'a.png' }], dir);
    expect(Array.from(features.get(id)!)).toEqual([0.25, 0.5, 0.75]);
  });

  it('decodes again when the picture changed, or when the vector was made by another version of the extractor', async () => {
    const id = await add('a.png');
    const first = await freshModule();
    await first.storedFeaturesFor(db, first[spec], [{ id, file: 'a.png' }], dir);
    const marked = Buffer.from(new Float32Array([0.25]).buffer);
    db.prepare(`UPDATE ${table}_feature SET version = ?, vector = ? WHERE look_id = ?`).run(version + 1, marked, id);
    const afterUpgrade = await freshModule();
    expect((await afterUpgrade.storedFeaturesFor(db, afterUpgrade[spec], [{ id, file: 'a.png' }], dir)).features.get(id)!.length).toBeGreaterThan(1);
    expect(stored(id)!.version).toBe(version);

    db.prepare(`UPDATE ${table}_feature SET vector = ? WHERE look_id = ?`).run(marked, id);
    writeFileSync(join(dir, 'a.png'), await tile(9));
    utimesSync(join(dir, 'a.png'), new Date(2030, 0, 1), new Date(2030, 0, 1));
    const afterEdit = await freshModule();
    expect((await afterEdit.storedFeaturesFor(db, afterEdit[spec], [{ id, file: 'a.png' }], dir)).features.get(id)!.length).toBeGreaterThan(1);
  });

  it('leaves out a look whose picture is missing or cannot be decoded, names the second, and keeps nothing for either', async () => {
    const missing = Number(db.prepare(insert).run('gone.png').lastInsertRowid);
    writeFileSync(join(dir, 'bad.png'), 'not a picture');
    const bad = Number(db.prepare(insert).run('bad.png').lastInsertRowid);
    const good = await add('a.png');
    const module = await freshModule();
    const { features, unreadable } = await module.storedFeaturesFor(db, module[spec], [{ id: missing, file: 'gone.png' }, { id: bad, file: 'bad.png' }, { id: good, file: 'a.png' }], dir);
    expect([...features.keys()]).toEqual([good]);
    expect(unreadable).toEqual([bad]);
    expect(stored(missing)).toBeUndefined();
    expect(stored(bad)).toBeUndefined();
  });

  it('keeps the vector away from a look that was deleted while its picture was being read', async () => {
    const id = await add('a.png');
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    const module = await freshModule();
    await module.storedFeaturesFor(db, module[spec], [{ id, file: 'a.png' }], dir);
    expect(stored(id)).toBeUndefined();
  });

  it('deletes the vector with its look', async () => {
    const id = await add('a.png');
    const module = await freshModule();
    await module.storedFeaturesFor(db, module[spec], [{ id, file: 'a.png' }], dir);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    expect(stored(id)).toBeUndefined();
  });
});
