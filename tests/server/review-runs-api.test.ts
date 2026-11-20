import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let db: Database.Database;
let app: Hono;

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp(db, { imagesDir: mkdtempSync(join(tmpdir(), 'afk-runs-')) });
});

const startRun = () => app.request('/api/admin/review/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const latest = async () => (await app.request('/api/admin/review/runs/latest')).json() as Promise<any>;
const rankLooks = (rank: string, count: number) => {
  for (let i = 0; i < count; i++) db.prepare('INSERT INTO rank_look (rank, file) VALUES (?, ?)').run(rank, `${rank}-${Math.random()}.png`);
};

describe('the Review runs', () => {
  it('has no run until the player starts one, then keeps the findings of the run with its date', async () => {
    expect(await latest()).toBeNull();
    rankLooks('Paragon 3', 2);
    const started = await startRun();
    expect(started.status).toBe(201);
    const run = await started.json();
    expect(typeof run.id).toBe('number');
    expect(run.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(run.findings.improve.map((f: any) => [f.code, f.subject])).toEqual([['rank-few-looks', 'Paragon 3']]);

    // the run is what is shown later, not a new look: the data changes after it, the run does not
    rankLooks('Paragon 3', 5);
    const again = await latest();
    expect(again.id).toBe(run.id);
    expect(again.createdAt).toBe(run.createdAt);
    expect(again.findings.improve.map((f: any) => f.subject)).toEqual(['Paragon 3']);
  });

  it('keeps the last ten runs and deletes the older ones, newest first', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push((await (await startRun()).json()).id);
    const kept = db.prepare('SELECT id FROM review_run ORDER BY id DESC').pluck().all();
    expect(kept).toEqual(ids.slice(2).reverse());
    expect((await latest()).id).toBe(ids[11]);
  });

  it('marks as new the findings the previous run did not have, and none in the first run', async () => {
    rankLooks('Paragon 3', 2);
    await startRun();
    expect((await latest()).findings.improve.map((f: any) => [f.subject, f.new])).toEqual([['Paragon 3', false]]);

    db.prepare('INSERT INTO hero (name) VALUES (?)').run('Anya');
    await startRun();
    expect((await latest()).findings.improve.map((f: any) => [f.subject, f.new])).toEqual([['Paragon 3', false], ['Anya', true]]);

    // a finding that was new once is not new in the run after it
    await startRun();
    expect((await latest()).findings.improve.map((f: any) => f.new)).toEqual([false, false]);
  });

  it('marks a finding as new again when its message changes, since it is not the same finding any more', async () => {
    rankLooks('Paragon 3', 2);
    await startRun();
    db.prepare("DELETE FROM rank_look WHERE id = (SELECT min(id) FROM rank_look WHERE rank = 'Paragon 3')").run(); // 2 looks become 1
    await startRun();
    expect((await latest()).findings.improve.map((f: any) => [f.subject, f.new])).toEqual([['Paragon 3', true]]);
  });
});

const send = (method: string, body: unknown) => app.request('/api/admin/review/dismissals', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const identity = (f: any) => ({ code: f.code, subject: f.subject, message: f.message });

describe('the dismissed findings', () => {
  it('hides a dismissed finding from its list and shows it apart, in this run and in the ones after', async () => {
    rankLooks('Paragon 3', 2);
    db.prepare('INSERT INTO hero (name) VALUES (?)').run('Anya');
    await startRun();
    const anya = (await latest()).findings.improve.find((f: any) => f.subject === 'Anya');

    const dismissed = await send('POST', identity(anya));
    expect(dismissed.status).toBe(201);
    const view = await latest();
    expect(view.findings.improve.map((f: any) => f.subject)).toEqual(['Paragon 3']);
    expect(view.dismissed.map(identity)).toEqual([identity(anya)]);

    await startRun();
    expect((await latest()).findings.improve.map((f: any) => f.subject)).toEqual(['Paragon 3']);
  });

  it('shows a finding again when the player takes the dismissal back', async () => {
    db.prepare('INSERT INTO hero (name) VALUES (?)').run('Anya');
    await startRun();
    const anya = identity((await latest()).findings.improve[0]);
    await send('POST', anya);
    expect((await latest()).findings.improve).toEqual([]);

    const back = await send('DELETE', anya);
    expect(back.status).toBe(200);
    const view = await latest();
    expect(view.findings.improve.map(identity)).toEqual([anya]);
    expect(view.dismissed).toEqual([]);
  });

  it('shows a dismissed finding again once its message has changed, and not the old one under Dismissed', async () => {
    rankLooks('Paragon 3', 2);
    await startRun();
    await send('POST', identity((await latest()).findings.improve[0]));
    expect((await latest()).findings.improve).toEqual([]);

    db.prepare("DELETE FROM rank_look WHERE id = (SELECT min(id) FROM rank_look WHERE rank = 'Paragon 3')").run(); // 2 looks become 1
    await startRun();
    const view = await latest();
    expect(view.findings.improve.map((f: any) => [f.subject, f.message.includes('has 1 Rank Look')])).toEqual([['Paragon 3', true]]);
    expect(view.dismissed).toEqual([]);
  });

  it('answers 400 to a dismissal that does not name a finding, changing nothing', async () => {
    db.prepare('INSERT INTO hero (name) VALUES (?)').run('Anya');
    await startRun();
    const bodies: unknown[] = [{}, { code: 'hero-no-example', subject: 'Anya' }, { code: 'hero-no-example', subject: 3, message: 'x' }, { code: 'a', subject: 'b', message: null }, null];
    for (const method of ['POST', 'DELETE']) {
      for (const body of bodies) expect((await send(method, body)).status).toBe(400);
      const notJson = await app.request('/api/admin/review/dismissals', { method, headers: { 'content-type': 'application/json' }, body: 'dismiss' });
      expect(notJson.status).toBe(400);
    }
    expect(db.prepare('SELECT count(*) FROM review_dismissal').pluck().get()).toBe(0);
    expect((await latest()).findings.improve.map((f: any) => f.subject)).toEqual(['Anya']);
  });
});
