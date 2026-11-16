import type Database from 'better-sqlite3';

/** What the database knows about one hero: its class and faction, and its range, energy and mechanic tags when it has them (the unit info, ADR 0037). */
export function heroInfo(db: Database.Database, name: string) {
  const base = db.prepare('SELECT name, tier, class, faction, damage_type AS damageType FROM hero WHERE lower(name) = lower(?)').get(name) as { name: string } | undefined;
  if (!base) return null;
  const row = db
    .prepare('SELECT range, energy, mechanics, released_season AS releasedInSeason, set_on AS setOn, source FROM hero_attribute WHERE hero = ?')
    .get(base.name) as { range: number | null; energy: string; mechanics: string; releasedInSeason: number | null; setOn: string; source: 'external' | 'manual' } | undefined;
  const attributes = row ? { ...row, energy: JSON.parse(row.energy), mechanics: JSON.parse(row.mechanics) } : null;
  return { ...base, attributes };
}
