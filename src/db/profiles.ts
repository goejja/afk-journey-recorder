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

/** The Player ID of the default profile, or null when it has none: the player whose battles are the owner's own. */
export function defaultPlayerId(db: Database.Database): string | null {
  return (db.prepare(DEFAULT_PLAYER_ID_SQL).pluck().get() as string | undefined) ?? null;
}

/**
 * The Player ID of the default profile as a query that answers no row when there is none, for a clause of a larger query that cannot
 * be given the value as a parameter: `x IN (…)` and `x NOT IN (…)` never see a NULL.
 */
export const DEFAULT_PLAYER_ID_SQL = 'SELECT player_id FROM profile WHERE is_default = 1 AND player_id IS NOT NULL';

/** Makes a profile the default one; there is always exactly one. */
export function setDefaultProfile(db: Database.Database, id: number): void {
  db.transaction(() => {
    db.prepare('UPDATE profile SET is_default = 0 WHERE is_default = 1').run();
    db.prepare('UPDATE profile SET is_default = 1 WHERE id = ?').run(id);
  })();
}

export interface ProfileSummary extends ProfileRow {
  /** How many heroes the profile's roster holds. */
  heroCount: number;
}

/** Every profile with its hero count, the default first. */
export function listProfiles(db: Database.Database): ProfileSummary[] {
  return (db
    .prepare(
      `SELECT p.id, p.name, p.player_id AS playerId, p.is_default = 1 AS isDefault, (SELECT count(*) FROM roster r WHERE r.profile_id = p.id) AS heroCount
       FROM profile p ORDER BY p.is_default DESC, p.name`,
    )
    .all() as (Omit<ProfileSummary, 'isDefault'> & { isDefault: number })[]).map((p) => ({ ...p, isDefault: p.isDefault === 1 }));
}

/** A profile by id or by name (ignoring case); with no reference, the default one. */
export function findProfile(db: Database.Database, ref?: number | string | null): ProfileRow | undefined {
  const where = ref === undefined || ref === null || ref === '' ? 'is_default = 1' : typeof ref === 'number' || /^\d+$/.test(ref) ? 'id = ?' : 'name = ?';
  const row = db
    .prepare(`SELECT id, name, player_id AS playerId, is_default AS isDefault FROM profile WHERE ${where}`)
    .get(...(where === 'is_default = 1' ? [] : [typeof ref === 'string' && !/^\d+$/.test(ref) ? ref : Number(ref)])) as (Omit<ProfileRow, 'isDefault'> & { isDefault: number }) | undefined;
  return row && { ...row, isDefault: row.isDefault === 1 };
}
