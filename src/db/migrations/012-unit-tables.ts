import type { Migration } from './index.js';

/**
 * 11 -> 12: which heroes stand on two tiles, which bring summons and which phantimal has a second part are data, no longer
 * constants. The rows are seeded with what the code used to know. They name units, not heroes, so they carry no foreign key: a
 * database without the heroes yet (before the first import) still knows how they stand. `Wedge of Power` is the second part of
 * `Wedge of Matter`, not a phantimal: the 2 formations that held it alone take the part's tile on `Wedge of Matter`, whose own
 * tile is unknown, and its crops are filed under `Wedge of Matter`, which shares them.
 */
export const migration: Migration = (db) => {
  db.exec(`
    CREATE TABLE hero_pair (hero TEXT PRIMARY KEY, part1 TEXT NOT NULL, part2 TEXT NOT NULL, CHECK (part1 <> part2));
    CREATE TABLE hero_summon (hero TEXT PRIMARY KEY, part TEXT NOT NULL, count INTEGER NOT NULL CHECK (count >= 1));
    CREATE TABLE phantimal_part (phantimal TEXT PRIMARY KEY, part TEXT NOT NULL);
    INSERT INTO hero_pair (hero, part1, part2) VALUES ('Elijah & Lailah', 'Elijah', 'Lailah');
    INSERT INTO hero_summon (hero, part, count) VALUES ('Zanie', 'Laser Turret', 2), ('Phraesto', 'Phraesto clone', 1);
    INSERT INTO phantimal_part (phantimal, part) VALUES ('Wedge of Matter', 'Wedge of Power');
  `);
  const exists = (name: string) => db.prepare('SELECT 1 FROM phantimal WHERE name = ?').get(name) !== undefined;
  if (exists('Wedge of Matter') && exists('Wedge of Power')) {
    db.exec(`
      UPDATE formation SET phantimal_name = 'Wedge of Matter', phantimal_partner_tile = phantimal_tile, phantimal_tile = NULL WHERE phantimal_name = 'Wedge of Power';
      UPDATE arena_attempt SET opp_phantimal = 'Wedge of Matter', opp_phantimal_partner_tile = opp_phantimal_tile, opp_phantimal_tile = NULL WHERE opp_phantimal = 'Wedge of Power';
      UPDATE unit_look SET name = 'Wedge of Matter' WHERE kind = 'phantimal' AND name = 'Wedge of Power';
      DELETE FROM phantimal WHERE name = 'Wedge of Power';
    `);
  }
};
