import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalHeroName, mergeRenamedHeroes } from '../../src/db/hero-renames.js';
import { openDb } from '../../src/db/open.js';

let db: Database.Database;

const addHero = (name: string) => db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type, image_path, source) VALUES (?, 'S', 'Warrior', 'Dimensional', 'Physical', ?, 'import')").run(name, `images/heroes/${name}.png`);
const roster = (profile: number) => db.prepare('SELECT hero_name AS hero, rank, equipment_level AS level FROM roster WHERE profile_id = ? ORDER BY hero_name').all(profile);

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO rank (name, position) VALUES ('Elite', 0), ('Epic', 1)").run();
  db.prepare('INSERT INTO equipment_level (level) VALUES (0), (5), (10)').run();
  db.prepare("INSERT INTO profile (id, name, is_default) VALUES (2, 'Second', 0)").run();
  addHero('Taichi&Agumon');
  addHero('YamatoGabumon');
});

describe('canonicalHeroName', () => {
  it('names the new spelling for the old one and leaves other names alone', () => {
    expect(canonicalHeroName('Taichi&Agumon')).toBe('Taichi & Agumon');
    expect(canonicalHeroName('Taichi & Agumon')).toBe('Taichi & Agumon');
    expect(canonicalHeroName('Evie')).toBe('Evie');
  });
});

describe('mergeRenamedHeroes', () => {
  it('renames the old hero, with its roster, records and JSON documents', () => {
    db.prepare("INSERT INTO roster (profile_id, hero_name, rank, equipment_level) VALUES (1, 'YamatoGabumon', 'Epic', 5)").run();
    db.prepare("INSERT OR REPLACE INTO hero_pvp_hint (hero, pvp_tier, pvp_role, set_on) VALUES ('Taichi&Agumon', 'S', 'Damage dealer', '2026-01-01')").run();
    db.prepare("INSERT INTO formation_id (code, deployment) VALUES ('AAAAAAAA', '{\"units\":[{\"hero\":\"Taichi&Agumon\"},{\"hero\":\"Evie\"}]}')").run();
    mergeRenamedHeroes(db);
    expect(db.prepare("SELECT name, image_path FROM hero WHERE name LIKE '%Gabumon' OR name LIKE '%Agumon' ORDER BY name").all()).toEqual([
      { name: 'Taichi & Agumon', image_path: 'images/heroes/Taichi & Agumon.png' },
      { name: 'Yamato & Gabumon', image_path: 'images/heroes/Yamato & Gabumon.png' },
    ]);
    expect(roster(1)).toEqual([{ hero: 'Yamato & Gabumon', rank: 'Epic', level: 5 }]);
    expect(db.prepare("SELECT hero FROM hero_pvp_hint WHERE hero LIKE 'Taichi%'").pluck().all()).toEqual(['Taichi & Agumon']);
    expect(db.prepare('SELECT deployment FROM formation_id').pluck().get()).toBe('{"units":[{"hero":"Taichi & Agumon"},{"hero":"Evie"}]}');
  });

  it('merges a hero a sync added next to the old one, keeping the better roster row', () => {
    addHero('Taichi & Agumon');
    db.prepare("INSERT INTO roster (profile_id, hero_name, rank, equipment_level) VALUES (1, 'Taichi&Agumon', 'Elite', 10), (1, 'Taichi & Agumon', 'Epic', 0), (2, 'Taichi & Agumon', 'Elite', 5), (2, 'Taichi&Agumon', 'Elite', 10)").run();
    mergeRenamedHeroes(db);
    expect(db.prepare("SELECT name FROM hero WHERE name LIKE 'Taichi%'").pluck().all()).toEqual(['Taichi & Agumon']);
    expect(roster(1)).toEqual([{ hero: 'Taichi & Agumon', rank: 'Epic', level: 0 }]);
    expect(roster(2)).toEqual([{ hero: 'Taichi & Agumon', rank: 'Elite', level: 10 }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('keeps the old hero\'s hint and attribute when both heroes have one, unless only the new one was written by hand', () => {
    addHero('Taichi & Agumon');
    const hint = db.prepare("INSERT OR REPLACE INTO hero_pvp_hint (hero, pvp_tier, pvp_role, set_on, source) VALUES (?, ?, 'Tank', '2026-01-01', ?)");
    hint.run('Taichi&Agumon', 'S', 'prydwen');
    hint.run('Taichi & Agumon', 'B', 'prydwen');
    hint.run('YamatoGabumon', 'S', 'prydwen');
    hint.run('Yamato & Gabumon', 'A', 'manual');
    addHero('Yamato & Gabumon');
    const attribute = db.prepare("INSERT OR REPLACE INTO hero_attribute (hero, range, set_on) VALUES (?, ?, '2026-01-01')");
    attribute.run('Taichi&Agumon', 1);
    attribute.run('Taichi & Agumon', 3);
    mergeRenamedHeroes(db);
    expect(db.prepare("SELECT hero, pvp_tier AS tier FROM hero_pvp_hint WHERE hero LIKE 'Taichi%' OR hero LIKE 'Yamato%' ORDER BY hero").all()).toEqual([
      { hero: 'Taichi & Agumon', tier: 'S' },
      { hero: 'Yamato & Gabumon', tier: 'A' },
    ]);
    expect(db.prepare("SELECT hero, range FROM hero_attribute WHERE hero LIKE 'Taichi%'").all()).toEqual([{ hero: 'Taichi & Agumon', range: 1 }]);
  });

  it('does nothing when no hero has the old name, and can run again', () => {
    db.prepare("DELETE FROM hero WHERE name IN ('Taichi&Agumon', 'YamatoGabumon')").run();
    addHero('Taichi & Agumon');
    mergeRenamedHeroes(db);
    mergeRenamedHeroes(db);
    expect(db.prepare("SELECT name FROM hero WHERE name LIKE '%Agumon'").pluck().all()).toEqual(['Taichi & Agumon']);
  });
});
