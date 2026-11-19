import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFormationId, listFormationIds, renameArtifactInFormationIds } from '../../src/db/formation-ids.js';
import { openDb } from '../../src/db/open.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
});

/** The plan SQLite makes for a statement, one line per step. */
const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join('\n');

describe('lookup indexes (migration 27)', () => {
  // Each statement is what a delete, a cascade or a count of the records of a code runs; none may read a whole table.
  it.each([
    ['the formation of an attempt (cascade of a deleted attempt)', 'SELECT 1 FROM formation WHERE attempt_id = 1', 'formation_by_attempt'],
    ['the formations of a code', "SELECT attempt_id FROM formation WHERE formation_id = 'AAAAAAAA'", 'formation_by_formation_id'],
    ['the arena attempts against a code', "SELECT attempt_id FROM arena_attempt WHERE opp_formation_id = 'AAAAAAAA'", 'arena_attempt_by_opp_formation_id'],
    ['the battles of a code on either side', "SELECT id FROM battle WHERE formation_id = 'AAAAAAAA' OR opp_formation_id = 'AAAAAAAA'", 'battle_by_formation_id'],
    ['the battles of a tournament', 'SELECT id FROM battle WHERE tournament_id = 1', 'battle_by_tournament'],
    ['the attempts on a stage', 'SELECT attempt_id FROM stage_attempt WHERE stage_id = 1', 'stage_attempt_by_stage'],
    ['the round deployments of a profile (cascade of a deleted profile)', 'SELECT 1 FROM round_deployment WHERE profile_id = 1', 'round_deployment_by_profile'],
  ])('searches %s by an index', (_, sql, index) => {
    const steps = plan(sql);
    expect(steps).toMatch(new RegExp(`SEARCH .* USING (COVERING )?INDEX ${index}`));
    expect(steps).not.toMatch(/SCAN/);
  });

  it('searches the battles of a code on the opposite side by its own index', () => {
    expect(plan("SELECT id FROM battle WHERE formation_id = 'AAAAAAAA' OR opp_formation_id = 'AAAAAAAA'")).toMatch(/battle_by_opp_formation_id/);
  });
});

describe('the Formation ID library', () => {
  const store = () => {
    db.pragma('foreign_keys = OFF'); // only the columns that name a code matter here
    const deployment = (artifact: string | null) => JSON.stringify({ teams: [{ units: [], artifact }] });
    db.prepare('INSERT INTO formation_id (code, deployment) VALUES (?, ?), (?, ?), (?, ?)').run('AAAAAAAA', deployment('Bladestorm'), 'BBBBBBBB', deployment(null), 'CCCCCCCC', deployment('Bladestorm'));
    db.prepare("INSERT INTO formation_id_map (code, map_name) VALUES ('AAAAAAAA', 'Open'), ('AAAAAAAA', 'Ruins'), ('BBBBBBBB', 'Open')").run();
    for (const id of [1, 2, 3]) db.prepare("INSERT INTO attempt (id, mode, outcome) VALUES (?, 'Arena', 'Win')").run(id);
    db.prepare("INSERT INTO formation (attempt_id, formation_id) VALUES (1, 'AAAAAAAA'), (2, 'AAAAAAAA'), (3, 'BBBBBBBB')").run();
    // attempt 1 also fought against the code: a record is counted once however many of its columns name the code
    db.prepare("INSERT INTO arena_attempt (attempt_id, mode, map_name, opp_formation_id) VALUES (1, 'Arena', 'Open', 'AAAAAAAA'), (3, 'Arena', 'Open', 'AAAAAAAA')").run();
    // battle 1 names the code on both sides: one record
    db.prepare("INSERT INTO battle (id, mode, formation_id, opp_formation_id) VALUES (1, 'Supreme Arena', 'AAAAAAAA', 'AAAAAAAA'), (2, 'Supreme Arena', NULL, 'AAAAAAAA')").run();
  };

  it('counts the records of every code in one pass, as it does for one code', () => {
    store();
    const library = listFormationIds(db);
    expect(library.map((e) => [e.code, e.records])).toEqual([['AAAAAAAA', 5], ['BBBBBBBB', 1], ['CCCCCCCC', 0]]);
    expect(library.map((e) => e.maps)).toEqual([['Open', 'Ruins'], ['Open'], []]);
    for (const entry of library) expect(getFormationId(db, entry.code)).toEqual(entry);
    expect(getFormationId(db, 'ZZZZZZZZ')).toBeUndefined();
  });

  it('renames an Artifact in the stored Deployments without counting records', () => {
    store();
    renameArtifactInFormationIds(db, 'Bladestorm', 'Stormblade');
    expect(listFormationIds(db).map((e) => e.deployment.teams[0]?.artifact ?? null)).toEqual(['Stormblade', null, 'Stormblade']);
  });
});
