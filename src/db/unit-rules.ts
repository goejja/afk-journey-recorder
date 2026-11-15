import type Database from 'better-sqlite3';
import { applyUnitRules, type UnitRules } from '../domain/units.js';

/** The pairs, summons and second parts the player declared (`hero_pair`, `hero_summon`, `phantimal_part`). */
export function readUnitRules(db: Database.Database): UnitRules {
  const pairs = db.prepare('SELECT hero, part1, part2 FROM hero_pair ORDER BY hero').all() as { hero: string; part1: string; part2: string }[];
  const summons = db.prepare('SELECT hero, part, count FROM hero_summon ORDER BY hero').all() as { hero: string; part: string; count: number }[];
  const parts = db.prepare('SELECT phantimal, part FROM phantimal_part ORDER BY phantimal').all() as { phantimal: string; part: string }[];
  return {
    pairs: Object.fromEntries(pairs.map((p) => [p.hero, [p.part1, p.part2] as const])),
    summons: Object.fromEntries(summons.map((s) => [s.hero, { part: s.part, count: s.count }])),
    phantimalParts: Object.fromEntries(parts.map((p) => [p.phantimal, p.part])),
  };
}

/** Makes the rules of this database the ones the pure code works with. Done whenever a database is opened and after an edit. */
export const loadUnitRules = (db: Database.Database): void => applyUnitRules(readUnitRules(db));
