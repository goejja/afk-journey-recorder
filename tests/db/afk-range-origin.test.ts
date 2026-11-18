import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

/** A database one version before the migration, with one stage attempt per call. Returns it with `add` and the reopened view. */
function before() {
  const path = join(mkdtempSync(join(tmpdir(), 'afk-range-')), 'afk.db');
  const db = openDb(path);
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  let stages = 0;
  const add = (kind: string, number: number, at: string, hero: string, tags: string[]) => {
    const stage = Number(db.prepare("INSERT INTO stage (season, phase, kind, number, map_name) VALUES (8, 0, ?, ?, 'Open')").run(kind, number).lastInsertRowid);
    const attempt = Number(db.prepare("INSERT INTO attempt (mode, outcome, created_at) VALUES ('Stage', 'Win', ?)").run(at).lastInsertRowid);
    db.prepare('INSERT INTO stage_attempt (attempt_id, stage_id) VALUES (?, ?)').run(attempt, stage);
    const formation = Number(db.prepare('INSERT INTO formation (attempt_id) VALUES (?)').run(attempt).lastInsertRowid);
    db.prepare("INSERT INTO formation_hero (formation_id, tile, hero_name, part) VALUES (?, 38, ?, '')").run(formation, hero);
    for (const tag of tags) db.prepare('INSERT INTO attempt_tag (attempt_id, tag) VALUES (?, ?)').run(attempt, tag);
    stages++;
    return attempt;
  };
  const reopen = () => {
    db.pragma('user_version = 24');
    db.close();
    return openDb(path);
  };
  return { db, add, reopen };
}

const tagsOf = (db: Database.Database) =>
  Object.fromEntries(
    (db.prepare("SELECT s.number, group_concat(t.tag) AS tags FROM attempt a JOIN stage_attempt sa ON sa.attempt_id = a.id JOIN stage s ON s.id = sa.stage_id LEFT JOIN attempt_tag t ON t.attempt_id = a.id GROUP BY a.id").all() as any[]).map((r) => [r.number, r.tags]),
  );

describe('migration 25: the first stage of an AFK range is not a copy', () => {
  it('untags the lowest stage of each range and leaves the others, a lone tagged stage included', () => {
    const { add, reopen } = before();
    for (const n of [601, 602, 603]) add('Phantisomal', n, '2026-11-01 01:03:39', 'A', ['AFK range', 'mine']);
    for (const n of [651, 652]) add('Phantisomal', n, '2026-11-01 01:04:16', 'B', ['AFK range']); // another formation and time
    add('Normal', 10, '2026-11-02 10:00:00', 'A', ['AFK range']); // a range of one stage
    add('Normal', 11, '2026-11-02 10:05:00', 'A', ['mine']); // never tagged
    const db = reopen();
    expect(tagsOf(db)).toEqual({ 601: 'mine', 602: 'AFK range,mine', 603: 'AFK range,mine', 651: null, 652: 'AFK range', 10: null, 11: 'mine' });
    db.close();
  });

  it('keeps two ranges saved in the same second apart by their formation, kind and phase', () => {
    const { add, reopen } = before();
    for (const n of [1, 2]) add('Normal', n, '2026-11-01 01:03:39', 'A', ['AFK range']);
    for (const n of [1, 2]) add('Phantisomal', n, '2026-11-01 01:03:39', 'A', ['AFK range']);
    for (const n of [5, 6]) add('Normal', n, '2026-11-01 01:03:39', 'B', ['AFK range']);
    const db = reopen();
    const untagged = db.prepare("SELECT s.kind, s.number FROM stage s JOIN stage_attempt sa ON sa.stage_id = s.id WHERE sa.attempt_id NOT IN (SELECT attempt_id FROM attempt_tag) ORDER BY s.kind, s.number").all();
    expect(untagged).toEqual([{ kind: 'Normal', number: 1 }, { kind: 'Normal', number: 5 }, { kind: 'Phantisomal', number: 1 }]);
    db.close();
  });

  it('stops when a group is not a run of consecutive stages', () => {
    const { add, reopen } = before();
    for (const n of [10, 11, 14]) add('Normal', n, '2026-11-01 01:03:39', 'A', ['AFK range']);
    expect(reopen).toThrow(/not consecutive/);
  });
});
