import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import type { Fetcher } from '../../src/import/fetch.js';
import { createApp } from '../../src/server/app.js';
import { backupDatabase, type SyncFetchers } from '../../src/server/sync.js';
import type { SyncState } from '../../src/shared/api.js';

const section = (id: number, name: string, file: string) => `<section id="artifact-${id}"><img src="/images/afk-journey/game/artifacts/${file}" alt=""/><h3>${name} Spell</h3></section>`;
const PAGE = `<html><body>${[section(1, 'Awakening', 'icon_sys_fairy_mn_1.cccccccc.webp'), ...Array.from({ length: 20 }, (_, i) => section(9000 + i, `Filler${i}`, `icon_sys_fairy_ep9_${i}.eeeeeeee.webp`))].join('')}</body></html>`;
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from([1, 2, 3])]);

let dir: string;
let gate: Promise<void> | null;
const unreachable: Fetcher = { text: async () => { throw new Error('GET https://www.yaphalla.com/editor failed: HTTP 503'); }, download: async () => { throw new Error('offline'); } };
const fetchers = (): SyncFetchers => ({
  yaphalla: unreachable,
  wiki: unreachable,
  afkglobal: {
    text: async () => {
      await gate;
      return PAGE;
    },
    download: async (_url, destination) => writeFileSync(destination, WEBP),
  },
  image: async () => new Response('missing', { status: 404 }),
});

function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO artifact (name, grp) VALUES ('Awakening', 'Pre-Season')").run();
  const app = createApp(db, { imagesDir: join(dir, 'images'), sync: { fetchers, backupDir: join(dir, 'backups'), imagesDir: join(dir, 'images') } });
  const state = async () => (await (await app.request('/api/admin/sync')).json()) as SyncState;
  const start = (body: object) => app.request('/api/admin/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const settled = async () => {
    for (let i = 0; i < 200; i++) {
      const s = await state();
      if (s.running === null) return s;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('the sync did not finish');
  };
  const source = (s: SyncState, id: string) => s.sources.find((x) => x.id === id)!;
  return { db, app, state, start, settled, source };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-'));
  gate = null;
});

describe('GET /api/admin/sync', () => {
  it('lists the sources, none of them run yet', async () => {
    const { state, source } = setup();
    const s = await state();
    expect(s.running).toBeNull();
    expect(s.sources.map((x) => x.id).slice(0, 2)).toEqual(['reference', 'artifact-images']);
    expect(source(s, 'reference').canOverwrite).toBe(true);
    expect(source(s, 'artifact-images').canOverwrite).toBe(false);
    expect(s.sources.every((x) => x.last === null)).toBe(true);
  });
});

describe('POST /api/admin/sync', () => {
  it('runs a source in the background, answers at once and keeps the run', async () => {
    const { start, settled, source, db } = setup();
    const res = await start({ source: 'artifact-images' });
    expect(res.status).toBe(202);
    expect(((await res.json()) as SyncState).running).toBe('artifact-images');
    const s = await settled();
    const last = source(s, 'artifact-images').last!;
    expect(last).toMatchObject({ status: 'ok', refresh: false, overwrite: false, error: null });
    expect(last.lines[0]).toMatch(/1 downloaded/);
    expect(last.finishedAt).not.toBeNull();
    expect(db.prepare('SELECT count(*) FROM sync_runs').pluck().get()).toBe(1);
    expect(existsSync(join(dir, 'images', 'artifacts', 'Awakening.webp'))).toBe(true);
  });

  it('refuses a second start while one runs', async () => {
    const { start, settled } = setup();
    let open!: () => void;
    gate = new Promise((resolve) => (open = resolve));
    await start({ source: 'artifact-images' });
    const second = await start({ source: 'artifact-images' });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'Sync already running' });
    open();
    await settled();
    expect((await start({ source: 'artifact-images' })).status).toBe(202);
    await settled();
  });

  it('refuses an unknown source', async () => {
    const { start } = setup();
    expect((await start({ source: 'prydwen' })).status).toBe(400);
  });

  it('goes on with the other sources when one fails, and says what failed', async () => {
    const { start, settled, source } = setup();
    await start({ source: 'all' });
    const s = await settled();
    expect(source(s, 'reference').last).toMatchObject({ status: 'failed', error: expect.stringContaining('HTTP 503') });
    expect(source(s, 'artifact-images').last).toMatchObject({ status: 'ok' });
  });

  it('backs up the database before an overwrite run and records the option', async () => {
    const { start, settled, source } = setup();
    await start({ source: 'reference', overwrite: true });
    const s = await settled();
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
    expect(source(s, 'reference').last).toMatchObject({ overwrite: true, status: 'failed' });
    // the run failed after the copy was made, and still says so
    expect(source(s, 'reference').last!.lines[0]).toMatch(/^Backed up the database to .* first$/);
  });

  it('takes no backup without the option, and ignores it for a source it does not concern', async () => {
    const { start, settled, source } = setup();
    await start({ source: 'artifact-images', overwrite: true, refresh: true });
    const s = await settled();
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    expect(source(s, 'artifact-images').last).toMatchObject({ overwrite: false, refresh: true });
  });

  it('marks a run a restart cut off as failed', async () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO sync_runs (source, status) VALUES ('reference', 'running')").run();
    createApp(db);
    expect(db.prepare('SELECT status, error FROM sync_runs').get()).toEqual({ status: 'failed', error: 'The app stopped before the run finished' });
  });
});

describe('the sync in GET /api/jobs', () => {
  it('says that a sync runs, and how the last one ended', async () => {
    const { app, start, settled } = setup();
    let open!: () => void;
    gate = new Promise((resolve) => (open = resolve));
    await start({ source: 'artifact-images' });
    const during = (await (await app.request('/api/jobs')).json()) as { sync: unknown };
    expect(during.sync).toEqual({ running: true, lastRunId: 1, failed: false });
    open();
    await settled();
    expect(((await (await app.request('/api/jobs')).json()) as { sync: unknown }).sync).toEqual({ running: false, lastRunId: 1, failed: false });
  });
});

describe('a sync of all sources in GET /api/jobs', () => {
  it('has failed when any of its runs failed, though the last one succeeded', async () => {
    const { app, start, settled } = setup();
    await start({ source: 'all' });
    await settled();
    expect(((await (await app.request('/api/jobs')).json()) as { sync: { failed: boolean } }).sync.failed).toBe(true);
    await start({ source: 'artifact-images' });
    await settled();
    expect(((await (await app.request('/api/jobs')).json()) as { sync: { failed: boolean } }).sync.failed).toBe(false);
  });
});

describe('backupDatabase', () => {
  it('never replaces a copy made in the same instant', async () => {
    const db = openDb(':memory:');
    const now = new Date(Date.UTC(2026, 10, 1));
    const first = await backupDatabase(db, join(dir, 'same'), now);
    const second = await backupDatabase(db, join(dir, 'same'), now);
    expect(second).not.toBe(first);
    expect(readdirSync(join(dir, 'same'))).toHaveLength(2);
  });

  it('keeps the newest five copies', async () => {
    const db = openDb(':memory:');
    const backups = join(dir, 'b');
    for (let i = 0; i < 7; i++) await backupDatabase(db, backups, new Date(Date.UTC(2026, 10, 1 + i)));
    const kept = readdirSync(backups);
    expect(kept).toHaveLength(5);
    expect(kept[0]).toContain('2026-11-03');
  });
});
