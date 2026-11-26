import { describe, expect, it } from 'vitest';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { importFixture, reportPicture } from '../support/roster-import.js';

const t = importFixture();
const { upload, json } = t;

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const jobs = () => json(t.app.request('/api/jobs'));
const send = (url: string, body?: unknown) =>
  t.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-afk-action': url.endsWith('/run') ? 'run' : 'review' }, body: JSON.stringify(body ?? {}) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** What the fake agent prints, settled from the test. */
function agentWaits() {
  let finish!: { resolve: (text: string) => void; reject: (error: Error) => void };
  t.reply = () => new Promise<string>((resolve, reject) => (finish = { resolve, reject }));
  return { resolve: (text: string) => finish.resolve(text), reject: (message: string) => finish.reject(new Error(message)) };
}
const newScenario = async () => {
  t.db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Duel', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  return (await json(t.app.request('/api/scenarios', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Rival', mode: 'Arena', slots: [{ mapName: 'Duel', mine: [], enemy: [{ tile: 0, hero: 'Evie' }] }] }) }))).id as number;
};
const newReviewRun = async () => {
  t.db.prepare('INSERT INTO rank_look (rank, file) VALUES (?, ?)').run('Paragon 3', 'p.png');
  return (await json(t.app.request('/api/admin/review/runs', { method: 'POST', headers: { 'content-type': 'application/json', 'x-afk-action': 'review' }, body: '{}' }))).id as number;
};

describe('GET /api/jobs', () => {
  it('says that nothing runs when nothing has been started', async () => {
    expect(await jobs()).toEqual({
      scenarios: {},
      review: null,
      roster: { active: 0, failed: 0, done: 0, signature: '' },
      battle: { active: 0, failed: 0, done: 0, signature: '' },
      sync: { running: false, lastRunId: 0, failed: false },
    });
  });

  it('lists the scenarios that have a job, with how each went', async () => {
    const id = await newScenario();
    const agent = agentWaits();
    await send(`/api/scenarios/${id}/run`);
    expect((await jobs()).scenarios).toEqual({ [id]: { state: 'running' } });
    agent.reject('The agent crashed');
    await settle();
    expect((await jobs()).scenarios).toEqual({ [id]: { state: 'failed', error: 'The agent crashed' } });
  });

  it('has the Review explanation while it runs and when it is done', async () => {
    const runId = await newReviewRun();
    const agent = agentWaits();
    await send(`/api/admin/review/runs/${runId}/explain`);
    expect((await jobs()).review).toEqual({ runId, state: 'running' });
    agent.resolve('Those looks are alike.');
    await settle();
    expect((await jobs()).review).toEqual({ runId, state: 'done' });
  });

  it('counts the pictures of a Roster import and of a Battle import apart, and changes the signature as a picture goes on', async () => {
    const agent = agentWaits();
    await upload('report', await reportPicture(), '&mode=Guild%20Duel&name=one.png');
    const reading = await jobs();
    expect(reading.battle).toMatchObject({ active: 1, failed: 0, done: 0 });
    expect(reading.roster).toEqual({ active: 0, failed: 0, done: 0, signature: '' });
    await t.until(() => t.calls.length > 0);
    // a failed reading may be tried again, so every try fails
    t.reply = () => Promise.reject(new Error('no reading'));
    agent.reject('no reading');
    for (let i = 0; i < 300 && (await jobs()).battle.active > 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const failed = await jobs();
    expect(failed.battle).toMatchObject({ active: 0, failed: 1, done: 0 });
    expect(failed.battle.signature).not.toBe(reading.battle.signature);
    expect(failed.battle.signature).toMatch(/^\d+:failed$/);
  });
});

describe('GET /api/jobs/stream', () => {
  /** Reads the stream's events as they come; `close` ends the connection. */
  async function open() {
    const response = await t.app.request('/api/jobs/stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    return {
      response,
      /** The next summary pushed, whatever comments (heartbeats) come before it. */
      async next() {
        for (;;) {
          const event = pending.indexOf('\n\n');
          if (event >= 0) {
            const text = pending.slice(0, event);
            pending = pending.slice(event + 2);
            const data = text.split('\n').find((line) => line.startsWith('data:'));
            if (data) return JSON.parse(data.slice(5)) as Awaited<ReturnType<typeof jobs>>;
            continue;
          }
          const { done, value } = await reader.read();
          if (done) throw new Error('the stream ended');
          pending += decoder.decode(value);
        }
      },
      close: () => reader.cancel(),
    };
  }

  it('starts with where the jobs stand, as an event stream', async () => {
    const stream = await open();
    expect(stream.response.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(await stream.next()).toEqual(await jobs());
    await stream.close();
  });

  it('pushes the new summary when work starts and when it ends, with nobody asking', async () => {
    const id = await newScenario();
    const stream = await open();
    expect((await stream.next()).scenarios).toEqual({});
    const agent = agentWaits();
    await send(`/api/scenarios/${id}/run`);
    expect((await stream.next()).scenarios).toEqual({ [id]: { state: 'running' } });
    agent.resolve('{}');
    expect((await stream.next()).scenarios[id]?.state).toMatch(/done|failed/);
    await stream.close();
  });
});
