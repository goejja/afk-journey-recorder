import type Database from 'better-sqlite3';

export interface ProfileRow {
  id: number;
  name: string;
  /** The player's id in the game, when known. */
  playerId: string | null;
  isDefault: boolean;
}

/** The id of the default profile: the one the app reads wherever it needs "the roster". */
export function defaultProfileId(db: Database.Database): number {
  return db.prepare('SELECT id FROM profile WHERE is_default = 1').pluck().get() as number;
}

/** A profile by id or by name (ignoring case); with no reference, the default one. */
export function findProfile(db: Database.Database, ref?: number | string | null): ProfileRow | undefined {
  const where = ref === undefined || ref === null || ref === '' ? 'is_default = 1' : typeof ref === 'number' || /^\d+$/.test(ref) ? 'id = ?' : 'name = ?';
  const row = db
    .prepare(`SELECT id, name, player_id AS playerId, is_default AS isDefault FROM profile WHERE ${where}`)
    .get(...(where === 'is_default = 1' ? [] : [typeof ref === 'string' && !/^\d+$/.test(ref) ? ref : Number(ref)])) as (Omit<ProfileRow, 'isDefault'> & { isDefault: number }) | undefined;
  return row && { ...row, isDefault: row.isDefault === 1 };
}
