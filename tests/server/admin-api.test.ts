import type { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO hero (name) VALUES ('A')").run();
  app = createApp(db);
});

const attemptCount = () => db.prepare('SELECT count(*) FROM attempt').pluck().get() as number;
const addAttempt = (note: string) => db.prepare("INSERT INTO attempt (mode, outcome, note) VALUES ('Arena', 'Win', ?)").run(note);
const backup = async () => Buffer.from(await (await app.request('/api/admin/backup')).arrayBuffer());
const restore = (body: BodyInit | null, headers: Record<string, string> = { 'x-afk-action': 'restore' }) =>
  app.request('/api/admin/restore', { method: 'POST', headers: { 'content-type': 'application/octet-stream', ...headers }, body });

describe('database backup and restore', () => {
  it('downloads a SQLite file', async () => {
    const response = await app.request('/api/admin/backup');
    expect(response.headers.get('content-disposition')).toMatch(/attachment; filename="afk-backup-.*\.db"/);
    expect((await backup()).subarray(0, 15).toString('latin1')).toBe('SQLite format 3');
  });

  it('puts the data back as it was when the backup was made, and numbers new records after the restored ones', async () => {
    addAttempt('kept');
    const file = await backup();
    addAttempt('added after the backup');
    db.prepare('DELETE FROM hero').run();
    expect(attemptCount()).toBe(2);

    const response = await restore(new Uint8Array(file));
    expect(response.status).toBe(200);
    expect(attemptCount()).toBe(1);
    expect(db.prepare('SELECT name FROM hero').pluck().all()).toEqual(['A']);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    addAttempt('new');
    expect(db.prepare('SELECT max(id) FROM attempt').pluck().get()).toBe(2);
  });

  it('refuses anything that is not a backup of this database, changing nothing', async () => {
    addAttempt('kept');
    expect((await restore(new TextEncoder().encode('hello'))).status).toBe(400);
    const other = openDb(':memory:');
    other.exec('DROP TABLE roster');
    const response = await restore(new Uint8Array(other.serialize()));
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toMatch(/roster/);
    expect(attemptCount()).toBe(1);
  });

  it('empties the derived vectors of every kind of look and copies none, so they are made again from the pictures', async () => {
    db.prepare("INSERT INTO rank (name, position) VALUES ('Elite', 0)").run();
    db.prepare("INSERT INTO hero (name) VALUES ('Evie')").run();
    const vector = Buffer.from(new Float32Array([1]).buffer);
    const looks = {
      rank_look: Number(db.prepare("INSERT INTO rank_look (rank, file) VALUES ('Elite', 'a.png')").run().lastInsertRowid),
      hero_example: Number(db.prepare("INSERT INTO hero_example (hero_name, file) VALUES ('Evie', 'b.png')").run().lastInsertRowid),
      hero_look: Number(db.prepare("INSERT INTO hero_look (hero_name, file) VALUES ('Evie', 'c.png')").run().lastInsertRowid),
      unit_look: Number(db.prepare("INSERT INTO unit_look (kind, name, file) VALUES ('artifact', 'Bladestorm', 'd.png')").run().lastInsertRowid),
    };
    for (const [table, id] of Object.entries(looks)) db.prepare(`INSERT INTO ${table}_feature (look_id, version, size, mtime, vector) VALUES (?, 1, 10, 1.5, ?)`).run(id, vector);
    const file = await backup();
    expect((await restore(new Uint8Array(file))).status).toBe(200);
    for (const table of Object.keys(looks)) {
      expect(db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(1);
      expect(db.prepare(`SELECT count(*) FROM ${table}_feature`).pluck().get()).toBe(0);
    }
  });

  it('refuses a backup from a newer version of the app, changing nothing', async () => {
    addAttempt('kept');
    const newer = openDb(':memory:');
    newer.pragma('user_version = 999');
    const response = await restore(new Uint8Array(newer.serialize()));
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error).toMatch(/newer version/);
    expect(attemptCount()).toBe(1);
  });

  it('leaves the rows of a table the backup does not have, and puts foreign keys back on when the restore fails', async () => {
    addAttempt('kept');
    db.prepare("INSERT OR REPLACE INTO thinning_setting (kind, distance) VALUES ('rank', 0.07)").run();
    const without = openDb(':memory:');
    without.exec('DROP TABLE thinning_setting');
    const ok = await restore(new Uint8Array(without.serialize()));
    expect(ok.status).toBe(200);
    expect(db.prepare("SELECT distance FROM thinning_setting WHERE kind = 'rank'").pluck().get()).toBe(0.07);

    const broken = Buffer.from(await backup());
    broken.fill(0, 100, 200); // a damaged file is refused before anything is attached
    expect((await restore(new Uint8Array(broken))).status).toBe(400);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('refuses a body over the limit without reading it, by its declared length or by the bytes it sends', async () => {
    addAttempt('kept');
    const declared = await restore(new Uint8Array(8), { 'x-afk-action': 'restore', 'content-length': String(600 * 1024 * 1024) });
    expect(declared.status).toBe(413);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 64 * 1024 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024 * 1024));
        if (sent > 1024 * 1024 * 1024) controller.close();
      },
    });
    const streamed = await app.request('/api/admin/restore', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-afk-action': 'restore' }, body: stream, duplex: 'half' } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(sent).toBeLessThan(1024 * 1024 * 1024);
    expect(attemptCount()).toBe(1);
  });

  it('says that the pictures are not in the backup', async () => {
    const response = await restore(new Uint8Array(await backup()));
    expect(((await response.json()) as any).note).toMatch(/not in a backup/);
  });

  it('is only accepted from the Admin page', async () => {
    const file = await backup();
    expect((await restore(new Uint8Array(file), { 'content-type': 'text/plain' })).status).toBe(400);
  });
});

describe('tag management', () => {
  const tag = (id: number, name: string) => db.prepare('INSERT INTO attempt_tag (attempt_id, tag) VALUES (?, ?)').run(id, name);
  const tagsOf = (id: number) => db.prepare('SELECT tag FROM attempt_tag WHERE attempt_id = ? ORDER BY tag').pluck().all(id);
  const send = (method: string, url: string, body?: unknown) =>
    app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  beforeEach(() => {
    addAttempt('one');
    addAttempt('two');
    tag(1, 'Luna');
    tag(2, 'Luna');
    tag(2, 'Max');
  });

  it('renames a tag on every record, merging into an existing tag', async () => {
    const renamed = await send('PUT', '/api/tags/Luna', { name: 'Moon' });
    expect(await renamed.json()).toEqual({ name: 'Moon', records: 2 });
    expect(tagsOf(1)).toEqual(['Moon']);
    expect(tagsOf(2)).toEqual(['Max', 'Moon']);
    await send('PUT', '/api/tags/Max', { name: 'Moon' });
    expect(tagsOf(2)).toEqual(['Moon']);
  });

  it('refuses an empty name and an unknown tag', async () => {
    expect((await send('PUT', '/api/tags/Luna', { name: '  ' })).status).toBe(400);
    expect((await send('PUT', '/api/tags/Nobody', { name: 'X' })).status).toBe(404);
    expect((await send('DELETE', '/api/tags/Nobody')).status).toBe(404);
  });

  it('removes a tag from every record without deleting the records', async () => {
    expect(await (await send('DELETE', '/api/tags/Luna')).json()).toEqual({ removed: 2 });
    expect(tagsOf(1)).toEqual([]);
    expect(attemptCount()).toBe(2);
  });
});
