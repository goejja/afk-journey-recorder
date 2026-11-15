import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { reviewRun } from '../../src/query/review-run.js';
import { createApp } from '../../src/server/app.js';

let db: Database.Database;
let app: Hono;

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp(db, { imagesDir: mkdtempSync(join(tmpdir(), 'afk-review-query-')) });
});

const post = (url: string, body: unknown = {}) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const startRun = async () => (await (await post('/api/admin/review/runs')).json()) as any;

describe('what the query CLI prints for a Review run', () => {
  it('says to start a review when there is none, and when the run asked for does not exist', async () => {
    expect(reviewRun(db)).toEqual({ run: null, note: expect.stringContaining('Admin > Review') });
    await startRun();
    expect(reviewRun(db, 999)).toEqual({ run: null, note: 'Unknown review run 999' });
  });

  it('prints the last run, or the one asked for, with the new findings marked and the dismissed ones left out but counted', async () => {
    for (let i = 0; i < 2; i++) db.prepare('INSERT INTO rank_look (rank, file) VALUES (?, ?)').run('Paragon 3', `p${i}.png`);
    const first = await startRun();
    db.prepare('INSERT INTO hero (name) VALUES (?)').run('Anya');
    db.prepare('INSERT INTO hero (name) VALUES (?)').run('Zed');
    const second = await startRun();
    const anya = second.findings.improve.find((f: any) => f.subject === 'Anya');
    await post('/api/admin/review/dismissals', { code: anya.code, subject: anya.subject, message: anya.message });

    const last = reviewRun(db);
    expect(last.run).toEqual({ id: second.id, createdAt: second.createdAt });
    expect(last.findings!.improve.map((f) => [f.subject, f.new])).toEqual([['Paragon 3', false], ['Zed', true]]);
    expect(last.dismissed).toBe(1);

    const earlier = reviewRun(db, first.id);
    expect(earlier.run).toEqual({ id: first.id, createdAt: first.createdAt });
    expect(earlier.findings!.improve.map((f) => f.subject)).toEqual(['Paragon 3']);
  });
});
