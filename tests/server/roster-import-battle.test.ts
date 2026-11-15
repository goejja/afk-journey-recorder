import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { importFixture, reportPicture, tile, team } from '../support/roster-import.js';

const t = importFixture();
const { fakeRunner, post, upload, json, state } = t;

describe('a Battle import', () => {
  const sides = () =>
    JSON.stringify({
      fight: { number: 2, ally: 'won', unionLevelAlly: 57, unionLevelEnemy: 37 },
      players: [
        { name: 'Brin', crops: { ally: team(tile('Evie', 'Supreme+', { rankSure: true }), tile('Thador', 'Paragon 1', { rankSure: false })) } },
        { name: 'Rover', crops: { enemy: team(tile('Valka', 'Supreme')) } },
      ],
    });
  const drafts = async () => (await json(t.app.request('/api/roster-import?kind=report'))).queue;

  it('asks for the mode, and keeps its pictures apart from the Roster import', async () => {
    expect((await upload('report', await reportPicture())).status).toBe(400);
    t.reply = sides;
    expect((await upload('report', await reportPicture(), '&mode=Guild%20Duel&name=one.png')).status).toBe(202);
    for (let i = 0; i < 300 && (await drafts()).some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await state()).job).toBeNull();
    expect((await state()).queue).toEqual([]);
    expect((await drafts()).map((q: any) => q.label)).toEqual(['one.png']);
  });

  const settled = async () => {
    for (let i = 0; i < 300 && (await drafts()).some((q: any) => q.state === 'queued' || q.state === 'running'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  };

  it('reads a failed picture again without sending it a second time', async () => {
    t.reply = () => 'no json at all';
    await upload('report', await reportPicture(), '&mode=Guild%20Duel&name=one.png');
    await settled();
    const failed = (await drafts())[0];
    expect(failed.state).toBe('failed');
    t.reply = sides;
    expect((await post(`/api/roster-import/${failed.id}/retry`)).status).toBe(202);
    await settled();
    const [again] = await drafts();
    expect(again).toMatchObject({ label: 'one.png', state: 'done' });
    expect(again.id).not.toBe(failed.id);
    // a picture that was read is not read again
    expect((await post(`/api/roster-import/${again.id}/retry`)).status).toBe(409);
  });

  it('keeps the pictures of a Battle import on disk, and puts them back after a restart until they are saved or discarded', async () => {
    const make = () => createApp(t.db, { agentRunner: fakeRunner, imagesDir: t.images, importWorkDir: t.work, importConcurrency: 1, importPersist: true });
    t.app = make();
    t.reply = sides;
    await upload('report', await reportPicture(), '&mode=Guild%20Duel&name=one.png');
    await settled();
    expect(readdirSync(join(t.work, 'queue')).sort()).toEqual([expect.stringMatching(/\.json$/), expect.stringMatching(/\.png$/)]);
    const asked = t.calls.length;

    t.app = make(); // the server restarted: the queue is empty in memory
    const [back] = await drafts();
    expect(back).toMatchObject({ label: 'one.png' });
    expect(back.key).toMatch(/^[0-9a-f]{64}$/); // what the browser keeps the player's edits under
    await settled();
    expect((await drafts())[0]).toMatchObject({ state: 'done' });
    expect(t.calls.length).toBe(asked); // what the Agent read before is remembered

    expect((await t.app.request(`/api/roster-import?ids=${back.id}`, { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } })).status).toBe(204);
    expect(readdirSync(join(t.work, 'queue'))).toEqual([]);
  });

  it('gives the fight, the sides and the Union Levels of a Guild Duel report as a draft', async () => {
    t.reply = sides;
    await upload('report', await reportPicture(), '&mode=Guild%20Duel');
    for (let i = 0; i < 300 && (await drafts()).some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const draft = (await drafts())[0].draft;
    expect(draft).toMatchObject({ mode: 'Guild Duel', number: 2, outcome: 'Win', unionLevelA: 57, unionLevelB: 37, duplicateOf: null });
    expect(draft.sideA.profile).toMatchObject({ name: 'Brin' });
    expect(draft.sideB.profile).toBeNull();
    // a rank only when the picture was sure of it, and no equipment without a star reading
    expect(draft.sideA.heroes.map((h: any) => [h.hero, h.rank, h.equipmentLevel])).toEqual([['Evie', 'Supreme+', null], ['Thador', null, null]]);
    expect(draft.sideB.heroes.map((h: any) => h.hero)).toEqual(['Valka']);
  });

  it('tells the agent which heroes the ally most likely is, from the default profile, and gives the crops of the artifact and phantimal', async () => {
    t.db.prepare("INSERT OR REPLACE INTO roster (profile_id, hero_name, rank, equipment_level) SELECT id, 'Evie', 'Supreme', NULL FROM profile WHERE is_default = 1").run();
    t.reply = sides;
    await upload('report', await reportPicture(), '&mode=Guild%20Duel');
    for (let i = 0; i < 300 && (await drafts()).some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const [command] = t.calls[0]!;
    const prompt = command.args[command.args.indexOf('-p') + 1]!;
    expect(prompt).toContain('The tiles of "ally" are most likely heroes the viewer owns: Evie.');
    expect(prompt).toContain('artifact-1.png');
    const draft = (await drafts())[0].draft;
    expect(draft.sideA.crops).toEqual({ artifact: '0.artifact', phantimal: '0.phantimal' });
    const crop = await t.app.request(`/api/roster-import/${(await drafts())[0].id}/tile/0.phantimal`);
    expect(crop.status).toBe(200);
    expect(crop.headers.get('content-type')).toBe('image/png');
  });

  it('serves the original picture of a Battle import until it is dismissed, so the form can keep it with the saved fight', async () => {
    t.reply = sides;
    const picture = await reportPicture();
    await upload('report', picture, '&mode=Guild%20Duel&name=one.png');
    for (let i = 0; i < 300 && (await drafts()).some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const [first] = await drafts();
    const served = await t.app.request(`/api/roster-import/${first.id}/picture`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await served.arrayBuffer()).equals(picture)).toBe(true);
    await t.app.request(`/api/roster-import?ids=${first.id}`, { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } });
    expect((await t.app.request(`/api/roster-import/${first.id}/picture`)).status).toBe(404);
  });

  it('leaves the Union Levels out of the other modes, and drops pictures once they were opened', async () => {
    t.reply = sides;
    await upload('report', await reportPicture(), '&mode=Supreme%20Arena');
    for (let i = 0; i < 300 && (await drafts()).some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const [first] = await drafts();
    expect(first.draft).toMatchObject({ unionLevelA: null, unionLevelB: null });
    expect((await t.app.request(`/api/roster-import?ids=${first.id}`, { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } })).status).toBe(204);
    expect(await drafts()).toEqual([]);
  });
});
