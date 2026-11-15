import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/db/open.js';
import { applyBackfill, labelOfNote, planBackfill } from '../../src/import/picture-backfill.js';

let db: Database.Database;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'afk-backfill-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const picture = (folder: string, name: string, bytes: string) => {
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, name), bytes);
};
const record = (mode: string, label: string) => {
  const battle = Number(db.prepare('INSERT INTO battle (mode) VALUES (?)').run(mode).lastInsertRowid);
  return Number(db.prepare("INSERT INTO attempt (mode, outcome, note, battle_id) VALUES ('Arena', 'Win', ?, ?)").run(`Imported from ${label}: Brin against Rover`, battle).lastInsertRowid);
};

describe('labelOfNote', () => {
  it('reads the picture name from the note of a Battle import', () => {
    expect(labelOfNote('Imported from IMG_0001.jpeg: Brin against Edda KOR')).toBe('IMG_0001.jpeg');
    expect(labelOfNote('Imported from a picture: ? against ?')).toBe('a picture');
    expect(labelOfNote('Won easily')).toBeNull();
  });
});

describe('planBackfill', () => {
  it('matches a picture to the record that names it, by file name and mode', () => {
    record('Guild Duel', 'IMG_1.jpeg');
    picture('Guild_Duel_Battle_Report', 'IMG_1.jpeg', 'a');
    expect(planBackfill(db, root).map((m) => [m.label, m.status])).toEqual([['IMG_1.jpeg', 'unique']]);
  });

  it('reports a picture that is not in the folder, case apart', () => {
    record('Guild Duel', 'IMG_1.jpeg');
    record('Guild Duel', 'IMG_2.jpeg');
    picture('Guild_Duel_Battle_Report', 'img_1.JPEG', 'a');
    expect(planBackfill(db, root).map((m) => [m.label, m.status])).toEqual([['IMG_1.jpeg', 'unique'], ['IMG_2.jpeg', 'missing']]);
  });

  it('does not choose between different files with one name, but accepts copies of the same file', () => {
    record('Guild Duel', 'IMG_1.jpeg');
    record('Guild Duel', 'IMG_2.jpeg');
    picture('Guild_Duel_Battle_Report', 'IMG_1.jpeg', 'a');
    picture('Super_League_Battle_Report', 'IMG_1.jpeg', 'b');
    picture('Guild_Duel_Battle_Report', 'IMG_2.jpeg', 'same');
    picture('Guild Duel_Battle_Report', 'IMG_2.jpeg', 'same');
    expect(planBackfill(db, root).map((m) => [m.label, m.status])).toEqual([['IMG_1.jpeg', 'ambiguous'], ['IMG_2.jpeg', 'unique']]);
  });

  it('flags a folder whose mode differs from the record, and a name found only outside the report folders', () => {
    record('Guild Duel', 'IMG_1.jpeg');
    record('Guild Duel', 'IMG_2.jpeg');
    picture('Super_League_Battle_Report', 'IMG_1.jpeg', 'a');
    picture('Super_League_MyFormations', 'IMG_2.jpeg', 'b');
    expect(planBackfill(db, root).map((m) => [m.label, m.status])).toEqual([['IMG_1.jpeg', 'mode-differs'], ['IMG_2.jpeg', 'not-a-report']]);
  });

  it('changes nothing in the database', () => {
    record('Guild Duel', 'IMG_1.jpeg');
    picture('Guild_Duel_Battle_Report', 'IMG_1.jpeg', 'a');
    const before = db.prepare('SELECT count(*) FROM attempt').pluck().get();
    planBackfill(db, root);
    expect(db.prepare('SELECT count(*) FROM attempt').pluck().get()).toBe(before);
  });
});

describe('applyBackfill', () => {
  const jpeg = (colour: string) => sharp({ create: { width: 8, height: 8, channels: 3, background: colour } }).jpeg().toBuffer();

  it('keeps each matched picture once with the records that name it, and can be run again', async () => {
    const [a, b] = [record('Guild Duel', 'IMG_1.jpeg'), record('Guild Duel', 'IMG_2.jpeg')];
    record('Guild Duel', 'IMG_3.jpeg');
    mkdirSync(join(root, 'Guild_Duel_Battle_Report'), { recursive: true });
    writeFileSync(join(root, 'Guild_Duel_Battle_Report', 'IMG_1.jpeg'), await jpeg('#ff0000'));
    writeFileSync(join(root, 'Guild_Duel_Battle_Report', 'IMG_2.jpeg'), await jpeg('#00ff00'));
    const images = mkdtempSync(join(tmpdir(), 'afk-backfill-images-'));
    try {
      const done = await applyBackfill(db, root, images, planBackfill(db, root));
      expect(done).toEqual({ pictures: 2, records: 2, failed: [], removed: [] });
      expect(existsSync(join(root, 'Guild_Duel_Battle_Report', 'IMG_1.jpeg'))).toBe(true); // without --move the folder is left alone
      expect(db.prepare('SELECT attempt_id AS id, label FROM import_picture ORDER BY attempt_id').all()).toEqual([{ id: a, label: 'IMG_1.jpeg' }, { id: b, label: 'IMG_2.jpeg' }]);
      expect(readdirSync(join(images, 'imports', 'report'))).toHaveLength(2);
      await applyBackfill(db, root, images, planBackfill(db, root));
      expect(db.prepare('SELECT count(*) FROM import_picture').pluck().get()).toBe(2);
      expect(readdirSync(join(images, 'imports', 'report'))).toHaveLength(2);
    } finally {
      rmSync(images, { recursive: true, force: true });
    }
  });

  it('with move, removes the files and their identical copies once the stored copy is read back, and leaves what it did not keep', async () => {
    record('Guild Duel', 'IMG_1.jpeg');
    record('Guild Duel', 'IMG_2.jpeg');
    record('Guild Duel', 'IMG_3.jpeg');
    mkdirSync(join(root, 'Guild_Duel_Battle_Report'), { recursive: true });
    mkdirSync(join(root, 'Guild Duel_Battle_Report'), { recursive: true });
    const bytes = await jpeg('#ff0000');
    writeFileSync(join(root, 'Guild_Duel_Battle_Report', 'IMG_1.jpeg'), bytes);
    writeFileSync(join(root, 'Guild Duel_Battle_Report', 'IMG_1.jpeg'), bytes); // an identical copy
    writeFileSync(join(root, 'Guild_Duel_Battle_Report', 'IMG_2.jpeg'), await jpeg('#00ff00'));
    writeFileSync(join(root, 'Guild_Duel_Battle_Report', 'IMG_other.jpeg'), await jpeg('#0000ff')); // names no record
    writeFileSync(join(root, 'Guild_Duel_Battle_Report', 'IMG_3.jpeg'), await jpeg('#ffff00'));
    writeFileSync(join(root, 'Guild Duel_Battle_Report', 'IMG_3.jpeg'), await jpeg('#00ffff')); // a different file with the same name: not chosen between
    const images = mkdtempSync(join(tmpdir(), 'afk-backfill-images-'));
    try {
      const done = await applyBackfill(db, root, images, planBackfill(db, root), { move: true });
      expect(done.removed.sort()).toEqual(['Guild Duel_Battle_Report/IMG_1.jpeg', 'Guild_Duel_Battle_Report/IMG_1.jpeg', 'Guild_Duel_Battle_Report/IMG_2.jpeg']);
      expect(readdirSync(join(root, 'Guild_Duel_Battle_Report')).sort()).toEqual(['IMG_3.jpeg', 'IMG_other.jpeg']);
      expect(readdirSync(join(images, 'imports', 'report'))).toHaveLength(2);
    } finally {
      rmSync(images, { recursive: true, force: true });
    }
  });
});
