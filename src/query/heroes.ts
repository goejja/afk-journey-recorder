import type Database from 'better-sqlite3';

/** What the database knows about one hero. */
export function heroInfo(db: Database.Database, name: string) {
  const base = db.prepare('SELECT name, tier, class, faction, damage_type AS damageType FROM hero WHERE lower(name) = lower(?)').get(name);
  if (!base) return null;
  return base;
}
