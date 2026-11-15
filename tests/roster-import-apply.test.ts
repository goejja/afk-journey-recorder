import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importFixture, tile, team } from './support/roster-import.js';

const t = importFixture();
const { post, upload, json, state, finished } = t;

describe('correcting a named tile', () => {
  it('lets the player change the hero the agent named, and saves the tile as that hero\'s look', async () => {
    await upload();
    const job = await finished();
    const row = job.sections[0].rows[0];
    const chosen = await json(post(`/api/roster-import/${job.id}/choose`, { tile: row.tile, hero: 'Nara' }));
    expect(chosen.sections[0].rows.map((r: any) => r.tile)).toContain(row.tile);
    expect(chosen.sections[0].rows.find((r: any) => r.tile === row.tile).hero).toBe('Nara');
    expect(chosen.chosen[row.tile]).toBe('Nara');
    expect((await post(`/api/roster-import/${job.id}/choose`, { tile: 'no.such.tile', hero: 'Nara' })).status).toBe(400);
    await post(`/api/roster-import/${job.id}/apply`, { sections: [{ profileId: 2, changes: [{ hero: 'Nara', rank: 'Supreme', equipmentLevel: null }], looks: [row.tile] }] });
    expect(t.db.prepare('SELECT hero_name AS hero FROM hero_look').all()).toEqual([{ hero: 'Nara' }]);
  });
});

describe('applying', () => {
  const changes = (...c: [string, string, number | null][]) => c.map(([hero, rank, equipmentLevel]) => ({ hero, rank, equipmentLevel }));
  const rosterOf = (name: string) => t.db.prepare('SELECT r.hero_name AS hero, r.rank, r.equipment_level AS level FROM roster r JOIN profile p ON p.id = r.profile_id WHERE p.name = ? ORDER BY r.hero_name').all(name);

  it('saves nothing until applied, and only asked from this app', async () => {
    await upload();
    const job = await finished();
    expect(rosterOf('Mokka')).toEqual([]);
    expect((await t.app.request(`/api/roster-import/${job.id}/apply`, { method: 'POST', body: '{}' })).status).toBe(400);
  });

  it('renames the profile, updates its roster and keeps the heroes the picture does not show', async () => {
    await upload();
    const job = await finished();
    const response = await post(`/api/roster-import/${job.id}/apply`, { sections: [{ profileId: 2, rename: 'Мокка', changes: changes(['Evie', 'Paragon 1', 10], ['Thador', 'Supreme', null]) }] });
    expect(response.status).toBe(200);
    expect(rosterOf('Мокка')).toEqual([{ hero: 'Evie', rank: 'Paragon 1', level: 10 }, { hero: 'Thador', rank: 'Supreme', level: null }]);
    expect(rosterOf('Brin')).toEqual([{ hero: 'Evie', rank: 'Supreme+', level: 10 }]);
    expect((await state()).job).toBeNull();
  });

  it('creates a profile without a Player ID', async () => {
    await upload();
    const job = await finished();
    await post(`/api/roster-import/${job.id}/apply`, { sections: [{ create: 'Nini', changes: changes(['Valka', 'Supreme+', 5]) }] });
    expect(t.db.prepare("SELECT player_id AS id FROM profile WHERE name = 'Nini'").get()).toEqual({ id: null });
    expect(rosterOf('Nini')).toEqual([{ hero: 'Valka', rank: 'Supreme+', level: 5 }]);
  });

  it('matches a player to the profile an earlier picture of the queue just created, instead of proposing it again', async () => {
    t.reply = () => JSON.stringify({ players: [{ name: 'Nini', crops: { team1: team(tile('Valka', 'Supreme+')), team2: team(), team3: team() } }] });
    const first = await json(upload('info', undefined, '&name=one.png'));
    const second = await json(upload('info', undefined, '&name=two.png'));
    for (let i = 0; i < 200 && (await state()).queue.some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await state()).job.sections[0]).toMatchObject({ profile: null, create: 'Nini' });
    expect((await post(`/api/roster-import/${first.id}/apply`, { sections: [{ create: 'Nini', changes: changes(['Valka', 'Supreme+', 5]) }] })).status).toBe(200);
    const next = (await state()).job;
    expect(next.id).toBe(second.id);
    expect(next.sections[0]).toMatchObject({ profile: { name: 'Nini' }, create: null });
  });

  it('saves a look for a tile the player named', async () => {
    await upload();
    const job = await finished();
    const key = job.sections[0].unknown[0].tile;
    await post(`/api/roster-import/${job.id}/choose`, { tile: key, hero: 'Valka' });
    await post(`/api/roster-import/${job.id}/apply`, { sections: [{ profileId: 2, changes: changes(['Valka', 'Supreme+', 5]), looks: [key] }] });
    const look = t.db.prepare('SELECT id, hero_name AS hero, file FROM hero_look').get() as any;
    expect(look).toMatchObject({ hero: 'Valka' });
    expect(existsSync(join(t.images, 'custom', 'look', look.file))).toBe(true);
  });

  it('saves a look even when no hero changes, and keeps the Agent\'s reading of a picture that needed nothing', async () => {
    await upload();
    const job = await finished();
    const key = job.sections[0].unknown[0].tile;
    await post(`/api/roster-import/${job.id}/choose`, { tile: key, hero: 'Valka' });
    const applied = await json(post(`/api/roster-import/${job.id}/apply`, { sections: [{ profileId: 2, changes: [], looks: [key] }] }));
    expect(applied.applied[0]).toMatchObject({ changed: 0, looks: 1 });

    await upload();
    await finished();
    expect((await t.app.request('/api/roster-import?keep=1', { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } })).status).toBe(204);
    expect(t.db.prepare('SELECT count(*) AS n FROM import_reply').get()).toEqual({ n: 1 });
  });

  it('saves the tiles whose rank was confirmed as Rank Looks, once for a tile that looks the same', async () => {
    await upload();
    const job = await finished();
    const evie = job.sections[0].rows.find((r: any) => r.hero === 'Evie');
    const applied = await json(post(`/api/roster-import/${job.id}/apply`, { sections: [{ profileId: 2, changes: [{ hero: 'Evie', rank: 'Paragon 1', equipmentLevel: 10, tile: evie.tile }] }] }));
    expect(applied.applied[0].rankLooks).toBe(1);
    const look = t.db.prepare('SELECT id, rank, file FROM rank_look').get() as any;
    expect(t.db.prepare('SELECT source FROM rank_look').pluck().get()).toBe('roster');
    expect(look).toMatchObject({ rank: 'Paragon 1' });
    expect(existsSync(join(t.images, 'custom', 'rank-look', look.file))).toBe(true);

    // the picture's tiles are flat colours, so the hero reader would take all of them for Evie: leave it out of this test
    t.db.prepare('DELETE FROM hero_example').run();
    await upload();
    const again = await finished();
    const second = await json(post(`/api/roster-import/${again.id}/apply`, { sections: [{ profileId: 2, changes: [{ hero: 'Evie', rank: 'Paragon 1', equipmentLevel: 10, tile: again.sections[0].rows[0].tile }] }] }));
    expect(second.applied[0].rankLooks).toBe(0);
    expect(t.db.prepare('SELECT count(*) AS n FROM rank_look').get()).toEqual({ n: 1 });
  });

  it('logs what was read of each applied tile next to what was applied, to measure the readings', async () => {
    await upload();
    const job = await finished();
    const evie = job.sections[0].rows.find((r: any) => r.hero === 'Evie');
    await post(`/api/roster-import/${job.id}/apply`, { sections: [{ profileId: 2, changes: [{ hero: 'Evie', rank: 'Paragon 1', equipmentLevel: 10, tile: evie.tile }] }] });
    const rows = t.db.prepare("SELECT source, screen, field, subject, read_value AS read, final_value AS final FROM import_reading ORDER BY id").all() as any[];
    expect(rows).toContainEqual({ source: 'roster-apply', screen: 'info', field: 'hero', subject: '', read: 'Evie', final: 'Evie' });
    expect(rows.find((r) => r.field === 'rank')).toMatchObject({ subject: 'Evie', final: 'Paragon 1' });
  });

  it('keeps the tiles whose hero was applied for the hero reader, and lets it name a tile the Agent got wrong', async () => {
    await upload();
    const job = await finished();
    const evie = job.sections[0].rows.find((r: any) => r.hero === 'Evie');
    await post(`/api/roster-import/${job.id}/apply`, { sections: [{ profileId: 2, changes: [{ hero: 'Evie', rank: 'Paragon 1', equipmentLevel: 10, tile: evie.tile }] }] });
    const saved = t.db.prepare('SELECT id, hero_name AS hero, file FROM hero_example').all() as any[];
    expect(saved).toMatchObject([{ hero: 'Evie' }]);
    expect(existsSync(join(t.images, 'custom', 'hero-example', saved[0].file))).toBe(true);

    // the picture's tiles are flat colours that look the same: the Agent now calls the first Thador, and the reader says Evie
    t.db.prepare("DELETE FROM import_reply").run();
    t.reply = () => JSON.stringify({ players: [{ name: 'Мокка', crops: { team1: team(tile('Thador', 'Supreme')), team2: team(), team3: team() } }] });
    await upload();
    const again = await finished();
    expect(again.sections[0].rows).toMatchObject([{ hero: 'Evie', look: { agrees: false } }]);
  });

  it('remembers what the Agent said of a picture, until the reading is discarded or a hero was corrected', async () => {
    await upload();
    await finished();
    await t.app.request('/api/roster-import', { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } });
    expect(t.calls.length).toBe(1);
    expect(t.db.prepare('SELECT count(*) AS n FROM import_reply').get()).toEqual({ n: 0 });
    await upload();
    await finished();
    expect(t.calls.length).toBe(2);
    // not discarded: the same picture is not read again, unless asked
    await upload();
    for (let i = 0; i < 100 && (await state()).queue.some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.calls.length).toBe(2);
    await upload('info', undefined, '&fresh=1');
    for (let i = 0; i < 100 && (await state()).queue.some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.calls.length).toBe(3);
  });

  it('saves nothing at all when one change is not valid', async () => {
    await upload();
    const job = await finished();
    const response = await post(`/api/roster-import/${job.id}/apply`, {
      sections: [{ profileId: 2, rename: 'Мокка', changes: changes(['Evie', 'Paragon 1', 10], ['Thador', 'Epic', 15]) }],
    });
    expect(response.status).toBe(400);
    expect(rosterOf('Mokka')).toEqual([]);
    expect(t.db.prepare("SELECT 1 FROM profile WHERE name = 'Мокка'").get()).toBeUndefined();
    expect((await state()).job).not.toBeNull();
  });

  it('refuses a name another profile has, an unknown hero and a tile that was never named', async () => {
    await upload();
    const job = await finished();
    const apply = (section: object) => post(`/api/roster-import/${job.id}/apply`, { sections: [section] });
    expect((await apply({ profileId: 2, rename: 'brin', changes: [] })).status).toBe(409);
    expect((await apply({ profileId: 2, changes: changes(['Nobody', 'Supreme', null]) })).status).toBe(400);
    expect((await apply({ profileId: 2, changes: [], looks: ['0.team1.2'] })).status).toBe(400);
    expect((await apply({ changes: [] })).status).toBe(400);
  });

  it('throws a proposal away on request', async () => {
    await upload();
    await finished();
    expect((await t.app.request('/api/roster-import', { method: 'DELETE', headers: { 'x-afk-action': 'dismiss' } })).status).toBe(204);
    expect((await state()).job).toBeNull();
  });
});
