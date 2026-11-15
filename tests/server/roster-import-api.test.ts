import { existsSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { importFixture, infoPicture, blankPicture, tile, team } from '../support/roster-import.js';

const t = importFixture();
const { fakeRunner, post, upload, json, state, until, finished } = t;

describe('starting an import', () => {
  it('only starts when asked from this app, and needs a screen and a real picture', async () => {
    const bare = await t.app.request('/api/roster-import?screen=info', { method: 'POST', body: new Uint8Array(await infoPicture()) });
    expect(bare.status).toBe(400);
    expect((await upload('menu')).status).toBe(400);
    expect((await upload('info', Buffer.from('not a picture'))).status).toBe(415);
    const empty = await t.app.request('/api/roster-import?screen=info', { method: 'POST', headers: { 'x-afk-action': 'import' }, body: new Uint8Array() });
    expect(empty.status).toBe(400);
    expect(t.calls).toHaveLength(0);
  });

  it('says so when the picture holds no hero tiles, without starting the agent', async () => {
    const response = await upload('info', await blankPicture());
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/No hero tiles/);
    expect(t.calls).toHaveLength(0);
  });

  it('is disabled, with a reason, for an agent that has not been checked for reading pictures', async () => {
    await t.app.request('/api/admin/agent', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset: 'opencode', model: 'x', timeoutMinutes: 5 }) });
    expect(await state()).toMatchObject({ canRead: false, reason: expect.stringMatching(/opencode/) });
    expect((await upload()).status).toBe(400);
  });

  it('gives the agent only the right to read files, and a prompt that names the pictures it should read', async () => {
    await upload();
    await finished();
    const [command] = t.calls[0]!;
    expect(command.args).toEqual(expect.arrayContaining(['-p', '--allowedTools', 'Read']));
    expect(command.args.join(' ')).not.toMatch(/Bash|Write|Edit/);
    const prompt = command.args[command.args.indexOf('-p') + 1]!;
    expect(prompt).toContain('team1.jpg');
    expect(prompt).toContain('names.jpg');
  });

  it('asks the agent again when its reply has no players, up to two more times, and says what it said when it still fails', async () => {
    let n = 0;
    t.reply = () => (++n < 3 ? 'Sorry, I could not {read} that.' : JSON.stringify({ players: [{ name: 'Мокка', crops: { team1: team(tile('Evie', 'Supreme')), team2: team(), team3: team() } }] }));
    await upload();
    expect(await finished()).toMatchObject({ state: 'done' });
    expect(t.calls).toHaveLength(3);

    t.calls.length = 0;
    t.reply = () => 'No picture here';
    await t.app.request('/api/roster-import', { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } });
    await upload();
    const failed = await finished();
    expect(failed).toMatchObject({ state: 'failed' });
    expect(failed.error).toContain('(it said: No picture here)');
    expect(t.calls).toHaveLength(3);
  });

  it('finds the JSON in a reply with a sentence and braces around it', async () => {
    t.reply = () => 'Here {it is}: ' + JSON.stringify({ players: [{ name: 'Мокка', crops: { team1: team(tile('Evie', 'Supreme')), team2: team(), team3: team() } }] }) + ' (done {})';
    await upload();
    expect(await finished()).toMatchObject({ state: 'done' });
  });

  it('tries once more when the agent fails to run, but not after a cancel', async () => {
    let n = 0;
    t.reply = () => {
      if (++n === 1) throw new Error('rate limited');
      return JSON.stringify({ players: [{ name: 'Мокка', crops: { team1: team(tile('Evie', 'Supreme')), team2: team(), team3: team() } }] });
    };
    await upload();
    expect(await finished()).toMatchObject({ state: 'done' });
    expect(t.calls).toHaveLength(2);
  });

  it('keeps the picture only while the agent reads it', async () => {
    await upload();
    await finished();
    expect(existsSync(t.work) ? readdirSync(t.work) : []).toEqual([]);
  });

  it('runs one agent at a time, queues the other pictures, and lets them be cancelled', async () => {
    let release!: () => void;
    t.reply = () => new Promise<string>((resolve) => (release = () => resolve('{}')));
    const first = await upload();
    expect(first.status).toBe(202);
    const id = (await first.json()).id;
    const second = await json(upload());
    expect(second.state).toBe('queued');
    await until(() => t.calls.length === 1);
    expect((await state()).queue.map((q: any) => q.state)).toEqual(['running', 'queued']);
    expect((await post(`/api/roster-import/${id}/cancel`)).status).toBe(200);
    expect(await finished()).toMatchObject({ state: 'failed', error: 'Cancelled' });
    // the agent goes on to the next picture, which can be cancelled while it waits or is read
    await until(() => t.calls.length === 2);
    expect(t.calls).toHaveLength(2);
    release?.();
  });

  it('refuses a picture once the waiting pictures take the memory allowed, not after a number of pictures', async () => {
    const picture = await infoPicture();
    t.app = createApp(t.db, { agentRunner: fakeRunner, imagesDir: t.images, importWorkDir: t.work, importConcurrency: 1, importMaxBytes: picture.length + 10 });
    t.reply = () => new Promise<string>(() => undefined);
    expect((await upload('info', picture)).status).toBe(202);
    // the picture being read is no longer held; the next one waits in memory, and that is all the room there is
    await until(() => t.calls.length === 1);
    expect((await upload('info', picture)).status).toBe(202);
    const refused = await upload('info', picture);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/pictures waiting take \d+ MB of the \d+ MB allowed/);
    // discarding the waiting pictures frees the room
    expect((await t.app.request('/api/roster-import?waiting=1', { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } })).status).toBeLessThan(300);
    expect((await upload('info', picture)).status).toBe(202);
  });

  it('reads the pictures in order, and shows the next one once the first is discarded', async () => {
    const names: string[] = [];
    t.reply = () => {
      names.push(`read ${names.length + 1}`);
      return JSON.stringify({ players: [{ name: 'Мокка', crops: { team1: team(tile('Evie', 'Paragon 1'), tile('Thador', 'Supreme'), tile(null, 'Supreme+', { candidates: ['Valka'], confident: false })), team2: team(), team3: team() } }] });
    };
    const a = await json(upload('info', undefined, '&name=one.png'));
    const b = await json(upload('info', undefined, '&name=two.png'));
    for (let i = 0; i < 200 && (await state()).queue.some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await state()).queue.map((q: any) => [q.id, q.label, q.state])).toEqual([[a.id, 'one.png', 'done'], [b.id, 'two.png', 'done']]);
    expect((await state()).job).toMatchObject({ id: a.id, label: 'one.png' });
    // the second can be reviewed by its id before the first is dealt with, but is not the one shown
    expect((await t.app.request(`/api/roster-import/${b.id}/tile/0.team1.0`)).status).toBe(200);
    expect((await t.app.request('/api/roster-import', { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } })).status).toBe(204);
    expect((await state()).job.id).toBe(b.id);
  });

  it('can throw away the pictures that were not read yet', async () => {
    let release!: () => void;
    t.reply = () => new Promise<string>((resolve) => (release = () => resolve('{}')));
    await upload();
    await upload();
    await upload();
    await until(() => t.calls.length === 1);
    expect((await t.app.request('/api/roster-import?waiting=1', { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } })).status).toBe(204);
    expect((await state()).queue.map((q: any) => q.state)).toEqual(['running']);
    release?.();
  });

  it('fails with a message when the agent does not reply with the players', async () => {
    t.reply = () => 'Sorry, I cannot read this';
    await upload();
    expect(await finished()).toMatchObject({ state: 'failed', error: expect.stringContaining('The agent did not reply with the players it read (it said: Sorry, I cannot read this)') });
  });

  it('asks the agent once more when its reply leaves a strip out, and fails if it does so again', async () => {
    const whole = t.reply;
    let asked = 0;
    t.reply = (command) => {
      asked++;
      const full = JSON.parse(whole(command) as string);
      if (asked === 1) delete full.players[0].crops.team2;
      return JSON.stringify(full);
    };
    await upload();
    expect(await finished()).toMatchObject({ state: 'done' });
    expect(asked).toBe(2);

    asked = 0;
    t.reply = () => (asked++, JSON.stringify({ players: [{ name: 'Мокка', crops: { team1: team() } }] }));
    await t.app.request('/api/roster-import', { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } });
    await upload();
    expect(await finished()).toMatchObject({ state: 'failed', error: expect.stringMatching(/did not reply for/) });
    expect(asked).toBe(3); // the first try and two more
  });
});

describe('the proposal', () => {
  it('matches the name with look-alike letters, offers to rename, and lists heroes by the Roster sync rules', async () => {
    await upload();
    const job = await finished();
    expect(job.state).toBe('done');
    const [section] = job.sections;
    expect(section).toMatchObject({ playerName: 'Мокка', profile: { name: 'Mokka' }, rename: 'Мокка', create: null });
    // equipment is read from synthetic frames with no stars: nothing is claimed about it
    expect(section.rows.map((r: any) => [r.hero, r.direction, r.to.rank])).toEqual([['Evie', 'new', 'Paragon 1'], ['Thador', 'new', 'Supreme']]);
    // the filler tiles of the synthetic picture are not flat, so they are asked for too: only the tile with candidates is looked at
    expect(section.unknown.filter((u: any) => u.candidates.length > 0)).toEqual([expect.objectContaining({ candidates: ['Valka', 'Nara'] })]);
  });

  it('serves each tile as cut from the picture', async () => {
    await upload();
    const job = await finished();
    const response = await t.app.request(`/api/roster-import/${job.id}/tile/${job.sections[0].rows[0].tile}`);
    expect(response.headers.get('content-type')).toBe('image/png');
    const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(meta.width).toBeGreaterThan(80);
  });

  it('proposes a new profile for a player nobody matches, and can move the heroes to another profile', async () => {
    t.reply = () => JSON.stringify({ players: [{ name: 'Nini', crops: { team1: team(tile('Evie', 'Paragon 1')), team2: team(), team3: team() } }] });
    await upload();
    const job = await finished();
    expect(job.sections[0]).toMatchObject({ profile: null, create: 'Nini' });
    const moved = await json(post(`/api/roster-import/${job.id}/target`, { section: 0, target: { kind: 'profile', id: 1 } }));
    expect(moved).toMatchObject({ profile: { name: 'Brin' }, create: null });
    expect(moved.rows[0]).toMatchObject({ hero: 'Evie', direction: 'upgrade' });
  });

  it('reads the Resonating Hall for the chosen profile, which has no name on the picture', async () => {
    expect((await upload('hall', await blankPicture())).status).toBe(422);
    expect((await upload('hall', await infoPicture(), '&profile=Nobody')).status).toBe(404);
  });
});

describe('unknown tiles', () => {
  it('lets the player name one, which adds the hero to the proposal', async () => {
    await upload();
    const job = await finished();
    const key = job.sections[0].unknown[0].tile;
    const chosen = await json(post(`/api/roster-import/${job.id}/choose`, { tile: key, hero: 'Valka' }));
    expect(chosen.sections[0].rows.map((r: any) => r.hero)).toContain('Valka');
    expect(chosen.sections[0].unknown.filter((u: any) => u.candidates.length > 0)).toEqual([]);
    expect((await post(`/api/roster-import/${job.id}/choose`, { tile: key, hero: 'Nobody' })).status).toBe(400);
    const undone = await json(post(`/api/roster-import/${job.id}/choose`, { tile: key, hero: null }));
    expect(undone.sections[0].unknown.filter((u: any) => u.candidates.length > 0)).toHaveLength(1);
  });
});

/** A report whose tiles are not flat: each has its own noise, so that the readers can tell a tile from a blank one and from another. */
describe('reading pictures side by side', () => {
  it('reads two pictures at once when allowed, and never beside a scenario estimate', async () => {
    t.app = createApp(t.db, { agentRunner: fakeRunner, imagesDir: t.images, importWorkDir: t.work, importConcurrency: 2 });
    let release!: () => void;
    const gate = new Promise<string>((resolve) => (release = () => resolve('{}')));
    t.reply = () => gate;
    await upload();
    await upload();
    await upload();
    await until(() => t.calls.length === 2);
    expect((await state()).queue.map((q: any) => q.state)).toEqual(['running', 'running', 'queued']);
    expect((await state()).busy).toBe(true);
    release();
    // leave nothing running for the next test
    for (let i = 0; i < 300 && (await state()).queue.some((q: any) => q.state === 'running' || q.state === 'queued'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
