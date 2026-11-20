import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';
import type { AgentRunner } from '../../src/server/agent/scenario-run.js';

let db: Database.Database;
let app: Hono;
let calls: Parameters<AgentRunner>[];
/** What the fake agent does when run: settle it from the test. */
let finish: { resolve: (text: string) => void; reject: (error: Error) => void };

const fakeRunner: AgentRunner = (command, options) => {
  calls.push([command, options]);
  return new Promise<string>((resolve, reject) => {
    finish = { resolve, reject };
    options.signal.addEventListener('abort', () => reject(new Error('Cancelled')));
  });
};

beforeEach(() => {
  calls = [];
  db = openDb(':memory:');
  app = createApp(db, { agentRunner: fakeRunner, imagesDir: mkdtempSync(join(tmpdir(), 'afk-explain-')) });
});

const post = (url: string) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
/** The Review explanation, as the job list tells it. */
const reviewJob = async () => (await json(app.request('/api/jobs'))).review;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const newRun = async () => {
  db.prepare('INSERT INTO rank_look (rank, file) VALUES (?, ?)').run('Paragon 3', `p-${Math.random()}.png`);
  return (await json(post('/api/admin/review/runs'))).id as number;
};

describe('asking the Agent to explain a Review run', () => {
  it('runs the Agent in the background and keeps its reply on the run, with the date', async () => {
    const run = await newRun();
    expect(await reviewJob()).toBeNull();
    const started = await post(`/api/admin/review/runs/${run}/explain`);
    expect(started.status).toBe(202);
    expect(await reviewJob()).toEqual({ runId: run, state: 'running' });
    expect((await json(app.request('/api/admin/review/runs/latest'))).explanation).toBeNull();

    finish.resolve('1. Paragon 3 has too few looks: learn it from a roster import.');
    await settle();
    expect(await reviewJob()).toEqual({ runId: run, state: 'done' });
    const explanation = (await json(app.request('/api/admin/review/runs/latest'))).explanation;
    expect(explanation.text).toBe('1. Paragon 3 has too few looks: learn it from a roster import.');
    expect(explanation.at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('answers a run explained before its date was kept, with a null date', async () => {
    const run = await newRun();
    db.prepare("UPDATE review_run SET explanation = 'An older explanation.', explained_at = NULL WHERE id = ?").run(run);
    expect((await json(app.request('/api/admin/review/runs/latest'))).explanation).toEqual({ text: 'An older explanation.', at: null });
  });

  it('fails with the reason and keeps nothing when the Agent returns an empty reply', async () => {
    const run = await newRun();
    await post(`/api/admin/review/runs/${run}/explain`);
    finish.resolve('  \n ');
    await settle();
    expect(await reviewJob()).toEqual({ runId: run, state: 'failed', error: 'The agent returned an empty reply' });
    expect((await json(app.request('/api/admin/review/runs/latest'))).explanation).toBeNull();
  });

  it('fails with the reason and keeps nothing when the Agent cannot run, and can be asked again after', async () => {
    const run = await newRun();
    await post(`/api/admin/review/runs/${run}/explain`);
    finish.reject(new Error('claude: command not found'));
    await settle();
    expect(await reviewJob()).toEqual({ runId: run, state: 'failed', error: 'claude: command not found' });
    expect((await json(app.request('/api/admin/review/runs/latest'))).explanation).toBeNull();

    expect((await post(`/api/admin/review/runs/${run}/explain`)).status).toBe(202); // the Agent is free again
  });

  it('refuses an unknown run, and a second request while the Agent is busy, without starting anything', async () => {
    expect((await post('/api/admin/review/runs/999/explain')).status).toBe(404);
    expect(calls).toHaveLength(0);

    const run = await newRun();
    expect((await post(`/api/admin/review/runs/${run}/explain`)).status).toBe(202);
    const busy = await post(`/api/admin/review/runs/${run}/explain`);
    expect(busy.status).toBe(409);
    expect((await busy.json()).error).toContain('already running');
    expect(calls).toHaveLength(1);
  });
});
