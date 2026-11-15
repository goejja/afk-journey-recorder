import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
let app: Hono;
let db: Database.Database;
let dir: string | undefined;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'C', 'X']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  app = createApp(db);
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
const fight = (hero: string, extra: Record<string, unknown> = {}) => ({
  mapName: 'Open', outcome: 'Win',
  formation: { heroes: [{ tile: 38, hero }], phantimal: null, assistHero: null, artifact: null},
  opponent: { heroes: [{ tile: 0, hero: 'X' }] },
  ...extra,
});
const group = (fights: unknown[], mode = 'Supreme Arena') => send('POST', '/api/pvp/battle-groups', { mode, fights });
const count = (sql: string) => db.prepare(sql).pluck().get() as number;

describe('battles of several fights', () => {
  it('saves the teams together, each its own fight with its team number', async () => {
    const created = await json(group([fight('A'), fight('B', { outcome: 'Loss' }), fight('C')]));
    expect(created.fights.map((f: any) => [f.battleId, f.battlePosition, f.outcome])).toEqual([
      [created.id, 1, 'Win'], [created.id, 2, 'Loss'], [created.id, 3, 'Win'],
    ]);
    expect(count('SELECT count(*) FROM attempt')).toBe(3);
    const listed = await json(send('GET', '/api/pvp/battles'));
    expect(listed.every((f: any) => f.battleId === created.id)).toBe(true);
  });

  it('saves nothing when one team is wrong, and names the team', async () => {
    const response = await group([fight('A'), fight('B', { mapName: 'Nowhere' })]);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^Team 2:/);
    expect(count('SELECT count(*) FROM attempt') + count('SELECT count(*) FROM battle')).toBe(0);
  });

  it('refuses a hero on two teams, a single-team mode, and bad team numbers', async () => {
    const twice = await group([fight('A'), fight('A')]);
    expect(twice.status).toBe(400);
    expect((await twice.json()).error).toMatch(/A is on teams 1 and 2/);
    expect((await group([fight('A')], 'Arena')).status).toBe(400);
    expect((await group([fight('A', { position: 4 })])).status).toBe(400);
    expect((await group([fight('A', { position: 2 }), fight('B', { position: 2 })])).status).toBe(400);
    expect((await group([])).status).toBe(400);
  });

  it('refuses an unknown rule, and a rule outside Supreme Arena', async () => {
    db.prepare("INSERT INTO boss_rule (name, description) VALUES ('Frozen', '')").run();
    const unknown = await group([fight('A', { rule: 'Nope' })]);
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toMatch(/Unknown rule "Nope"/);
    expect((await group([fight('A', { rule: 'Frozen' })], 'Super League')).status).toBe(400);
    expect((await group([fight('A', { rule: 'Frozen' })])).status).toBe(201);
    expect(count('SELECT count(*) FROM attempt')).toBe(1);
  });

  it('keeps the one-team rule when a fight of a battle is edited, but not for a fight on its own', async () => {
    const created = await json(group([fight('A'), fight('B')]));
    const second = created.fights[1];
    expect((await send('PUT', `/api/pvp/battles/${second.id}`, { ...fight('A'), mode: 'Supreme Arena' })).status).toBe(400);
    expect((await send('PUT', `/api/pvp/battles/${second.id}`, { ...fight('C'), mode: 'Supreme Arena' })).status).toBe(200);
    const alone = await json(send('POST', '/api/pvp/battles', { ...fight('A'), mode: 'Supreme Arena' }));
    expect(alone).toMatchObject({ battleId: null, battlePosition: null });
    expect((await send('PUT', `/api/pvp/battles/${alone.id}`, { ...fight('B'), mode: 'Supreme Arena' })).status).toBe(200);
  });

  it('edits a whole battle: updates a team in place, adds a new one and removes one left out', async () => {
    const created = await json(group([fight('A'), fight('B', { outcome: 'Loss' }), fight('C')]));
    const [first, second] = created.fights.map((f: any) => f.id);
    // A and B swap teams, team 2 is now won, team 3 is left out and team 4 does not exist in this mode.
    const edited = await send('PUT', `/api/pvp/battle-groups/${created.id}`, {
      fights: [fight('B', { position: 1, note: 'swapped', tags: ['Luna'] }), fight('A', { position: 2 })],
    });
    expect(edited.status).toBe(200);
    const result = await edited.json();
    expect(result.fights.map((f: any) => [f.battlePosition, f.formation.heroes[0].name, f.outcome])).toEqual([[1, 'B', 'Win'], [2, 'A', 'Win']]);
    expect(result.fights.map((f: any) => f.id)).toEqual([first, second]); // the same records
    expect(result.fights[0]).toMatchObject({ note: 'swapped', tags: ['Luna'] });
    expect(count('SELECT count(*) FROM attempt')).toBe(2);
    // A new number can be added back, and the mode of the battle stays as it was.
    const again = await json(send('PUT', `/api/pvp/battle-groups/${created.id}`, { fights: [fight('A', { position: 1 }), fight('B', { position: 3 })] }));
    expect(again.fights.map((f: any) => [f.mode, f.battlePosition])).toEqual([['Supreme Arena', 1], ['Supreme Arena', 3]]);
  });

  it('lists a battle with all its teams even when the limit would cut it', async () => {
    const created = await json(group([fight('A'), fight('B'), fight('C')]));
    const limited = await json(send('GET', '/api/pvp/battles?limit=1'));
    expect(limited.map((f: any) => f.battleId)).toEqual([created.id, created.id, created.id]);
  });

  it('refuses a bad edit of a battle and changes nothing', async () => {
    const created = await json(group([fight('A'), fight('B')]));
    const url = `/api/pvp/battle-groups/${created.id}`;
    expect((await send('PUT', url, { fights: [fight('A', { position: 1 }), fight('A', { position: 2 })] })).status).toBe(400);
    const wrong = await send('PUT', url, { fights: [fight('A', { position: 1 }), fight('C', { position: 2, mapName: 'Nowhere' })] });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toMatch(/^Team 2:/);
    expect((await send('PUT', url, { fights: [] })).status).toBe(400);
    expect((await send('PUT', url, { fights: [fight('A', { position: 4 })] })).status).toBe(400);
    expect((await send('PUT', '/api/pvp/battle-groups/999', { fights: [fight('A')] })).status).toBe(404);
    const after = await json(send('GET', '/api/pvp/battles'));
    expect(after.map((f: any) => f.formation.heroes[0].name).sort()).toEqual(['A', 'B']);
  });

  it('removes a battle and keeps its fights, or takes the fights along', async () => {
    const created = await json(group([fight('A'), fight('B')]));
    expect((await send('DELETE', `/api/battles/${created.id}`)).status).toBe(204);
    expect(count('SELECT count(*) FROM attempt')).toBe(2);
    expect(count('SELECT count(*) FROM attempt WHERE battle_id IS NOT NULL')).toBe(0);
    const again = await json(group([fight('A'), fight('B')]));
    await send('DELETE', `/api/battles/${again.id}?fights=delete`);
    expect(count('SELECT count(*) FROM attempt')).toBe(2); // only the first battle's two fights are left
    expect((await send('DELETE', '/api/battles/999')).status).toBe(404);
  });

  it('drops a battle when its last fight is deleted', async () => {
    const created = await json(group([fight('A'), fight('B')]));
    await send('DELETE', `/api/attempts/${created.fights[0].id}`);
    expect(count('SELECT count(*) FROM battle')).toBe(1);
    await send('DELETE', `/api/attempts/${created.fights[1].id}`);
    expect(count('SELECT count(*) FROM battle')).toBe(0);
  });
});

describe('the Formation ID of a battle (ADR 0007)', () => {
  const team = (hero: string, tile: number, artifact: string | null = null, opponent = 'X') => ({
    mapName: 'Open', outcome: 'Win',
    formation: { heroes: [{ tile, hero }], phantimal: null, assistHero: null, artifact},
    opponent: { heroes: [{ tile: 0, hero: opponent }] },
  });
  const withCodes = (fights: unknown[], codes: { formationId?: string; opponentFormationId?: string } = {}) => ({ mode: 'Supreme Arena', fights, ...codes });
  const library = async () => json(send('GET', '/api/formation-ids'));

  it('keeps one code for the teams of a side on the battle, and stores the deployment of all the teams', async () => {
    db.prepare("INSERT INTO artifact (name, grp) VALUES ('Candlestick', 'Pre-Season')").run();
    const created = await json(send('POST', '/api/pvp/battle-groups', withCodes([team('A', 38, 'Candlestick'), team('B', 39), team('C', 40)], { formationId: 'a1b2c3d4', opponentFormationId: 'ZZZZ9999' })));
    expect(created.fights.map((f: any) => [f.battleFormationId, f.battleOpponentFormationId, f.formation.formationId, f.opponent.formationId])).toEqual(
      Array(3).fill(['A1B2C3D4', 'ZZZZ9999', null, null]),
    );
    const [mine, theirs] = await library();
    expect(mine.code).toBe('A1B2C3D4');
    expect(mine.deployment.teams.map((t: any) => [t.units[0].hero, t.units[0].tile, t.artifact])).toEqual([['A', 38, 'Candlestick'], ['B', 39, null], ['C', 40, null]]);
    expect(theirs.deployment.teams.map((t: any) => t.units[0].hero)).toEqual(['X', 'X', 'X']);
    expect(mine.records).toBe(1); // one battle, not three fights
  });

  it('ignores a code typed on a fight of a battle: the battle holds it', async () => {
    const typed = team('A', 38) as any;
    typed.formation.formationId = 'A1B2C3D4';
    await group([typed, team('B', 39)]);
    expect(await library()).toEqual([]);
    expect(count('SELECT count(*) FROM formation WHERE formation_id IS NOT NULL')).toBe(0);
  });

  it('refuses a code stored for other units in a team, naming the side, and saves nothing', async () => {
    await send('POST', '/api/pvp/battle-groups', withCodes([team('A', 38), team('B', 39)], { formationId: 'A1B2C3D4' }));
    const clash = await send('POST', '/api/pvp/battle-groups', withCodes([team('A', 38), team('C', 39)], { formationId: 'A1B2C3D4' }));
    expect(clash.status).toBe(400);
    expect((await clash.json()).error).toMatch(/^Side A: A1B2C3D4 is stored with other units or tiles/);
    expect(count('SELECT count(*) FROM battle')).toBe(1);
  });

  it('refuses another artifact on a team the code already has one for', async () => {
    db.prepare("INSERT INTO artifact (name, grp) VALUES ('Candlestick', 'Pre-Season'), ('Tidesurge', 'Pre-Season')").run();
    await send('POST', '/api/pvp/battle-groups', withCodes([team('A', 38, 'Candlestick')], { formationId: 'A1B2C3D4' }));
    const clash = await send('POST', '/api/pvp/battle-groups', withCodes([team('A', 38, 'Tidesurge')], { formationId: 'A1B2C3D4' }));
    expect((await clash.json()).error).toMatch(/stored with Candlestick on team 1, not Tidesurge/);
  });

  it('extends a code when the battle is edited with more teams, keeps the team numbers, and clears it when left out', async () => {
    const created = await json(send('POST', '/api/pvp/battle-groups', withCodes([team('A', 38)], { formationId: 'A1B2C3D4' })));
    const url = `/api/pvp/battle-groups/${created.id}`;
    const edited = await json(send('PUT', url, withCodes([{ ...team('A', 38), position: 1 }, { ...team('C', 40), position: 3 }], { formationId: 'A1B2C3D4' })));
    expect(edited.fights.map((f: any) => f.battleFormationId)).toEqual(['A1B2C3D4', 'A1B2C3D4']);
    expect((await library())[0].deployment.teams.map((t: any) => t?.units[0].hero ?? null)).toEqual(['A', null, 'C']);
    const cleared = await json(send('PUT', url, withCodes([team('A', 38)])));
    expect(cleared.fights[0].battleFormationId).toBeNull();
    expect((await library())[0].records).toBe(0);
  });

  it('suggests a code for the first teams placed, and for the whole battle turned upside down', async () => {
    await send('POST', '/api/pvp/battle-groups', withCodes([team('A', 38), team('B', 39)], { formationId: 'A1B2C3D4' }));
    const find = (teams: unknown[]) => json(send('POST', '/api/formation-ids/find', { teams }));
    const placed = (hero: string, tile: number) => ({ heroes: [{ hero, tile }] });
    expect(await find([placed('A', 38)])).toMatchObject([{ code: 'A1B2C3D4', match: 'same' }]);
    expect(await find([placed('A', 38), placed('B', 39)])).toMatchObject([{ match: 'same' }]);
    expect(await find([placed('A', 6), placed('B', 5)])).toMatchObject([{ match: 'rotated' }]);
    expect(await find([placed('A', 38), placed('B', 5)])).toEqual([]); // one team turned and the other not
  });

  it('keeps the code of the battle when one of its fights is edited alone, and takes none for that fight', async () => {
    const created = await json(send('POST', '/api/pvp/battle-groups', withCodes([team('A', 38), team('B', 39)], { formationId: 'A1B2C3D4' })));
    const typed = { ...team('A', 38), mode: 'Supreme Arena' } as any;
    typed.formation.formationId = 'ZZZZ9999';
    const saved = await send('PUT', `/api/pvp/battles/${created.fights[0].id}`, typed);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ battleFormationId: 'A1B2C3D4', formation: { formationId: null } });
    expect((await library()).map((e: any) => e.code)).toEqual(['A1B2C3D4']);
  });
});
