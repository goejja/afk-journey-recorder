import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../../src/db/open.js';
import { removeFiles, saveImage } from '../../../src/server/reader/saved-image.js';

let db: Database.Database;
let dir: string;
beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO hero (name, tier) VALUES ('Evie', 'S')").run();
  dir = mkdtempSync(join(tmpdir(), 'saved-image-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('saveImage', () => {
  it('names the file after the row id, for each table', () => {
    const written: string[] = [];
    const first = saveImage(db, dir, 'hero_example', { hero_name: 'Evie' }, Buffer.from('x'), written, 'roster');
    const second = saveImage(db, dir, 'hero_example', { hero_name: 'Evie' }, Buffer.from('y'), written, 'roster');
    expect([first, second]).toEqual([1, 2]);
    expect(db.prepare('SELECT id, file FROM hero_example ORDER BY id').all()).toEqual([{ id: 1, file: '1.png' }, { id: 2, file: '2.png' }]);
    saveImage(db, dir, 'unit_look', { kind: 'artifact', name: 'Arc Burst' }, Buffer.from('z'), written, 'roster');
    expect(db.prepare('SELECT kind, name, file FROM unit_look').all()).toEqual([{ kind: 'artifact', name: 'Arc Burst', file: '1.png' }]);
    saveImage(db, dir, 'rank_look', { rank: 'Supreme' }, Buffer.from('w'), written, 'offline');
    expect(db.prepare('SELECT source FROM hero_example UNION ALL SELECT source FROM rank_look').pluck().all()).toEqual(['roster', 'roster', 'offline']);
    expect(written.map((p) => p.slice(dir.length + 1))).toEqual(['hero-example/1.png', 'hero-example/2.png', 'unit-look/1.png', 'rank-look/1.png']);
  });

  it('takes the id SQLite would give, also after the last row was deleted', () => {
    const written: string[] = [];
    saveImage(db, dir, 'rank_look', { rank: 'Supreme' }, Buffer.from('x'), written, 'roster');
    saveImage(db, dir, 'rank_look', { rank: 'Supreme' }, Buffer.from('x'), written, 'roster');
    db.prepare('DELETE FROM rank_look WHERE id = 2').run();
    expect(saveImage(db, dir, 'rank_look', { rank: 'Supreme' }, Buffer.from('x'), written, 'roster')).toBe(2);
  });

  it('undoes the row when the file cannot be written, and removeFiles takes back the ones already written', () => {
    const written: string[] = [];
    writeFileSync(join(dir, 'blocked'), 'a file where a folder should be');
    expect(() =>
      db.transaction(() => {
        saveImage(db, dir, 'hero_look', { hero_name: 'Evie' }, Buffer.from('x'), written, 'roster');
        saveImage(db, join(dir, 'blocked'), 'hero_look', { hero_name: 'Evie' }, Buffer.from('y'), written, 'roster');
      })(),
    ).toThrow();
    expect(db.prepare('SELECT count(*) FROM hero_look').pluck().get()).toBe(0);
    expect(existsSync(join(dir, 'look', '1.png'))).toBe(true);
    removeFiles(written);
    expect(readdirSync(join(dir, 'look'))).toEqual([]);
  });
});
