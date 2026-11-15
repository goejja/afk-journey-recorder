import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb, openReadonly, SCHEMA_VERSION } from '../../src/db/open.js';

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'afk-version-')), 'afk.db');
const schema = () => readFileSync(new URL('../../src/db/schema.sql', import.meta.url), 'utf8');

/** A database as the app made it before versions were kept: the baseline tables, version 0, and a leftover profile.tag. */
function legacyFile(): string {
  const path = tempFile();
  const db = new Database(path);
  db.exec(schema());
  db.exec("ALTER TABLE profile ADD COLUMN tag TEXT; INSERT INTO profile (id, name, is_default, tag) VALUES (1, 'Me', 1, 'old')");
  db.close();
  return path;
}

describe('database versions (ADR 0023)', () => {
  it('gives a new database the baseline, the first profile and season, the views and the current version', () => {
    const db = openDb(tempFile());
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT name, is_default FROM profile').all()).toEqual([{ name: 'Me', is_default: 1 }]);
    expect(db.prepare('SELECT count(*) FROM season WHERE is_current = 1').pluck().get()).toBe(1);
    expect(db.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'view'").pluck().get()).toBe(4);
    db.close();
  });

  it('can be opened again without changes', () => {
    const path = tempFile();
    openDb(path).close();
    const db = openDb(path);
    expect(db.prepare('SELECT count(*) FROM profile').pluck().get()).toBe(1);
    db.close();
  });

  it('adopts a database from before versions were kept, dropping only the leftover profile tag and keeping its rows', () => {
    const path = legacyFile();
    const db = openDb(path);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT * FROM profile').all()).toEqual([expect.objectContaining({ id: 1, name: 'Me' })]);
    expect(db.prepare('PRAGMA table_info(profile)').all().map((c: any) => c.name)).not.toContain('tag');
    db.close();
  });

  it('adds the source of a learned picture to a version 1 file, and leaves the pictures it had without one', () => {
    const path = tempFile();
    const old = new Database(path);
    old.exec(schema());
    old.exec("INSERT INTO profile (id, name, is_default) VALUES (1, 'Me', 1); INSERT INTO rank_look (rank, file) VALUES ('Supreme', '1.png'); PRAGMA user_version = 1");
    old.close();
    const db = openDb(path);
    expect(db.prepare('SELECT rank, source FROM rank_look').all()).toEqual([{ rank: 'Supreme', source: null }]);
    expect(() => db.prepare("UPDATE rank_look SET source = 'elsewhere'").run()).toThrow(/CHECK/);
    db.close();
  });

  it('renames the part of a unit to `part` in the columns and in the saved deployments (ADR 0028)', () => {
    const path = tempFile();
    const old = new Database(path);
    old.exec(schema());
    old.exec("INSERT INTO profile (id, name, is_default) VALUES (1, 'Me', 1); INSERT INTO tournament (season, number) VALUES (8, 1)");
    old.exec(
      `INSERT INTO formation_id (code, deployment) VALUES ('ABCD1234', '{"teams":[{"units":[{"hero":"Elijah & Lailah","unit":"Elijah","tile":30}],"phantimal":{"name":"Wedge of Matter","tile":28,"partnerTile":29},"artifact":null}]}')`,
    );
    old.exec(
      `INSERT INTO round_deployment (tournament_id, round, profile_id, team, content) VALUES (1, 'Group stage', 1, 1, '{"heroes":[{"tile":null,"hero":"Zanie","unit":"Laser Turret","rank":null,"equipmentLevel":null}],"phantimal":null,"artifact":null}')`,
    );
    old.pragma('user_version = 2');
    old.close();
    const db = openDb(path);
    const columns = (db.prepare('PRAGMA table_info(formation_hero)').all() as { name: string }[]).map((c) => c.name);
    expect(columns).toContain('part');
    expect(columns).not.toContain('unit');
    const deployment = JSON.parse(db.prepare('SELECT deployment FROM formation_id').pluck().get() as string);
    expect(deployment.teams[0].units).toEqual([
      { kind: 'hero', hero: 'Elijah & Lailah', part: 'Elijah', tile: 30 },
      { kind: 'phantimal', hero: 'Wedge of Matter', part: '', tile: 28 },
      { kind: 'phantimal', hero: 'Wedge of Matter', part: 'Wedge of Power', tile: 29 },
    ]);
    expect(deployment.teams[0].phantimal).toBeUndefined();
    const content = JSON.parse(db.prepare('SELECT content FROM round_deployment').pluck().get() as string);
    expect(content.heroes[0].part).toBe('Laser Turret');
    expect(content.heroes[0].unit).toBeUndefined();
    db.close();
  });

  it('keeps the tags of a whole record and deletes the tags of one side, dropping the side column (ADR 0033)', () => {
    const path = tempFile();
    const old = new Database(path);
    old.exec(schema());
    old.exec("INSERT INTO profile (id, name, is_default) VALUES (1, 'Me', 1); INSERT INTO attempt (id, mode, outcome) VALUES (1, 'Arena', 'Win')");
    old.exec("INSERT INTO attempt_tag (attempt_id, side, tag) VALUES (1, '', 'Season 8'), (1, 'A', 'Me'), (1, 'B', 'Luna')");
    old.pragma('user_version = 1');
    old.close();
    const db = openDb(path);
    expect(db.prepare('PRAGMA table_info(attempt_tag)').all().map((c: any) => c.name)).toEqual(['attempt_id', 'tag']);
    expect(db.prepare('SELECT attempt_id, tag FROM attempt_tag').all()).toEqual([{ attempt_id: 1, tag: 'Season 8' }]);
    db.close();
  });

  it('folds the tiles of a stage enemy into counts, a hero with several Units counting once (ADR 0034)', () => {
    const path = tempFile();
    const old = new Database(path);
    old.exec(schema());
    old.exec("ALTER TABLE stage_enemy ADD COLUMN part TEXT NOT NULL DEFAULT ''"); // what migration 5 does; the file is stamped as just past it
    old.exec(`INSERT INTO profile (id, name, is_default) VALUES (1, 'Me', 1);
      INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[]', '[]', '[]', 'manual');
      INSERT INTO stage (id, season, phase, kind, number, map_name) VALUES (1, 8, 0, 'Normal', 1, 'Open');
      INSERT INTO enemy (name, category) VALUES ('Grunt', 'Common');
      INSERT INTO hero (name) VALUES ('Zanie'), ('Elijah & Lailah'), ('Alna');
      INSERT INTO stage_enemy (stage_id, tile, enemy_name, hero_name, part) VALUES
        (1, 0, 'Grunt', NULL, ''), (1, 1, 'Grunt', NULL, ''), (1, 2, 'Grunt', NULL, ''),
        (1, 3, NULL, 'Alna', ''), (1, 4, NULL, 'Alna', ''),
        (1, 5, NULL, 'Zanie', ''), (1, 6, NULL, 'Zanie', 'Laser Turret'), (1, 7, NULL, 'Zanie', 'Laser Turret'),
        (1, 8, NULL, 'Elijah & Lailah', 'Elijah'), (1, 9, NULL, 'Elijah & Lailah', 'Lailah')`);
    old.pragma('user_version = 5');
    old.close();
    const db = openDb(path);
    expect(db.prepare('PRAGMA table_info(stage_enemy)').all().map((c: any) => c.name)).toEqual(['stage_id', 'enemy_name', 'hero_name', 'count']);
    expect(db.prepare('SELECT enemy_name AS enemy, hero_name AS hero, count FROM stage_enemy ORDER BY ifnull(enemy_name, \'~\'), hero_name').all()).toEqual([
      { enemy: 'Grunt', hero: null, count: 3 },
      { enemy: null, hero: 'Alna', count: 2 },
      { enemy: null, hero: 'Elijah & Lailah', count: 1 },
      { enemy: null, hero: 'Zanie', count: 1 },
    ]);
    expect(() => db.prepare("INSERT INTO stage_enemy (stage_id, enemy_name, count) VALUES (1, 'Grunt', 1)").run()).toThrow(/UNIQUE/);
    db.close();
  });

  it('makes pairs, summons and a phantimal\'s second part data, and moves Wedge of Power under Wedge of Matter', () => {
    const path = tempFile();
    const old = new Database(path);
    old.exec(schema());
    old.exec(`INSERT INTO profile (id, name, is_default) VALUES (1, 'Me', 1);
      INSERT INTO attempt (id, mode, outcome) VALUES (1, 'Arena', 'Win'), (2, 'Arena', 'Win');
      INSERT INTO phantimal (name, faction, class, source) VALUES ('Wedge of Matter', 'Celestial-Hypogean', 'Support', 'import'), ('Wedge of Power', 'Celestial-Hypogean', 'Support', 'import');
      INSERT INTO phantimal_season VALUES ('Wedge of Matter', 8), ('Wedge of Power', 8);
      INSERT INTO unit_look (kind, name, file) VALUES ('phantimal', 'Wedge of Power', '2.png'), ('phantimal', 'Wedge of Matter', '55.png');
      INSERT INTO formation (attempt_id, phantimal_name, phantimal_tile, phantimal_partner_tile) VALUES (1, 'Wedge of Power', 37, NULL), (2, 'Wedge of Matter', 28, 29)`);
    old.pragma('user_version = 11');
    old.close();
    const db = openDb(path);
    expect(db.prepare('SELECT * FROM hero_pair').all()).toEqual([{ hero: 'Elijah & Lailah', part1: 'Elijah', part2: 'Lailah' }]);
    expect(db.prepare('SELECT * FROM hero_summon ORDER BY hero').all()).toEqual([
      { hero: 'Phraesto', part: 'Phraesto clone', count: 1 },
      { hero: 'Zanie', part: 'Laser Turret', count: 2 },
    ]);
    expect(db.prepare('SELECT * FROM phantimal_part').all()).toEqual([{ phantimal: 'Wedge of Matter', part: 'Wedge of Power' }]);
    expect(db.prepare('SELECT name FROM phantimal').pluck().all()).toEqual(['Wedge of Matter']);
    expect(db.prepare('SELECT phantimal_name FROM phantimal_season').pluck().all()).toEqual(['Wedge of Matter']);
    expect(db.prepare('SELECT phantimal_name AS name, phantimal_tile AS tile, phantimal_partner_tile AS partner FROM formation ORDER BY attempt_id').all()).toEqual([
      { name: 'Wedge of Matter', tile: null, partner: 37 },
      { name: 'Wedge of Matter', tile: 28, partner: 29 },
    ]);
    expect(db.prepare("SELECT count(*) FROM unit_look WHERE name = 'Wedge of Matter'").pluck().get()).toBe(2);
    db.close();
  });

  it('adds the Semi-Finals Round and keeps every battle, its attempts and the deployments', () => {
    const path = tempFile();
    const old = new Database(path);
    old.exec(schema());
    old.exec(`INSERT INTO profile (id, name, is_default) VALUES (1, 'Me', 1);
      INSERT INTO tournament (id, season, number) VALUES (1, 8, 1);
      INSERT INTO battle (id, mode, tournament_id, round) VALUES (1, 'Super League', 1, 'Top 16');
      INSERT INTO attempt (id, mode, outcome, battle_id, battle_position) VALUES (1, 'Arena', 'Win', 1, 1);
      INSERT INTO round_deployment (tournament_id, round, profile_id, team, content) VALUES (1, 'Top 16', 1, 1, '{}')`);
    expect(() => old.exec("INSERT INTO battle (mode, tournament_id, round) VALUES ('Super League', 1, 'Semi-Finals')")).toThrow(/CHECK/);
    old.pragma('user_version = 1');
    old.close();
    const db = openDb(path);
    expect(db.prepare('SELECT battle_id FROM attempt WHERE id = 1').pluck().get()).toBe(1);
    expect(db.prepare('SELECT round FROM battle WHERE id = 1').pluck().get()).toBe('Top 16');
    expect(db.prepare('SELECT count(*) FROM round_deployment').pluck().get()).toBe(1);
    db.exec("INSERT INTO battle (mode, tournament_id, round) VALUES ('Super League', 1, 'Semi-Finals'); INSERT INTO round_deployment (tournament_id, round, profile_id, team, content) VALUES (1, 'Semi-Finals', 1, 1, '{}')");
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();
  });

  it('lets a Placement Rule reach the farthest unit and keeps the rules it had', () => {
    const path = tempFile();
    const old = new Database(path);
    old.exec(schema());
    old.pragma('user_version = 1');
    old.close();
    const first = openDb(path);
    first.exec("INSERT INTO placement_rule (hero, relation, effect, note, source) VALUES ('Alna', 'sameRow', 'protects', 'kept', 'manual')");
    expect(() => first.exec("INSERT INTO placement_rule (hero, relation, effect, source) VALUES ('Dunlingr', 'farthest', 'protects', 'manual')")).not.toThrow();
    first.close();
    expect(first.open).toBe(false);
    const db = openDb(path);
    expect(db.prepare('SELECT hero, relation, note FROM placement_rule ORDER BY hero').all()).toEqual([
      { hero: 'Alna', relation: 'sameRow', note: 'kept' },
      { hero: 'Dunlingr', relation: 'farthest', note: '' },
    ]);
    db.close();
  });

  it('gives a new database the pairs, summons and second part the code used to know, with no heroes imported yet', () => {
    const db = openDb(':memory:');
    expect(db.prepare('SELECT count(*) FROM hero_pair').pluck().get()).toBe(1);
    expect(db.prepare('SELECT count(*) FROM hero_summon').pluck().get()).toBe(2);
    expect(db.prepare('SELECT part FROM phantimal_part').pluck().all()).toEqual(['Wedge of Power']);
  });

  it('refuses an older file that differs from the baseline, names the difference and changes nothing', () => {
    const path = tempFile();
    const old = new Database(path);
    old.exec(schema());
    old.exec('ALTER TABLE hero ADD COLUMN surprise TEXT');
    old.close();
    expect(() => openDb(path)).toThrow(/hero: extra column surprise/);
    const after = new Database(path, { readonly: true });
    expect(after.pragma('user_version', { simple: true })).toBe(0);
    after.close();
  });

  it('refuses a file made by a newer app', () => {
    const path = tempFile();
    const db = new Database(path);
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => openDb(path)).toThrow(/newer version/);
  });

  it('copies nothing for a new database', () => {
    const path = tempFile();
    openDb(path).close();
    expect(existsSync(`${path}.before-v0`)).toBe(false);
  });

  it('opens for reading only a database at the current version, and never migrates', () => {
    const path = tempFile();
    openDb(path).close();
    const db = openReadonly(path);
    expect(() => db.exec('DELETE FROM profile')).toThrow();
    db.close();
    expect(() => openReadonly(join(tmpdir(), 'afk-missing', 'none.db'))).toThrow(/db:init/);
    const legacy = legacyFile();
    expect(() => openReadonly(legacy)).toThrow(/db:init/);
    const after = new Database(legacy, { readonly: true });
    expect(after.pragma('user_version', { simple: true })).toBe(0);
    after.close();
  });
});
