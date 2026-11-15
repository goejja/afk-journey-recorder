import type Database from 'better-sqlite3';

/** The names a unit (a part of a pair, a summon, a phantimal's second part) must not share, lowercased. */
export interface TakenNames {
  heroes: Set<string>;
  phantimals: Set<string>;
  /** Every declared part, summon and second part. */
  parts: Set<string>;
}

/**
 * The names in use. `except` leaves out the declaration of one hero or phantimal, so that saving it again does not collide with
 * its own parts.
 */
export function takenNames(db: Database.Database, except: { hero?: string; phantimal?: string } = {}): TakenNames {
  const lower = (rows: string[]) => new Set(rows.map((name) => name.toLowerCase()));
  const pairs = db.prepare('SELECT hero, part1, part2 FROM hero_pair WHERE hero IS NOT ?').all(except.hero ?? null) as { part1: string; part2: string }[];
  const summons = db.prepare('SELECT part FROM hero_summon WHERE hero IS NOT ?').pluck().all(except.hero ?? null) as string[];
  const second = db.prepare('SELECT part FROM phantimal_part WHERE phantimal IS NOT ?').pluck().all(except.phantimal ?? null) as string[];
  return {
    heroes: lower(db.prepare('SELECT name FROM hero').pluck().all() as string[]),
    phantimals: lower(db.prepare('SELECT name FROM phantimal').pluck().all() as string[]),
    parts: lower([...pairs.flatMap((p) => [p.part1, p.part2]), ...summons, ...second]),
  };
}

/** The problem with a new unit name (a part, a summon, a second part), or null: it must differ from every hero, phantimal and other part. */
export function unitNameProblem(taken: TakenNames, name: string): string | null {
  const key = name.toLowerCase();
  if (taken.heroes.has(key)) return `"${name}" is already the name of a hero`;
  if (taken.phantimals.has(key)) return `"${name}" is already the name of a phantimal`;
  if (taken.parts.has(key)) return `"${name}" is already the name of another unit`;
  return null;
}

/** How many saved rows put a name on the board: `"hero":"<name>"` in the JSON of Formation IDs and Round Deployments. */
export function deploymentsNaming(db: Database.Database, name: string): number {
  const needle = `"hero":${JSON.stringify(name)}`;
  const ids = db.prepare('SELECT count(*) FROM formation_id WHERE instr(deployment, ?) > 0').pluck().get(needle) as number;
  const rounds = db.prepare('SELECT count(*) FROM round_deployment WHERE instr(content, ?) > 0').pluck().get(needle) as number;
  return ids + rounds;
}

/** The same for a part name: `"part":"<part>"`. */
export function deploymentsNamingPart(db: Database.Database, part: string): number {
  const needle = `"part":${JSON.stringify(part)}`;
  const ids = db.prepare('SELECT count(*) FROM formation_id WHERE instr(deployment, ?) > 0').pluck().get(needle) as number;
  const rounds = db.prepare('SELECT count(*) FROM round_deployment WHERE instr(content, ?) > 0').pluck().get(needle) as number;
  return ids + rounds;
}
