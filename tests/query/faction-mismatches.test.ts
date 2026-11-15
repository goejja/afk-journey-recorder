import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { factionMismatches } from '../../src/query/faction-mismatches.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
  for (const [name, faction] of [
    ['A', 'Lightbearer'],
    ['B', 'Lightbearer'],
    ['C', 'Wilder'],
    ['D', 'Wilder'],
  ] as const)
    db.prepare('INSERT INTO hero (name, faction) VALUES (?, ?)').run(name, faction);
  db.prepare("INSERT INTO phantimal (name, faction) VALUES ('Gervan', 'Lightbearer')").run();
  db.prepare("INSERT OR IGNORE INTO map (name, tags, row_lengths, cells, source) VALUES ('Alpha', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(
    JSON.stringify(Array.from({ length: 45 }, (_, i) => (i < 5 ? -1 : i >= 38 ? 1 : -2))),
  );
});

/** A record of `mode` whose Side A brought `phantimal` with the heroes given, and no opponent. */
function record(heroes: string[], phantimal: string | null, mode = 'Supreme Arena'): number {
  const battle = db
    .prepare('INSERT INTO attempt (mode, outcome) VALUES (?, ?)')
    .run(mode === 'Stage' ? 'Stage' : 'Arena', 'Win').lastInsertRowid as number;
  const formation = db.prepare('INSERT INTO formation (attempt_id, phantimal_name, phantimal_tile) VALUES (?, ?, ?)').run(battle, phantimal, phantimal ? 40 : null).lastInsertRowid as number;
  for (const [i, hero] of heroes.entries()) db.prepare('INSERT INTO formation_hero (formation_id, tile, hero_name) VALUES (?, ?, ?)').run(formation, 38 + i, hero);
  db.prepare('INSERT INTO arena_attempt (attempt_id, mode, map_name) VALUES (?, ?, ?)').run(battle, mode, 'Alpha');
  return battle;
}

describe('the records whose Phantimal could not have stood there (ADR 0029)', () => {
  it('lists a record whose team has too few of its faction, and says why', () => {
    const good = record(['A', 'B', 'C'], null);
    const bad = record(['A', 'C', 'D'], 'Gervan');
    const found = factionMismatches(db);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ attemptId: bad, side: 'A', mode: 'Supreme Arena', phantimal: 'Gervan', problem: 'Gervan needs 3 Lightbearer heroes; this team has 1' });
    expect(found.some((m) => m.attemptId === good)).toBe(false);
  });

  it('says so when the mode never holds a Phantimal, whatever the faction', () => {
    db.prepare("INSERT INTO phantimal (name, faction) VALUES ('Olden', 'Wilder')").run();
    const arena = record(['C', 'D'], 'Olden', 'Arena');
    const found = factionMismatches(db);
    expect(found[0]).toMatchObject({ attemptId: arena, problem: 'Arena never holds a Phantimal' });
  });

  it('says nothing about a record with no Phantimal, or one whose faction the team meets', () => {
    record(['C', 'D'], null);
    const short = record(['A', 'A', 'B'], 'Gervan'); // the same hero on two tiles counts once, so this is two Lightbearers
    expect(factionMismatches(db).map((m) => m.attemptId)).toEqual([short]);
    // give the team a third Lightbearer: no mismatch is reported any more
    db.prepare("INSERT INTO hero (name, faction) VALUES ('E', 'Lightbearer')").run();
    db.prepare('INSERT INTO formation_hero (formation_id, tile, hero_name) VALUES ((SELECT id FROM formation WHERE attempt_id = ?), 41, ?)').run(short, 'E');
    expect(factionMismatches(db)).toEqual([]);
  });
});