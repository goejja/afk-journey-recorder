import type Database from 'better-sqlite3';
import {
  compareDeployments,
  deploymentArtifactClash,
  deploymentFrom,
  extendDeployment,
  isEmptyDeployment,
  isFormationId,
  normalizeFormationId,
  type Deployment,
  type LayoutMatch,
} from '../domain/layout.js';

/** A Formation ID that cannot be used, with the reason; the API answers it with a 400. */
export class FormationIdError extends Error {}

/** One code of the library (ADR 0005, ADR 0007). */
export interface FormationIdEntry {
  code: string;
  deployment: Deployment;
  /** Where the code was seen: context, not part of a match. */
  maps: string[];
  /** How many records (fights on their own, or battles) name this code. */
  records: number;
}

export interface FormationIdMatch extends Omit<FormationIdEntry, 'deployment'> {
  match: LayoutMatch;
  deployment: Deployment;
}

const mapsOf = (db: Database.Database, code: string): string[] => db.prepare('SELECT map_name FROM formation_id_map WHERE code = ? ORDER BY rowid').pluck().all(code) as string[];

const recordCount = (db: Database.Database, code: string): number =>
  db
    .prepare(
      `SELECT count(*) FROM (
         SELECT 'f', attempt_id FROM formation WHERE formation_id = @code
         UNION SELECT 'f', attempt_id FROM arena_attempt WHERE opp_formation_id = @code
         UNION SELECT 'b', id FROM battle WHERE formation_id = @code OR opp_formation_id = @code)`,
    )
    .pluck()
    .get({ code }) as number;

/** The same count as `recordCount` for every code at once: a record is counted once however many of its columns name the code. */
const recordCounts = (db: Database.Database): Map<string, number> =>
  new Map(
    (
      db
        .prepare(
          `SELECT code, count(*) AS records FROM (
             SELECT formation_id AS code, 'f' AS kind, attempt_id AS id FROM formation WHERE formation_id IS NOT NULL
             UNION SELECT opp_formation_id, 'f', attempt_id FROM arena_attempt WHERE opp_formation_id IS NOT NULL
             UNION SELECT formation_id, 'b', id FROM battle WHERE formation_id IS NOT NULL
             UNION SELECT opp_formation_id, 'b', id FROM battle WHERE opp_formation_id IS NOT NULL)
           GROUP BY code`,
        )
        .all() as { code: string; records: number }[]
    ).map((r) => [r.code, r.records]),
  );

const allMaps = (db: Database.Database): Map<string, string[]> => {
  const byCode = new Map<string, string[]>();
  for (const r of db.prepare('SELECT code, map_name AS map FROM formation_id_map ORDER BY rowid').all() as { code: string; map: string }[]) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r.map]);
  return byCode;
};

/** Every code of the library, in alphabetical order. */
export function listFormationIds(db: Database.Database): FormationIdEntry[] {
  const counts = recordCounts(db);
  const maps = allMaps(db);
  return (db.prepare('SELECT code, deployment FROM formation_id ORDER BY code').all() as { code: string; deployment: string }[]).map((r) => ({
    code: r.code,
    deployment: JSON.parse(r.deployment) as Deployment,
    maps: maps.get(r.code) ?? [],
    records: counts.get(r.code) ?? 0,
  }));
}

/** One code of the library, or undefined when it is not stored. */
export function getFormationId(db: Database.Database, code: string): FormationIdEntry | undefined {
  const row = db.prepare('SELECT code, deployment FROM formation_id WHERE code = ?').get(code) as { code: string; deployment: string } | undefined;
  return row && { code: row.code, deployment: JSON.parse(row.deployment) as Deployment, maps: mapsOf(db, row.code), records: recordCount(db, row.code) };
}

/** The stored codes that cover every team of `placed` with the same units on the same tiles, as they are or all turned upside down. */
export function findFormationIds(db: Database.Database, placed: Deployment): FormationIdMatch[] {
  if (isEmptyDeployment(placed)) return [];
  return listFormationIds(db).flatMap((entry) => {
    const match = compareDeployments(entry.deployment, placed);
    return match ? [{ ...entry, match }] : [];
  });
}

/**
 * Says why `code` cannot be declared for `placed`: it is not a Formation ID, or it is a known code stored with other units
 * or tiles or with another Artifact in a team both have (a code stands for one Deployment, so one of the two is wrong).
 * Teams the stored code lacks are fine: the code is extended. Null when it can be used.
 */
export function checkFormationId(db: Database.Database, code: string, placed: Deployment): string | null {
  if (!isFormationId(code)) return 'A Formation ID is 8 characters: digits or capital letters';
  const stored = db.prepare('SELECT deployment FROM formation_id WHERE code = ?').pluck().get(code) as string | undefined;
  if (stored === undefined) return null;
  const deployment = JSON.parse(stored) as Deployment;
  if (compareDeployments(deployment, placed, true) === null) return `${code} is stored with other units or tiles`;
  const clash = deploymentArtifactClash(deployment, placed);
  if (clash) return `${code} is stored with ${clash.stored} on team ${clash.team}, not ${clash.placed}`;
  return null;
}

/**
 * Declares a code for the Deployment of a record: a new code is stored with it, a known one gains the teams and Artifacts
 * it lacked and the maps it was seen on. A team already stored is never replaced. Throws the message of checkFormationId
 * when it refuses.
 */
export function declareFormationId(db: Database.Database, code: string, placed: Deployment, seenWith: { mapNames?: (string | null | undefined)[] }): void {
  const error = checkFormationId(db, code, placed);
  if (error) throw new FormationIdError(error);
  const stored = db.prepare('SELECT deployment FROM formation_id WHERE code = ?').pluck().get(code) as string | undefined;
  if (stored === undefined) {
    db.prepare('INSERT INTO formation_id (code, deployment) VALUES (?, ?)').run(code, JSON.stringify(extendDeployment({ teams: [] }, placed)));
  } else {
    const extended = extendDeployment(JSON.parse(stored) as Deployment, placed);
    db.prepare('UPDATE formation_id SET deployment = ? WHERE code = ?').run(JSON.stringify(extended), code);
  }
  for (const mapName of seenWith.mapNames ?? []) if (mapName) db.prepare('INSERT OR IGNORE INTO formation_id_map (code, map_name) VALUES (?, ?)').run(code, mapName);
}

/** Stores a code on its own, with no map. Throws when it is not valid or already stored. */
export function addFormationId(db: Database.Database, code: string, deployment: Deployment): void {
  if (!isFormationId(code)) throw new FormationIdError('A Formation ID is 8 characters: digits or capital letters');
  if (db.prepare('SELECT 1 FROM formation_id WHERE code = ?').get(code)) throw new FormationIdError(`${code} is already stored`);
  declareFormationId(db, code, deployment, {});
}

/** Removes a code; the records that named it forget it. Returns how many codes were removed (0 or 1). */
export function deleteFormationId(db: Database.Database, code: string): number {
  return db.prepare('DELETE FROM formation_id WHERE code = ?').run(code).changes;
}

/** An Artifact was renamed: the stored Deployments name it as plain text, so they follow. */
export function renameArtifactInFormationIds(db: Database.Database, from: string, to: string): void {
  for (const row of db.prepare('SELECT code, deployment FROM formation_id').all() as { code: string; deployment: string }[]) {
    const deployment = JSON.parse(row.deployment) as Deployment;
    if (!deployment.teams.some((t) => t?.artifact === from)) continue;
    const teams = deployment.teams.map((t) => (t?.artifact === from ? { ...t, artifact: to } : t));
    db.prepare('UPDATE formation_id SET deployment = ? WHERE code = ?').run(JSON.stringify({ teams }), row.code);
  }
}

/** A team as a record carries it: its units, phantimal and artifact. */
export interface PlacedSide {
  heroes?: { tile: number; hero: string; part?: string | null }[];
  phantimal?: { name: string; tile: number; partnerTile?: number | null } | null;
  artifact?: string | null;
}

/** What a record names: the code as typed, and the teams it covers (one for a fight on its own). */
export interface NamedFormationId {
  code: string | null | undefined;
  teams: (PlacedSide | null | undefined)[];
  /** The maps the teams were fought on. */
  mapNames?: (string | null | undefined)[];
}

/** The code a record names, trimmed and in capitals, or null when it names none. */
const declaredFormationId = (code: string | null | undefined): string | null => {
  const normalized = normalizeFormationId(code ?? '');
  return normalized === '' ? null : normalized;
};

/** Why the code a record names cannot be used (see checkFormationId), or null when it names none or can be used. */
export function formationIdProblem(db: Database.Database, named: NamedFormationId): string | null {
  const code = declaredFormationId(named.code);
  return code === null ? null : checkFormationId(db, code, deploymentFrom(named.teams));
}

/** Declares the code a record names, if any, and returns it for the record to keep. */
export function declareNamedFormationId(db: Database.Database, named: NamedFormationId): string | null {
  const code = declaredFormationId(named.code);
  if (code !== null) declareFormationId(db, code, deploymentFrom(named.teams), { mapNames: named.mapNames });
  return code;
}
