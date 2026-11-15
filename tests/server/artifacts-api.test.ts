import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { artifactGroupProblem } from '../../src/domain/artifact.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO artifact (name, grp, source) VALUES ('Bladestorm', 'Season 8', 'import'), ('Awakening', 'Pre-Season', 'import')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const list = async () => (await (await send('GET', '/api/artifacts')).json()) as any[];

/** A stage record that uses the artifact. */
function record(artifact: string) {
  const attempt = db.prepare("INSERT INTO attempt (mode, outcome) VALUES ('Dream Hunt', 'Win')").run().lastInsertRowid;
  db.prepare('INSERT INTO formation (attempt_id, artifact) VALUES (?, ?)').run(attempt, artifact);
}

describe('the group of an artifact', () => {
  it('is Pre-Season or one season', () => {
    expect(artifactGroupProblem('Pre-Season')).toBeNull();
    expect(artifactGroupProblem('Season 8')).toBeNull();
    for (const bad of ['Season 0', 'Season', 'season 8', 'Season 8 ', 'Seasonal', '', 3, null]) expect(artifactGroupProblem(bad)).not.toBeNull();
  });
});

describe('artifacts API', () => {
  it('lists artifacts with where they come from', async () => {
    expect(await list()).toEqual([
      { name: 'Bladestorm', group: 'Season 8', source: 'import', uses: 0 },
      { name: 'Awakening', group: 'Pre-Season', source: 'import', uses: 0 },
    ]);
  });

  it('adds an artifact by hand', async () => {
    const res = await send('POST', '/api/artifacts', { name: ' Moonveil ', group: 'Season 9' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ name: 'Moonveil', group: 'Season 9', source: 'manual', uses: 0 });
    expect((await send('POST', '/api/artifacts', { name: 'Moonveil', group: 'Pre-Season' })).status).toBe(409);
    expect((await send('POST', '/api/artifacts', { name: '', group: 'Pre-Season' })).status).toBe(400);
    expect((await send('POST', '/api/artifacts', { name: 'X', group: 'Season 0' })).status).toBe(400);
  });

  it('moves an artifact between Pre-Season and a season, and keeps it from being re-imported over', async () => {
    const res = await send('PUT', '/api/artifacts/Awakening', { name: 'Awakening', group: 'Season 7' });
    expect(await res.json()).toMatchObject({ group: 'Season 7', source: 'manual' });
    const back = await send('PUT', '/api/artifacts/Awakening', { name: 'Awakening', group: 'Pre-Season' });
    expect(await back.json()).toMatchObject({ group: 'Pre-Season' });
  });

  it('leaves an untouched artifact as imported', async () => {
    await send('PUT', '/api/artifacts/Bladestorm', { name: 'Bladestorm', group: 'Season 8' });
    expect((await list()).find((a) => a.name === 'Bladestorm').source).toBe('import');
  });

  it('renames an artifact, and the records and codes that use it follow', async () => {
    record('Bladestorm');
    db.prepare("INSERT INTO formation_id (code, deployment) VALUES ('A1B2C3D4', ?)").run(JSON.stringify({ teams: [{ units: [], phantimal: null, artifact: 'Bladestorm' }, null] }));
    const res = await send('PUT', '/api/artifacts/Bladestorm', { name: 'Bladestorm II', group: 'Season 8' });
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT artifact FROM formation').pluck().all()).toEqual(['Bladestorm II']);
    expect(JSON.parse(db.prepare('SELECT deployment FROM formation_id').pluck().get() as string).teams[0].artifact).toBe('Bladestorm II');
    expect((await send('PUT', '/api/artifacts/Awakening', { name: 'Bladestorm II', group: 'Pre-Season' })).status).toBe(409);
    expect((await send('PUT', '/api/artifacts/Nope', { name: 'Nope', group: 'Pre-Season' })).status).toBe(404);
  });

  it('deletes an artifact no record uses, and refuses one that is used', async () => {
    record('Bladestorm');
    const used = await send('DELETE', '/api/artifacts/Bladestorm');
    expect(used.status).toBe(409);
    expect(((await used.json()) as any).error).toBe('1 record uses Bladestorm');
    expect((await send('DELETE', '/api/artifacts/Awakening')).status).toBe(204);
    expect((await send('DELETE', '/api/artifacts/Awakening')).status).toBe(404);
    expect((await list()).map((a) => a.name)).toEqual(['Bladestorm']);
  });
});
