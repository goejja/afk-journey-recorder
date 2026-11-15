import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { saveEstimate } from '../../src/db/scenario-estimate.js';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';
import type { AgentRunner } from '../../src/server/agent/scenario-run.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

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
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Duel', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  db.prepare('INSERT INTO hero (name) VALUES (?)').run('X');
  app = createApp(db, { agentRunner: fakeRunner });
});

/** The routes that start, stop or look for programs need the header a page on another site cannot send. */
const actionOf = (url: string) => (url.endsWith('/run/cancel') ? 'cancel' : url.endsWith('/run') ? 'run' : url.endsWith('/refresh') ? 'refresh' : null);
const send = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const action = method === 'POST' ? actionOf(url) : null;
  return app.request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(action ? { 'x-afk-action': action } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const newScenario = async () =>
  (await json(send('POST', '/api/scenarios', { name: 'Rival', mode: 'Arena', slots: [{ mapName: 'Duel', mine: [], enemy: [{ tile: 0, hero: 'X' }] }] }))).id as number;

describe('running the agent on a scenario', () => {
  it('lists only the scenarios that have a job, in one response', async () => {
    const a = await newScenario();
    await newScenario();
    expect(await json(send('GET', '/api/scenarios/runs'))).toEqual({});
    await send('POST', `/api/scenarios/${a}/run`);
    expect(await json(send('GET', '/api/scenarios/runs'))).toEqual({ [a]: { state: 'running' } });
  });

  it('only starts or cancels a run when asked from this app, not by a request that any web page could send', async () => {
    const id = await newScenario();
    const blind = (url: string) => app.request(url, { method: 'POST', headers: { 'content-type': 'text/plain' } });

    expect((await blind(`/api/scenarios/${id}/run`)).status).toBe(400);
    expect(calls).toHaveLength(0);

    await send('POST', `/api/scenarios/${id}/run`);
    expect((await blind(`/api/scenarios/${id}/run/cancel`)).status).toBe(400);
    expect((await json(send('GET', '/api/scenarios/runs')))[id]).toMatchObject({ state: 'running' });
  });

  it('starts the agent in the background and saves its reply as the estimate when it finishes', async () => {
    const id = await newScenario();

    const started = await send('POST', `/api/scenarios/${id}/run`);
    expect(started.status).toBe(202);
    expect((await json(send('GET', '/api/scenarios/runs')))[id]).toMatchObject({ state: 'running' });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].command).toBe('claude');

    finish.resolve('  Put A in front.  ');
    await settle();

    expect((await json(send('GET', '/api/scenarios/runs')))[id]).toMatchObject({ state: 'done' });
    const saved = await json(send('GET', '/api/scenarios'));
    expect(saved[0]).toMatchObject({ estimate: 'Put A in front.' });
    expect(saved[0].estimateAt).not.toBeNull();
  });

  it('refuses a second run while one is going, even on another scenario, and allows it once that has finished', async () => {
    const first = await newScenario();
    const second = await newScenario();

    expect((await send('POST', `/api/scenarios/${first}/run`)).status).toBe(202);
    expect((await send('POST', `/api/scenarios/${first}/run`)).status).toBe(409);
    expect((await send('POST', `/api/scenarios/${second}/run`)).status).toBe(409);
    expect(calls).toHaveLength(1);

    finish.resolve('Done');
    await settle();
    expect((await send('POST', `/api/scenarios/${second}/run`)).status).toBe(202);
  });

  it('cancels a running agent, keeps the previous estimate and frees the slot', async () => {
    const id = await newScenario();
    saveEstimate(db, id, 'Old answer');
    await send('POST', `/api/scenarios/${id}/run`);

    expect((await send('POST', `/api/scenarios/${id}/run/cancel`)).status).toBe(200);
    await settle();

    expect((await json(send('GET', '/api/scenarios/runs')))[id]).toEqual({ state: 'failed', error: 'Cancelled' });
    expect((await json(send('GET', '/api/scenarios')))[0].estimate).toBe('Old answer');
    expect((await send('POST', `/api/scenarios/${id}/run`)).status).toBe(202);
  });

  it('has nothing to cancel when no run is going', async () => {
    const id = await newScenario();
    expect((await send('POST', `/api/scenarios/${id}/run/cancel`)).status).toBe(409);
  });

  it('knows no run for a scenario that does not exist', async () => {
    expect((await send('POST', '/api/scenarios/999/run')).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('treats an empty reply as a failure and keeps the previous estimate', async () => {
    const id = await newScenario();
    saveEstimate(db, id, 'Old answer');

    await send('POST', `/api/scenarios/${id}/run`);
    finish.resolve('  \n ');
    await settle();

    expect((await json(send('GET', '/api/scenarios/runs')))[id]).toMatchObject({ state: 'failed', error: expect.stringMatching(/empty/i) });
    expect((await json(send('GET', '/api/scenarios')))[0].estimate).toBe('Old answer');
  });

  it('saves only the answer out of what opencode printed, and starts it with its read-only permissions', async () => {
    const id = await newScenario();
    await send('PUT', '/api/admin/agent', { preset: 'opencode', model: 'ollama-cloud/gemma4:31b', timeoutMinutes: 10 });

    await send('POST', `/api/scenarios/${id}/run`);
    expect(calls[0]![0].command).toBe('opencode');
    expect(JSON.parse(calls[0]![0].env!['OPENCODE_CONFIG_CONTENT']!).permission.edit).toBe('deny');

    finish.resolve(
      ['{"type":"tool_use","part":{"messageID":"m1","type":"tool"}}', '{"type":"text","part":{"messageID":"m2","type":"text","text":"Put B in front."}}'].join('\n'),
    );
    await settle();

    expect((await json(send('GET', '/api/scenarios/runs')))[id]).toMatchObject({ state: 'done' });
    expect((await json(send('GET', '/api/scenarios')))[0].estimate).toBe('Put B in front.');
  });

  it('reports a failed run with its reason and keeps the previous estimate', async () => {
    const id = await newScenario();
    saveEstimate(db, id, 'Old answer');

    await send('POST', `/api/scenarios/${id}/run`);
    finish.reject(new Error('claude: not logged in'));
    await settle();

    expect((await json(send('GET', '/api/scenarios/runs')))[id]).toEqual({ state: 'failed', error: 'claude: not logged in' });
    expect((await json(send('GET', '/api/scenarios')))[0].estimate).toBe('Old answer');
  });
});
