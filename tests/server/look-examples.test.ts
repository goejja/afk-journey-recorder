import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { lookExamples } from '../../src/server/reader/look-examples.js';

let db: Database.Database;
let images: string;

const tile = (seed: number) =>
  sharp(Buffer.from(Array.from({ length: 60 * 80 * 3 }, (_, i) => (i * 7 + seed * 31) % 256)), { raw: { width: 60, height: 80, channels: 3 } }).png().toBuffer();

async function put(folder: string, file: string, seed: number, insert: string, ...values: unknown[]) {
  const dir = join(images, 'custom', folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), await tile(seed));
  return Number(db.prepare(insert).run(...values, file).lastInsertRowid);
}
const count = (table: string) => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO rank (name, position) VALUES ('Elite', 0)").run();
  db.prepare("INSERT INTO hero (name) VALUES ('Evie'), ('Fay')").run();
  images = mkdtempSync(join(tmpdir(), 'afk-look-examples-'));
});

describe('the examples the readers compare a new tile with', () => {
  it('give the Rank Looks with their rank, in the order of their ids, and keep the vector of each for the next start', async () => {
    await put('rank-look', 'a.png', 1, "INSERT INTO rank_look (rank, file) VALUES ('Elite', ?)");
    await put('rank-look', 'b.png', 2, "INSERT INTO rank_look (rank, file) VALUES ('Elite', ?)");
    const examples = await lookExamples(db, images).rankExamples();
    expect(examples.map((e) => e.rank)).toEqual(['Elite', 'Elite']);
    expect(examples[0]!.features.length).toBeGreaterThan(0);
    expect(count('rank_look_feature')).toBe(2);
  });

  it('give the hero examples and then the Hero Looks, and keep the vectors of both', async () => {
    await put('hero-example', 'a.png', 1, "INSERT INTO hero_example (hero_name, file) VALUES ('Evie', ?)");
    await put('look', 'b.png', 2, "INSERT INTO hero_look (hero_name, file) VALUES ('Fay', ?)");
    const examples = await lookExamples(db, images).heroExamples();
    expect(examples.map((e) => e.hero)).toEqual(['Evie', 'Fay']);
    expect(count('hero_example_feature')).toBe(1);
    expect(count('hero_look_feature')).toBe(1);
  });

  it('give the artifact Unit Looks with their name, and keep their vectors', async () => {
    await put('unit-look', 'a.png', 1, "INSERT INTO unit_look (kind, name, file) VALUES ('artifact', 'Bladestorm', ?)");
    await put('unit-look', 'b.png', 2, "INSERT INTO unit_look (kind, name, file) VALUES ('phantimal', 'Wedge', ?)");
    const examples = await lookExamples(db, images).artifactExamples();
    expect(examples.map((e) => e.name)).toEqual(['Bladestorm']);
    expect(count('unit_look_feature')).toBe(1);
  });

  it('leave out a picture that is missing or cannot be decoded, instead of failing the whole read', async () => {
    await put('rank-look', 'a.png', 1, "INSERT INTO rank_look (rank, file) VALUES ('Elite', ?)");
    writeFileSync(join(images, 'custom', 'rank-look', 'bad.png'), 'not a picture');
    db.prepare("INSERT INTO rank_look (rank, file) VALUES ('Elite', 'bad.png')").run();
    db.prepare("INSERT INTO rank_look (rank, file) VALUES ('Elite', 'gone.png')").run();
    expect(await lookExamples(db, images).rankExamples()).toHaveLength(1);
    expect(count('rank_look_feature')).toBe(1);
  });
});
