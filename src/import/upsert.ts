import type Database from 'better-sqlite3';

/** A column and the named parameter that fills it: `['damage_type', 'damageType']`. */
export type Field = readonly [column: string, param: string];

/**
 * The statement that stores an imported row: it inserts the row, or updates `fields` of the row with the same `key` while that row is
 * still the importer's (source = 'import'). A row the player added or edited by hand (source = 'manual') is never touched. The table and
 * column names are the importers' own constants, never user input.
 */
export function upsertImported(db: Database.Database, table: string, key: Field, fields: readonly Field[]) {
  const all = [key, ...fields];
  return db.prepare(
    `INSERT INTO ${table} (${all.map(([column]) => column).join(', ')}, source)
     VALUES (${all.map(([, param]) => `@${param}`).join(', ')}, 'import')
     ON CONFLICT (${key[0]}) DO UPDATE SET ${fields.map(([column]) => `${column} = excluded.${column}`).join(', ')}
     WHERE ${table}.source = 'import'`,
  );
}
