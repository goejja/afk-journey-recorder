import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { ARENA_MODES, TEAMS_PER_MODE } from '../../src/domain/arena.js';
import { DEFAULT_MODES } from '../../src/domain/defaults.js';

/** The modes named by `mode IN (...)` in the definition of a table. */
function modesOf(table: string): string[] {
  const db = openDb(':memory:');
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").pluck().get(table) as string;
  db.close();
  const list = /mode\s+TEXT NOT NULL CHECK \(mode IN \(([^)]*)\)\)/.exec(sql)![1]!;
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe('the mode lists', () => {
  it('are the ones the database allows', () => {
    expect(modesOf('arena_attempt')).toEqual([...ARENA_MODES]);
    expect(modesOf('scenario')).toEqual([...ARENA_MODES]);
    expect(modesOf('weekly_default')).toEqual([...DEFAULT_MODES]);
  });

  it('each have a number of teams', () => {
    expect(Object.keys(TEAMS_PER_MODE)).toEqual([...ARENA_MODES]);
  });
});
