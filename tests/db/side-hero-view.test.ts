import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
  const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Duel', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  db.prepare("INSERT INTO attempt (mode, outcome) VALUES ('Stage', 'Win')").run();
  db.prepare("INSERT INTO formation (attempt_id) VALUES (1)").run();
  for (const hero of ['Zanie', 'Elijah & Lailah', 'Alna', 'Orson']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(hero);
});

const place = (tile: number, hero: string, part = '') => db.prepare('INSERT INTO formation_hero (formation_id, tile, hero_name, part) VALUES (1, ?, ?, ?)').run(tile, hero, part);
const tileOf = (hero: string) => db.prepare('SELECT tile FROM v_side_hero WHERE hero = ?').pluck().get(hero);

describe('the tile of a hero in v_side_hero (ADR 0028)', () => {
  it('is the hero’s own body, never one of its summons', () => {
    place(40, 'Zanie');
    place(38, 'Zanie', 'Laser Turret');
    place(39, 'Zanie', 'Laser Turret');
    expect(tileOf('Zanie')).toBe(40);
  });

  it('is the lower part for a Pair Hero, which has no body row', () => {
    place(41, 'Elijah & Lailah', 'Elijah');
    place(43, 'Elijah & Lailah', 'Lailah');
    expect(tileOf('Elijah & Lailah')).toBe(41);
  });

  it('is the only tile for a hero standing alone', () => {
    place(42, 'Alna');
    expect(tileOf('Alna')).toBe(42);
  });

  it('counts a hero once however many tiles it fills, and keeps the phantimal out of the heroes', () => {
    place(40, 'Zanie');
    place(38, 'Zanie', 'Laser Turret');
    place(39, 'Zanie', 'Laser Turret');
    place(41, 'Elijah & Lailah', 'Elijah');
    place(43, 'Elijah & Lailah', 'Lailah');
    expect(db.prepare('SELECT hero FROM v_side_hero ORDER BY hero').pluck().all()).toEqual(['Elijah & Lailah', 'Zanie']);
  });
});