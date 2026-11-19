import Database from 'better-sqlite3';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { DEFAULT_CURRENT_SEASON } from '../domain/season.js';
import { migrations } from './migrations/index.js';
import { shapeDifferences, shapeOf } from './shape.js';
import { loadUnitRules } from './unit-rules.js';

const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const viewsSql = readFileSync(new URL('./views.sql', import.meta.url), 'utf8');

/** The versions a migration starts from that rebuild a table other tables point at: they run with foreign keys off, then every key is checked. */
const REBUILDS_TABLES = new Set([16, 28]);

/** The `user_version` of a database that has every migration. */
export const SCHEMA_VERSION = 1 + migrations.length;

const hasTables = (db: Database.Database) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table'").get() !== undefined;
const versionOf = (db: Database.Database) => db.pragma('user_version', { simple: true }) as number;

/**
 * Opens the database, creating or upgrading it first (ADR 0023):
 * - an empty file gets the baseline, the first profile and season, then every migration;
 * - a file from before versions were kept is compared with the baseline and stamped version 1 when they agree, otherwise refused;
 * - a file of an older version is copied to `<file>.before-v<n>` and migrated;
 * - a file of a newer version is refused.
 * The views are dropped and made again each time.
 */
export function openDb(path: string): Database.Database {
  const db = new Database(path);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const version = versionOf(db);
    if (version > SCHEMA_VERSION) {
      throw new Error(`${path} is database version ${version}, but this app only knows up to ${SCHEMA_VERSION}: use a newer version of the app`);
    }
    if (version === 0 && !hasTables(db)) {
      db.transaction(() => {
        db.exec(schemaSql);
        seed(db);
        db.pragma('user_version = 1');
      })();
      migrate(db, null);
    } else {
      if (version === 0) adoptLegacy(db, path);
      migrate(db, path);
    }
    db.exec(viewsSql);
    loadUnitRules(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Opens the database for reading only, and never changes it. A database that is not at the current version has to be opened by
 * the app (or `npm run db:init`) first, so that a query never runs against tables of another shape.
 */
export function openReadonly(path: string): Database.Database {
  if (!existsSync(path)) throw new Error(`No database at ${path}: start the app or run \`npm run db:init\``);
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const version = versionOf(db);
  if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`${path} is database version ${version}, but the queries need ${SCHEMA_VERSION}: start the app or run \`npm run db:init\``);
  }
  loadUnitRules(db);
  return db;
}

/** The first profile ("Me", the default) and the current season, which a new database needs before anything else. */
function seed(db: Database.Database): void {
  db.prepare("INSERT INTO profile (id, name, is_default) VALUES (1, 'Me', 1)").run();
  db.prepare('INSERT INTO season (number, is_current) VALUES (?, 1)').run(DEFAULT_CURRENT_SEASON);
}

/**
 * Differences that older in-place upgrades left in the owner's database and that change nothing a query or the app can see:
 * `formation_id.deployment` was added without NOT NULL (every row has one), and `dream_hunt_attempt.time_seconds` was declared
 * INTEGER before it became REAL (SQLite keeps hundredths either way). Fixing them would mean rebuilding tables other tables
 * point at, so a file that differs only like this is accepted as it is.
 */
const HARMLESS_DRIFT = [
  /^formation_id: (missing|extra) column deployment text /,
  /^dream_hunt_attempt: (missing|extra) column time_seconds (real|integer) /,
];

/**
 * A database made before versions were kept has the tables of the baseline if the earlier in-place upgrades all ran. The leftover
 * `profile.tag` is dropped and the drift above is accepted; any other difference is refused with the list of what differs,
 * rather than guessed at.
 */
function adoptLegacy(db: Database.Database, path: string): void {
  const fresh = new Database(':memory:');
  fresh.exec(schemaSql);
  const expected = shapeOf(fresh);
  fresh.close();
  const differences = () => shapeDifferences(shapeOf(db), expected).filter((line) => !HARMLESS_DRIFT.some((drift) => drift.test(line)));
  const refuse = (lines: string[]) => new Error(`${path} was made by an older version and does not match the database layout (nothing was changed):\n  ${lines.join('\n  ')}`);
  const hasTag = (db.prepare('PRAGMA table_info(profile)').all() as { name: string }[]).some((c) => c.name === 'tag');
  const other = differences().filter((line) => !(hasTag && line.startsWith('profile: extra column tag ')));
  if (other.length > 0) throw refuse(other);
  db.transaction(() => {
    if (hasTag) db.exec('ALTER TABLE profile DROP COLUMN tag');
    db.pragma('user_version = 1');
  })();
}

/** Runs the migrations a database has not had yet, each in its own transaction. A file is copied once first (`path` is null for a database just made). */
function migrate(db: Database.Database, path: string | null): void {
  let version = versionOf(db);
  if (version >= SCHEMA_VERSION) return;
  if (path !== null && path !== ':memory:' && path !== '') {
    const copy = `${path}.before-v${version}`;
    if (!existsSync(copy)) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      copyFileSync(path, copy);
    }
  }
  for (; version < SCHEMA_VERSION; version += 1) {
    const rebuilds = REBUILDS_TABLES.has(version);
    // Foreign keys cannot be switched off inside a transaction, and dropping a table that others point at would otherwise
    // run their ON DELETE actions on the rows of the rebuilt table's children.
    if (rebuilds) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        migrations[version - 1]!(db);
        if (rebuilds) {
          const broken = db.pragma('foreign_key_check') as unknown[];
          if (broken.length > 0) throw new Error(`Migration ${version} -> ${version + 1} left ${broken.length} rows with a broken foreign key`);
        }
        db.pragma(`user_version = ${version + 1}`);
      })();
    } finally {
      if (rebuilds) db.pragma('foreign_keys = ON');
    }
  }
}
