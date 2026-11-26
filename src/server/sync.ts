import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { syncArtifactImages } from '../import/artifact-images.js';
import { createCachedFetcher, type Fetcher } from '../import/fetch.js';
import { syncReference, type SyncOutcome } from '../import/reference-sync.js';
import type { SyncRun, SyncSource, SyncSourceId, SyncState, SyncSummary } from '../shared/api.js';
import { syncContract } from '../shared/contracts/sync.js';
import { fail, serve } from './contract.js';
import type { JobRegistry } from './agent/job-registry.js';

/** The fetchers a sync reads the outside sources with; tests give fakes. */
export interface SyncFetchers {
  yaphalla: Fetcher;
  wiki: Fetcher;
  afkglobal: Fetcher;
  /** Downloads one game icon (private edition). */
  image?: typeof fetch;
}

export interface SyncOptions {
  /** The fetchers for a run; `refresh` says whether the cache is ignored. */
  fetchers?: (refresh: boolean) => SyncFetchers;
  /** Where a copy of the database is kept before an overwrite run. */
  backupDir?: string;
  imagesDir?: string;
  registry?: JobRegistry;
}

/** How many copies made before an overwrite run are kept. */
const KEPT_BACKUPS = 5;

const defaultFetchers = (refresh: boolean): SyncFetchers => ({
  yaphalla: createCachedFetcher('cache/yaphalla', refresh),
  wiki: createCachedFetcher('cache/wiki', refresh),
  afkglobal: createCachedFetcher('cache/afkglobal', refresh),
});

interface Source {
  id: SyncSourceId;
  label: string;
  description: string;
  canOverwrite: boolean;
  run(db: Database.Database, fetchers: SyncFetchers, flags: { refresh: boolean; overwrite: boolean; imagesDir: string }): Promise<SyncOutcome>;
}

const SOURCES: Source[] = [
  {
    id: 'reference',
    label: 'Reference data',
    description: 'Heroes, bosses, enemies, Arena maps, ranks, equipment levels, artifacts and Phantimals, with their pictures, from Yaphalla and the wiki.',
    canOverwrite: true,
    run: (db, fetchers, { overwrite }) => syncReference(db, { yaphalla: fetchers.yaphalla, wiki: fetchers.wiki, overwrite }),
  },
  {
    id: 'artifact-images',
    label: 'Artifact images',
    description: 'The icon of each artifact, from afk.global.',
    canOverwrite: false,
    run: (db, fetchers, { imagesDir }) => syncArtifactImages(db, fetchers.afkglobal, imagesDir),
  },
];

interface Row {
  id: number;
  source: SyncSourceId;
  started_at: string;
  finished_at: string | null;
  status: SyncRun['status'];
  refresh: number;
  overwrite: number;
  lines: string;
  warnings: string;
  error: string | null;
}

const toRun = (row: Row): SyncRun => ({
  id: row.id,
  source: row.source,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  status: row.status,
  refresh: row.refresh === 1,
  overwrite: row.overwrite === 1,
  lines: JSON.parse(row.lines) as string[],
  warnings: JSON.parse(row.warnings) as string[],
  error: row.error,
});

/** Copies the database to `dir` and keeps the newest few copies. */
export async function backupDatabase(db: Database.Database, dir: string, now = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  // a copy is never replaced: a second one made in the same instant gets a number
  let file = join(dir, `afk-${stamp}.db`);
  for (let n = 2; existsSync(file); n += 1) file = join(dir, `afk-${stamp}-${n}.db`);
  await db.backup(file);
  const copies = readdirSync(dir).filter((name) => /^afk-.*\.db$/.test(name)).sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - KEPT_BACKUPS))) rmSync(join(dir, old), { force: true });
  return file;
}

/**
 * Admin > Sync (#377, ADR 0045): starts the syncs of the outside sources in the background, one at a time, and keeps what each run did in
 * `sync_runs`. A run that was cut off by a restart is marked failed when the app starts again.
 */
export function syncRoutes(db: Database.Database, options: SyncOptions = {}): Hono {
  const app = new Hono();
  const fetchersFor = options.fetchers ?? defaultFetchers;
  const imagesDir = options.imagesDir ?? 'images';
  let running: SyncSourceId | null = null;
  // whether the last sync (one source, or all of them) had a run that failed; a batch with one failure fails as a whole
  let failed = db.prepare("SELECT status FROM sync_runs WHERE status != 'running' ORDER BY id DESC LIMIT 1").pluck().get() === 'failed';

  db.prepare("UPDATE sync_runs SET status = 'failed', finished_at = datetime('now'), error = 'The app stopped before the run finished' WHERE status = 'running'").run();

  const lastRun = (id: SyncSourceId): SyncRun | null => {
    const row = db.prepare('SELECT * FROM sync_runs WHERE source = ? ORDER BY id DESC LIMIT 1').get(id) as Row | undefined;
    return row ? toRun(row) : null;
  };
  const state = (): SyncState => ({
    running,
    sources: SOURCES.map<SyncSource>(({ id, label, description, canOverwrite }) => ({ id, label, description, canOverwrite, last: lastRun(id) })),
  });

  options.registry?.register('sync', (): SyncSummary => {
    const last = db.prepare('SELECT id, status FROM sync_runs ORDER BY id DESC LIMIT 1').get() as { id: number; status: string } | undefined;
    return { running: running !== null, lastRunId: last?.id ?? 0, failed };
  });

  async function runOne(source: Source, refresh: boolean, overwrite: boolean): Promise<void> {
    const useOverwrite = overwrite && source.canOverwrite;
    const id = Number(db.prepare("INSERT INTO sync_runs (source, status, refresh, overwrite) VALUES (?, 'running', ?, ?)").run(source.id, refresh ? 1 : 0, useOverwrite ? 1 : 0).lastInsertRowid);
    const finish = (status: 'ok' | 'failed', outcome: SyncOutcome, error: string | null) =>
      db.prepare("UPDATE sync_runs SET status = ?, finished_at = datetime('now'), lines = ?, warnings = ?, error = ? WHERE id = ?").run(status, JSON.stringify(outcome.lines), JSON.stringify(outcome.warnings), error, id);
    running = source.id;
    const lines: string[] = [];
    try {
      if (useOverwrite) lines.push(`Backed up the database to ${await backupDatabase(db, options.backupDir ?? 'data/backups')} first`);
      const outcome = await source.run(db, fetchersFor(refresh), { refresh, overwrite: useOverwrite, imagesDir });
      finish('ok', { lines: [...lines, ...outcome.lines], warnings: outcome.warnings }, null);
    } catch (error) {
      failed = true;
      // what was done before the failure (the backup) stays on the run
      finish('failed', { lines, warnings: [] }, error instanceof Error ? error.message : String(error));
    }
  }

  serve(app, syncContract.state, () => state());

  serve(app, syncContract.start, ({ body }) => {
    if (running !== null) return fail(409, 'Sync already running');
    const chosen = body.source === 'all' ? SOURCES : SOURCES.filter((s) => s.id === body.source);
    if (chosen.length === 0) return fail(400, 'Unknown source');
    running = chosen[0]!.id;
    failed = false;
    // one after another; a source that fails does not stop the ones after it
    void (async () => {
      try {
        for (const source of chosen) await runOne(source, body.refresh, body.overwrite);
      } finally {
        running = null;
      }
    })();
    return state();
  });

  return app;
}
