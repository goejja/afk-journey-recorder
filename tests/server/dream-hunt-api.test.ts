import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'C', 'D', 'E']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  for (const name of ['A', 'B', 'C', 'D', 'E']) db.prepare('INSERT INTO roster (hero_name) VALUES (?)').run(name);
  db.prepare("INSERT INTO boss (name, class) VALUES ('King Croaker', 'Mage'), ('Thalassa', 'Tank')").run();
  db.prepare("INSERT INTO artifact (name, grp) VALUES ('Bladestorm', 'Season 8')").run();
  db.prepare("INSERT INTO phantimal (name) VALUES ('Gervan')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;

const team = (names: string[]) => ({
  heroes: names.map((hero, i) => ({ tile: 38 + i, hero })),
  phantimal: null,
  assistHero: null,
  artifact: 'Bladestorm',
  
});
const fight = (extra: object = {}) =>
  send('POST', '/api/dream-hunt/attempts', {
    boss: 'King Croaker',
    mapName: 'Open',
    outcome: 'Win',
    timeSeconds: 90,
    formation: team(['A', 'B', 'C']),
    ...extra,
  });

describe('boss rules', () => {
  it('creates, renames and deletes a rule, but not one that is in use', async () => {
    expect((await send('POST', '/api/boss-rules', { name: 'Double damage', description: ' Hits harder ' })).status).toBe(201);
    expect(await json(send('GET', '/api/boss-rules'))).toEqual([{ name: 'Double damage', description: 'Hits harder' }]);
    expect((await send('POST', '/api/boss-rules', { name: 'Double damage' })).status).toBe(409);
    expect((await send('POST', '/api/boss-rules', { name: ' ' })).status).toBe(400);

    await fight({ bossRule: 'Double damage' });
    expect((await send('PUT', '/api/boss-rules/Double%20damage', { name: 'Berserk', description: '' })).status).toBe(200);
    expect((await json(send('GET', '/api/dream-hunt/attempts')))[0].bossRule).toBe('Berserk');
    const blocked = await send('DELETE', '/api/boss-rules/Berserk');
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/used by 1 attempt/);
  });

  it('deletes an unused rule', async () => {
    await send('POST', '/api/boss-rules', { name: 'Spare' });
    expect((await send('DELETE', '/api/boss-rules/Spare')).status).toBe(204);
    expect(await json(send('GET', '/api/boss-rules'))).toEqual([]);
  });
});

describe('dream hunt attempts', () => {
  it('records a cleared fight with its time and a snapshot formation', async () => {
    db.prepare("UPDATE roster SET rank = NULL WHERE hero_name = 'A'").run();
    const response = await fight();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      boss: 'King Croaker',
      outcome: 'Win',
      timeSeconds: 90,
      bossRule: null,
      formation: { artifact: 'Bladestorm', heroes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
    });
  });

  it('records a failed fight without a time', async () => {
    const created = await json(fight({ outcome: 'Loss', timeSeconds: null }));
    expect(created).toMatchObject({ outcome: 'Loss', timeSeconds: null });
  });

  it('rejects bad results, unknown bosses, rules and maps, and phantimals', async () => {
    expect((await fight({ timeSeconds: null })).status).toBe(400);
    expect((await fight({ timeSeconds: 0 })).status).toBe(400);
    const quick = await json(fight({ timeSeconds: 9.69 })); // most clears are seconds, with hundredths
    expect(quick.timeSeconds).toBe(9.69);
    expect((await json(send('GET', '/api/dream-hunt/attempts'))).find((f: any) => f.id === quick.id).timeSeconds).toBe(9.69);
    expect((await fight({ outcome: 'Loss', timeSeconds: 40 })).status).toBe(400);
    expect((await fight({ boss: 'Nobody' })).status).toBe(404);
    expect((await fight({ bossRule: 'Ghost rule' })).status).toBe(400);
    expect((await fight({ mapName: 'Nowhere' })).status).toBe(400);
    expect((await fight({ formation: { ...team(['A']), phantimal: { tile: 40, name: 'Gervan' } } })).status).toBe(400);
    expect((await fight({ formation: team(['Z']) })).status).toBe(400);
  });

  it('lists bosses with their attempt counts and filters attempts by boss', async () => {
    await fight();
    await fight({ boss: 'Thalassa' });
    const bosses = await json(send('GET', '/api/bosses'));
    expect(bosses.find((b: any) => b.name === 'King Croaker').attempts).toBe(1);
    expect(await json(send('GET', '/api/dream-hunt/attempts?boss=Thalassa'))).toHaveLength(1);
  });

  it('deleting an attempt through the generic endpoint removes its Dream Hunt record', async () => {
    const created = await json(fight());
    expect((await send('DELETE', `/api/attempts/${created.id}`)).status).toBe(204);
    expect(db.prepare('SELECT count(*) FROM dream_hunt_attempt').pluck().get()).toBe(0);
  });
});

describe('leaderboard', () => {
  it('compares compositions across repeated fights, whatever the order of the heroes', async () => {
    await fight({ timeSeconds: 100, formation: team(['A', 'B', 'C']) });
    await fight({ timeSeconds: 80, formation: team(['C', 'B', 'A']) });
    await fight({ timeSeconds: 120, formation: team(['A', 'B', 'C']) });
    await fight({ timeSeconds: 70, formation: team(['A', 'D', 'E']) });
    await fight({ outcome: 'Loss', timeSeconds: null, formation: team(['A', 'B', 'C']) });

    const board = await json(send('GET', '/api/dream-hunt/leaderboard?boss=King%20Croaker'));
    expect(board.attempts).toBe(5);
    const [first, second] = board.compositions;
    expect(first.heroes).toEqual(['A', 'B', 'C']);
    expect(first).toMatchObject({ attempts: 4, clears: 3, bestSeconds: 80, medianSeconds: 100, worstSeconds: 120, lowConfidence: false });
    expect(first.latest.heroes).toHaveLength(3);
    expect(second).toMatchObject({ heroes: ['A', 'D', 'E'], clears: 1, lowConfidence: true });
  });

  it('keeps only the fights recorded since a given day', async () => {
    const old = await json(fight({ timeSeconds: 100, formation: team(['A', 'B', 'C']) }));
    await fight({ timeSeconds: 80, formation: team(['A', 'D', 'E']) });
    db.prepare("UPDATE attempt SET created_at = '2020-01-01 10:00:00' WHERE id = ?").run(old.id);

    const board = await json(send('GET', '/api/dream-hunt/leaderboard?boss=King%20Croaker&since=2024-01-01'));
    expect(board.attempts).toBe(1);
    expect(board.compositions.map((c: any) => c.heroes)).toEqual([['A', 'D', 'E']]);
  });

  it('lists the layouts of a composition with their fights, fastest first', async () => {
    await fight({ timeSeconds: 100, formation: team(['A', 'B', 'C']) });
    await fight({ timeSeconds: 70, formation: team(['C', 'B', 'A']) }); // the same heroes on other tiles
    await fight({ timeSeconds: 90, formation: team(['A', 'B', 'C']) });

    const board = await json(send('GET', '/api/dream-hunt/leaderboard?boss=King%20Croaker'));
    const [composition] = board.compositions;
    expect(composition.layouts.map((l: any) => [l.attempts, l.clears, l.medianSeconds])).toEqual([
      [1, 1, 70],
      [2, 2, 95],
    ]);
    expect(composition.layouts[0].layout.units.map((u: any) => [u.hero, u.tile])).toEqual([['C', 38], ['B', 39], ['A', 40]]);
  });

  it('filters by boss rule: any, none, or a named rule', async () => {
    await send('POST', '/api/boss-rules', { name: 'Boost' });
    await fight({ timeSeconds: 60, bossRule: 'Boost' });
    await fight({ timeSeconds: 120 });
    const count = async (rule: string) => (await json(send('GET', `/api/dream-hunt/leaderboard?boss=King%20Croaker&rule=${rule}`))).attempts;
    expect(await count('any')).toBe(2);
    expect(await count('none')).toBe(1);
    expect(await count('Boost')).toBe(1);
  });

  it('asks for a known boss', async () => {
    expect((await send('GET', '/api/dream-hunt/leaderboard')).status).toBe(400);
    expect((await send('GET', '/api/dream-hunt/leaderboard?boss=Nobody')).status).toBe(400);
  });
});

describe('finder', () => {
  it('lists, per boss, the compositions that hold every hero asked for, the boss with the most fights first', async () => {
    await fight({ timeSeconds: 100, formation: team(['A', 'B', 'C']) });
    await fight({ timeSeconds: 80, formation: team(['A', 'B', 'D']) });
    await fight({ timeSeconds: 70, formation: team(['A', 'D', 'E']) });
    await fight({ boss: 'Thalassa', timeSeconds: 60, formation: team(['B', 'A', 'E']) });
    await fight({ boss: 'Thalassa', timeSeconds: 65, formation: team(['B', 'A', 'E']) });
    await fight({ boss: 'Thalassa', timeSeconds: 66, formation: team(['B', 'A', 'E']) });

    const found = await json(send('GET', '/api/dream-hunt/finder?hero=A&hero=B'));
    expect(found.heroes).toEqual(['A', 'B']);
    expect(found.attempts).toBe(5);
    expect(found.bosses.map((b: any) => [b.boss, b.attempts])).toEqual([['Thalassa', 3], ['King Croaker', 2]]);
    const croaker = found.bosses.find((b: any) => b.boss === 'King Croaker');
    expect(croaker.compositions.map((c: any) => c.heroes).sort()).toEqual([['A', 'B', 'C'], ['A', 'B', 'D']]);
    expect(croaker.compositions[0]).toMatchObject({ latestAttemptId: expect.any(Number), layouts: expect.any(Array) });
  });

  it('asks for a hero and filters by rule', async () => {
    expect((await send('GET', '/api/dream-hunt/finder')).status).toBe(400);
    await send('POST', '/api/boss-rules', { name: 'Boost' });
    await fight({ bossRule: 'Boost' });
    await fight({});
    expect((await json(send('GET', '/api/dream-hunt/finder?hero=A&rule=none'))).attempts).toBe(1);
    expect((await json(send('GET', '/api/dream-hunt/finder?hero=A&rule=any'))).attempts).toBe(2);
    expect((await json(send('GET', '/api/dream-hunt/finder?hero=D'))).bosses).toEqual([]);
  });
});

describe('a day of fights as one battle', () => {
  const day = (fights: object[]) => send('POST', '/api/dream-hunt/battle-groups', { fights });
  const one = (names: string[], extra: object = {}) => ({ boss: 'King Croaker', mapName: 'Open', outcome: 'Win', timeSeconds: 90, formation: team(names), ...extra });

  it('saves the fights together, each with its number, and refuses a hero in two fights', async () => {
    const saved = await json(day([one(['A']), one(['B'], { outcome: 'Loss', timeSeconds: null })]));
    expect(saved.fights.map((f: any) => [f.battleId, f.battlePosition, f.outcome])).toEqual([[saved.id, 1, 'Win'], [saved.id, 2, 'Loss']]);
    const twice = await day([one(['A']), one(['A', 'C'])]);
    expect(twice.status).toBe(400);
    expect((await twice.json()).error).toMatch(/A is in fights 1 and 2/);
  });

  it('saves nothing when one fight is wrong, and names it', async () => {
    const response = await day([one(['A']), one(['B'], { boss: 'Nobody' })]);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/^Fight 2:/);
    expect(db.prepare('SELECT count(*) FROM attempt').pluck().get()).toBe(0);
    expect((await day([])).status).toBe(400);
    expect((await day([one(['A'], { position: 6 })])).status).toBe(400);
  });

  it('edits a whole day: updates a number in place, adds a new one and removes one left out', async () => {
    const saved = await json(day([one(['A']), one(['B'], { outcome: 'Loss', timeSeconds: null }), one(['C'])]));
    const [first, second] = saved.fights.map((f: any) => f.id);
    // A and B swap fights, fight 2 is cleared, fight 3 is left out and fight 4 is new.
    const edited = await send('PUT', `/api/dream-hunt/battle-groups/${saved.id}`, {
      fights: [one(['B'], { position: 1, timeSeconds: 9.69, note: 'fast' }), one(['A'], { position: 2 }), one(['D'], { position: 4 })],
    });
    expect(edited.status).toBe(200);
    const result = await edited.json();
    expect(result.fights.map((f: any) => [f.battlePosition, f.formation.heroes[0].name, f.timeSeconds])).toEqual([[1, 'B', 9.69], [2, 'A', 90], [4, 'D', 90]]);
    expect(result.fights.slice(0, 2).map((f: any) => f.id)).toEqual([first, second]); // the same records
    expect(db.prepare('SELECT count(*) FROM attempt').pluck().get()).toBe(3);
    expect(db.prepare('SELECT count(*) FROM attempt WHERE battle_id = ?').pluck().get(saved.id)).toBe(3);
  });

  it('lists a day with all its fights even when a filter or the limit would cut it', async () => {
    const saved = await json(day([one(['A']), one(['B'], { boss: 'Thalassa' }), one(['C'])]));
    await fight({ formation: team(['D']) }); // a fight on its own
    const byBoss = await json(send('GET', '/api/dream-hunt/attempts?boss=Thalassa'));
    expect(byBoss.map((f: any) => f.battlePosition)).toEqual([3, 2, 1]); // the whole day, not only fight 2
    expect(byBoss.every((f: any) => f.battleId === saved.id)).toBe(true);
    const limited = await json(send('GET', '/api/dream-hunt/attempts?limit=2'));
    expect(limited.filter((f: any) => f.battleId === saved.id)).toHaveLength(3);
    // The leaderboard still counts only the boss asked for.
    expect((await json(send('GET', '/api/dream-hunt/leaderboard?boss=Thalassa'))).attempts).toBe(1);
  });

  it('refuses a bad edit of a day and changes nothing', async () => {
    const saved = await json(day([one(['A']), one(['B'])]));
    const url = `/api/dream-hunt/battle-groups/${saved.id}`;
    expect((await send('PUT', url, { fights: [one(['A'], { position: 1 }), one(['A', 'C'], { position: 2 })] })).status).toBe(400);
    expect((await send('PUT', url, { fights: [one(['A'], { position: 1 }), one(['C'], { position: 2, boss: 'Nobody' })] })).status).toBe(404);
    expect((await send('PUT', url, { fights: [] })).status).toBe(400);
    expect((await send('PUT', '/api/dream-hunt/battle-groups/999', { fights: [one(['A'])] })).status).toBe(404);
    const after = await json(send('GET', '/api/dream-hunt/attempts'));
    expect(after.map((f: any) => f.formation.heroes[0].name).sort()).toEqual(['A', 'B']);
  });

  it('keeps the one-fight rule when a fight of the day is edited', async () => {
    const saved = await json(day([one(['A']), one(['B'])]));
    expect((await send('PUT', `/api/dream-hunt/attempts/${saved.fights[1].id}`, one(['A']))).status).toBe(400);
    expect((await send('PUT', `/api/dream-hunt/attempts/${saved.fights[1].id}`, one(['C']))).status).toBe(200);
    expect((await send('DELETE', `/api/battles/${saved.id}?fights=delete`)).status).toBe(204);
    expect(db.prepare('SELECT count(*) FROM attempt').pluck().get()).toBe(0);
  });
});

describe('the Formation ID of a day (ADR 0007)', () => {
  const day = (fights: object[], formationId?: string) => send('POST', '/api/dream-hunt/battle-groups', { fights, formationId });
  const bossFight = (heroes: string[], extra: object = {}) => ({ boss: 'King Croaker', mapName: 'Open', outcome: 'Win', timeSeconds: 90, formation: team(heroes), ...extra });

  it('keeps one code for the whole day and a deployment with every fight', async () => {
    const saved = await json(day([bossFight(['A']), bossFight(['B'])], 'a1b2c3d4'));
    expect(saved.fights.map((f: any) => [f.battleFormationId, f.formation.formationId])).toEqual([['A1B2C3D4', null], ['A1B2C3D4', null]]);
    const [entry] = await json(send('GET', '/api/formation-ids'));
    expect(entry).toMatchObject({ code: 'A1B2C3D4', records: 1, maps: ['Open'] });
    expect(entry.deployment.teams.map((t: any) => [t.units[0].hero, t.artifact])).toEqual([['A', 'Bladestorm'], ['B', 'Bladestorm']]);
  });

  it('refuses a code stored for other units, saves nothing, and still lets a fight on its own carry a code', async () => {
    await day([bossFight(['A']), bossFight(['B'])], 'A1B2C3D4');
    const clash = await day([bossFight(['A']), bossFight(['C'])], 'A1B2C3D4');
    expect(clash.status).toBe(400);
    expect(db.prepare('SELECT count(*) FROM battle').pluck().get()).toBe(1);
    const alone = await json(send('POST', '/api/dream-hunt/attempts', bossFight(['D'], { formation: { ...team(['D']), formationId: 'ZZZZ9999' } })));
    expect(alone.formation.formationId).toBe('ZZZZ9999');
  });
});
