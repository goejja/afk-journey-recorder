import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../../src/db/open.js';
import { isPictureTable, LEARNED_PICTURES, learnedPicturesRoot, PICTURE_TABLES, pictureDir, picturePath, removeFile, removeLooks } from '../../../src/server/reader/learned-pictures.js';

let db: Database.Database;
let dir: string;
beforeEach(() => {
  db = openDb(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'learned-pictures-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the learned pictures registry', () => {
  it('names real tables with the columns saveImage writes, each in a folder of its own', () => {
    for (const table of PICTURE_TABLES) {
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      expect(columns).toEqual(expect.arrayContaining([...LEARNED_PICTURES[table].columns, LEARNED_PICTURES[table].moves.column, 'file', 'source']));
    }
    const folders = PICTURE_TABLES.map((table) => LEARNED_PICTURES[table].folder);
    expect(new Set(folders).size).toBe(folders.length);
  });

  it('knows a table by its own name only, not by what every object has', () => {
    expect(PICTURE_TABLES.every(isPictureTable)).toBe(true);
    for (const name of ['constructor', 'toString', '__proto__', 'hero', 'rank', '']) expect(isPictureTable(name)).toBe(false);
  });

  it('puts the pictures of a table in its folder under images/custom', () => {
    expect(learnedPicturesRoot('/tmp/images')).toBe('/tmp/images/custom');
    expect(pictureDir('/root', 'rank_look')).toBe('/root/rank-look');
    expect(picturePath('/root', 'hero_look', '3.png')).toBe('/root/look/3.png');
  });
});

describe('removeFile', () => {
  it('says whether the file was removed, was already gone, or could not be removed', () => {
    const file = join(dir, 'a.png');
    writeFileSync(file, 'x');
    expect(removeFile(file)).toBe('removed');
    expect(existsSync(file)).toBe(false);
    expect(removeFile(file)).toBe('missing');
    mkdirSync(join(dir, 'folder'));
    expect(removeFile(join(dir, 'folder'))).toBe('failed'); // a folder is not a file
  });
});

describe('removeLooks', () => {
  it('deletes the rows in one go and then their pictures, and ignores a picture that is already gone', () => {
    mkdirSync(join(dir, 'rank-look'));
    db.prepare("INSERT INTO rank (name, position) VALUES ('Supreme', 1)").run();
    const ids = [1, 2, 3].map((n) => Number(db.prepare("INSERT INTO rank_look (rank, file) VALUES ('Supreme', ?)").run(`${n}.png`).lastInsertRowid));
    for (const n of [1, 2]) writeFileSync(join(dir, 'rank-look', `${n}.png`), 'x'); // the third file is missing
    removeLooks(db, dir, 'rank_look', [1, 2, 3].map((n, i) => ({ id: ids[i]!, file: `${n}.png` })));
    expect(db.prepare('SELECT count(*) FROM rank_look').pluck().get()).toBe(0);
    expect(existsSync(join(dir, 'rank-look', '1.png'))).toBe(false);
    expect(existsSync(join(dir, 'rank-look', '2.png'))).toBe(false);
  });

  it('leaves the other rows and pictures alone', () => {
    mkdirSync(join(dir, 'rank-look'));
    db.prepare("INSERT INTO rank (name, position) VALUES ('Supreme', 1)").run();
    db.prepare("INSERT INTO rank_look (id, rank, file) VALUES (1, 'Supreme', '1.png'), (2, 'Supreme', '2.png')").run();
    for (const n of [1, 2]) writeFileSync(join(dir, 'rank-look', `${n}.png`), 'x');
    removeLooks(db, dir, 'rank_look', [{ id: 1, file: '1.png' }]);
    expect(db.prepare('SELECT id FROM rank_look').pluck().all()).toEqual([2]);
    expect(existsSync(join(dir, 'rank-look', '2.png'))).toBe(true);
  });
});
