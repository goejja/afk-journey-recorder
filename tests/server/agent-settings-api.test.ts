import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';
import type { AgentProbe } from '../../src/server/agent/agent-probe.js';
import type { AgentRunner } from '../../src/server/agent/scenario-run.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

let db: Database.Database;
let app: Hono;
let calls: Parameters<AgentRunner>[];

const fakeRunner: AgentRunner = (command, options) => {
  calls.push([command, options]);
  return new Promise<string>(() => {});
};

beforeEach(() => {
  calls = [];
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Duel', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  db.prepare('INSERT INTO hero (name) VALUES (?)').run('X');
  app = createApp(db, { agentRunner: fakeRunner });
});

/** The routes that start or look for programs need the header a page on another site cannot send. */
const actionOf = (url: string) => (url.endsWith('/run') ? 'run' : url.endsWith('/refresh') ? 'refresh' : null);
const send = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const action = method === 'POST' ? actionOf(url) : null;
  return app.request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(action ? { 'x-afk-action': action } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const newScenario = async () =>
  (await json(send('POST', '/api/scenarios', { name: 'Rival', mode: 'Arena', slots: [{ mapName: 'Duel', mine: [], enemy: [{ tile: 0, hero: 'X' }] }] }))).id as number;

describe('agent settings', () => {
  it('start as claude with opus and a 10 minute limit, and list the presets to choose from', async () => {
    expect(await json(send('GET', '/api/admin/agent'))).toEqual({ preset: 'claude', model: 'opus', timeoutMinutes: 10, presets: ['claude', 'opencode'], tools: {} });
  });

  it.each([
    ['an unknown preset', { preset: 'rm', model: 'opus', timeoutMinutes: 10 }],
    ['a model that could read as a flag', { preset: 'claude', model: '--dangerously-skip-permissions', timeoutMinutes: 10 }],
    ['a model with a shell command in it', { preset: 'claude', model: 'opus; rm -rf /', timeoutMinutes: 10 }],
    ['a time limit of zero', { preset: 'claude', model: 'opus', timeoutMinutes: 0 }],
    ['a time limit over two hours', { preset: 'claude', model: 'opus', timeoutMinutes: 121 }],
    ['a time limit that is not a whole number', { preset: 'claude', model: 'opus', timeoutMinutes: 2.5 }],
    ['a time limit given as text', { preset: 'claude', model: 'opus', timeoutMinutes: '10' }],
    ['no settings at all', null],
  ])('refuse %s and keep what was saved', async (_, body) => {
    await send('PUT', '/api/admin/agent', { preset: 'claude', model: 'haiku', timeoutMinutes: 5 });
    const response = await send('PUT', '/api/admin/agent', body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual(expect.any(String));
    expect(await json(send('GET', '/api/admin/agent'))).toMatchObject({ model: 'haiku', timeoutMinutes: 5 });
  });

  it('are what a run uses: the saved model and time limit', async () => {
    const id = await newScenario();
    await send('PUT', '/api/admin/agent', { preset: 'claude', model: 'haiku', timeoutMinutes: 3 });

    expect((await send('POST', `/api/scenarios/${id}/run`)).status).toBe(202);

    const [command, options] = calls[0]!;
    expect(command.args[command.args.indexOf('--model') + 1]).toBe('haiku');
    expect(options.timeoutMs).toBe(3 * 60 * 1000);
  });

  it.each([
    ['a preset that is not in the list', "'/bin/sh', 'opus', 10"],
    ['a model that reads as a flag', "'claude', '--dangerously-skip-permissions', 10"],
    ['a model with a shell command in it', "'claude', 'opus; touch /tmp/pwned', 10"],
    ['an absurd time limit', "'claude', 'opus', 100000"],
  ])('are checked again before a run, so a restored backup carrying %s runs nothing', async (_, values) => {
    const crafted = openDb(':memory:');
    crafted.prepare(`INSERT INTO agent_setting (id, preset, model, timeout_minutes) VALUES (1, ${values})`).run();
    const bytes = new Uint8Array(crafted.serialize());

    const restored = await app.request('/api/admin/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-afk-action': 'restore' },
      body: bytes,
    });
    expect(restored.status).toBe(200);

    // The restore replaced the data, so the scenario has to be made again.
    db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Duel', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
    db.prepare("INSERT OR IGNORE INTO hero (name) VALUES ('X')").run();
    const again = await newScenario();
    const response = await send('POST', `/api/scenarios/${again}/run`);

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('keep a saved choice of model and time limit', async () => {
    const saved = await send('PUT', '/api/admin/agent', { preset: 'claude', model: 'claude-sonnet-5-5', timeoutMinutes: 25 });
    expect(saved.status).toBe(200);
    const expected = { preset: 'claude', model: 'claude-sonnet-5-5', timeoutMinutes: 25, presets: ['claude', 'opencode'], tools: {} };
    expect(await saved.json()).toEqual(expected);
    expect(await json(send('GET', '/api/admin/agent'))).toEqual(expected);

    await send('PUT', '/api/admin/agent', { preset: 'claude', model: 'haiku', timeoutMinutes: 5 });
    expect(await json(send('GET', '/api/admin/agent'))).toMatchObject({ model: 'haiku', timeoutMinutes: 5 });
  });
});

describe('finding the agents on this computer', () => {
  /** What the computer has: claude at a path, opencode only when `installed` says so. */
  function probeFor(options: { opencode?: boolean; modelsOutput?: string | Error } = {}): AgentProbe & { runs: string[][] } {
    const runs: string[][] = [];
    return {
      runs,
      find: async (binary) => (binary === 'claude' ? '/opt/bin/claude' : binary === 'opencode' && options.opencode ? '/opt/bin/opencode' : null),
      run: async (path, args) => {
        runs.push([path, ...args]);
        if (args[0] === '--version') return path.endsWith('claude') ? '2.1.308 (Claude Code)\n' : 'v2.2.2\n';
        const output = options.modelsOutput ?? '';
        if (output instanceof Error) throw output;
        return output;
      },
    };
  }
  const withProbe = (probe: AgentProbe) => (app = createApp(db, { agentRunner: fakeRunner, agentProbe: probe }));

  it('looks nothing up until asked, then reports each tool with its path, version and models', async () => {
    const probe = probeFor({ opencode: true, modelsOutput: 'ollama-cloud/gemma4:31b\nopencode-go/glm-5.2\n' });
    withProbe(probe);
    expect((await json(send('GET', '/api/admin/agent'))).tools).toEqual({});
    expect(probe.runs).toEqual([]);

    const refreshed = await json(send('POST', '/api/admin/agent/refresh'));
    expect(refreshed.tools.claude).toMatchObject({ installed: true, path: '/opt/bin/claude', version: '2.1.308 (Claude Code)' });
    expect(refreshed.tools.claude.models).toEqual(expect.arrayContaining(['opus', 'sonnet', 'haiku']));
    expect(refreshed.tools.opencode).toMatchObject({
      installed: true,
      path: '/opt/bin/opencode',
      version: 'v2.2.2',
      models: ['ollama-cloud/gemma4:31b', 'opencode-go/glm-5.2'],
    });
    // what was found is kept, so the next visit does not have to run anything
    expect(await json(send('GET', '/api/admin/agent'))).toMatchObject({ tools: { opencode: { path: '/opt/bin/opencode' } } });
  });

  it('does not run any program when the request does not come from this app', async () => {
    const probe = probeFor({ opencode: true, modelsOutput: 'a/b\n' });
    withProbe(probe);
    expect((await app.request('/api/admin/agent/refresh', { method: 'POST', headers: { 'content-type': 'text/plain' } })).status).toBe(400);
    expect(probe.runs).toEqual([]);
    expect((await json(send('GET', '/api/admin/agent'))).tools).toEqual({});
  });

  it('says so when a tool is not installed, without trying to run it', async () => {
    const probe = probeFor({ opencode: false });
    withProbe(probe);
    const { tools } = await json(send('POST', '/api/admin/agent/refresh'));
    expect(tools.opencode).toEqual({ installed: false, path: null, version: null, models: null });
    expect(probe.runs.some((run) => run[0]!.includes('opencode'))).toBe(false);
  });

  it('keeps going when one tool cannot list its models, and says why', async () => {
    withProbe(probeFor({ opencode: true, modelsOutput: new Error('opencode: not logged in') }));
    const { tools } = await json(send('POST', '/api/admin/agent/refresh'));
    expect(tools.opencode).toMatchObject({ installed: true, models: null, modelsError: 'opencode: not logged in' });
    expect(tools.claude.models).toEqual(expect.arrayContaining(['opus']));
  });

  it('asks the tools only for their version and model list, never anything a request could change', async () => {
    const probe = probeFor({ opencode: true, modelsOutput: 'a/b\n' });
    withProbe(probe);
    await app.request('/api/admin/agent/refresh?binary=rm&args=-rf', { method: 'POST', headers: { 'x-afk-action': 'refresh' }, body: JSON.stringify({ binary: 'rm' }) });
    expect(probe.runs).toEqual([
      ['/opt/bin/claude', '--version'],
      ['/opt/bin/opencode', '--version'],
      ['/opt/bin/opencode', 'models'],
    ]);
  });
});
