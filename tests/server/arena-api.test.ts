import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const names = ['A', 'B', 'C', 'H'];

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Duel', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of names) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  for (const [rank, i] of [['Mythic', 1], ['Mythic+', 2]] as const) db.prepare('INSERT INTO rank (name, position) VALUES (?, ?)').run(rank, i);
  for (const name of ['A', 'B', 'C']) db.prepare('INSERT INTO roster (hero_name, rank) VALUES (?, ?)').run(name, 'Mythic');
  db.prepare("INSERT INTO boss_rule (name) VALUES ('Berserk')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;

const battle = (mine: string[], extra: object = {}) => ({
  mode: 'Arena',
  mapName: 'Duel',
  outcome: 'Win',
  formation: { heroes: mine.map((hero, i) => ({ tile: 38 + i, hero })), phantimal: null, assistHero: null, artifact: null},
  opponent: { heroes: [{ tile: 0, hero: 'H' }] },
  ...extra,
});

describe('arena battles', () => {
  it('records a standalone battle with an opponent whose rank and artifact are unknown', async () => {
    const response = await send('POST', '/api/pvp/battles', battle(['A', 'B'], { mode: 'Supreme Arena', rule: 'Berserk' }));
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved).toMatchObject({ mode: 'Supreme Arena', mapName: 'Duel', rule: 'Berserk', outcome: 'Win', opponent: { heroes: [{ tile: 0, name: 'H', rank: null }] } });
    expect(saved.formation.heroes.map((h: any) => [h.name, h.rank])).toEqual([['A', null], ['B', null]]); // never taken from the roster
  });

  it('lets either side use any hero, not only roster heroes, with the state that was entered', async () => {
    const body = battle(['H']);
    body.formation.heroes[0] = { tile: 38, hero: 'H', rank: 'Mythic+', equipmentLevel: null } as never;
    body.opponent = { heroes: [{ tile: 0, hero: 'A' }] } as never; // A is in the roster, which does not matter here
    const saved = await json(send('POST', '/api/pvp/battles', body));
    expect(saved.formation.heroes).toEqual([{ tile: 38, name: 'H', part: '', rank: 'Mythic+', equipmentLevel: null }]);
  });

  it('records a phantimal on each side, from any season, when three heroes share its faction', async () => {
    db.prepare("INSERT INTO phantimal (name, faction, class) VALUES ('Gervan', 'Lightbearer', 'Mage')").run();
    db.prepare("UPDATE hero SET faction = 'Lightbearer' WHERE name IN ('A', 'B', 'C')").run();
    const body = battle(['A', 'B', 'C'], { mode: 'Supreme Arena' });
    body.formation.phantimal = { tile: 41, name: 'Gervan' } as never;
    (body.opponent as any) = { heroes: [{ tile: 2, hero: 'A' }, { tile: 3, hero: 'B' }, { tile: 4, hero: 'C' }], phantimal: { tile: 1, name: 'Gervan' } };
    const response = await send('POST', '/api/pvp/battles', body);
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved.formation.phantimal).toEqual({ name: 'Gervan', tile: 41 });
    expect(saved.opponent.phantimal).toEqual({ name: 'Gervan', tile: 1 });
  });

  it('refuses a phantimal whose faction the team does not field', async () => {
    db.prepare("INSERT INTO phantimal (name, faction, class) VALUES ('Gervan', 'Lightbearer', 'Mage')").run();
    db.prepare("UPDATE hero SET faction = 'Wilder' WHERE name IN ('A', 'B')").run();
    const body = battle(['A', 'B'], { mode: 'Supreme Arena' });
    body.formation.phantimal = { tile: 41, name: 'Gervan' } as never;
    const response = await send('POST', '/api/pvp/battles', body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Gervan needs 3 Lightbearer heroes; this team has 0' });
  });

  it('never lets Arena hold a phantimal, while Treasure Rush does', async () => {
    db.prepare("INSERT INTO phantimal (name, faction, class) VALUES ('Gervan', 'Lightbearer', 'Mage')").run();
    db.prepare("UPDATE hero SET faction = 'Lightbearer' WHERE name IN ('A', 'B', 'C')").run();
    const arena = battle(['A', 'B', 'C'], { mode: 'Arena' });
    arena.formation.phantimal = { tile: 41, name: 'Gervan' } as never;
    expect((await send('POST', '/api/pvp/battles', arena)).status).toBe(400);
    const treasure = battle(['A', 'B', 'C'], { mode: 'Treasure Rush', mapName: 'Arena I' });
    treasure.formation.phantimal = { tile: 41, name: 'Gervan' } as never;
    db.prepare("INSERT OR IGNORE INTO map (name, tags, row_lengths, cells, source) VALUES ('Arena I', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
    expect((await send('POST', '/api/pvp/battles', treasure)).status).toBe(201);
  });

  it('records the Celestial wedges on two tiles per side, and refuses one without the other', async () => {
    db.prepare("INSERT INTO phantimal (name, faction, class) VALUES ('Wedge of Matter', 'Celestial-Hypogean', 'Support'), ('Wedge of Power', 'Celestial-Hypogean', 'Support')").run();
    db.prepare("UPDATE hero SET faction = 'Celestial' WHERE name IN ('A', 'B')").run();
    db.prepare("UPDATE hero SET faction = 'Hypogean' WHERE name = 'C'").run();
    const body = battle(['A', 'B', 'C'], { mode: 'Supreme Arena' });
    body.formation.phantimal = { tile: 41, name: 'Wedge of Matter', partnerTile: 42 } as never;
    (body.opponent as any) = { heroes: [{ tile: 2, hero: 'A' }, { tile: 3, hero: 'B' }, { tile: 4, hero: 'C' }], phantimal: { tile: 0, name: 'Wedge of Matter', partnerTile: 1 } };
    const response = await send('POST', '/api/pvp/battles', body);
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved.formation.phantimal).toEqual({ name: 'Wedge of Matter', tile: 41, partnerTile: 42 });
    expect(saved.opponent.phantimal).toEqual({ name: 'Wedge of Matter', tile: 0, partnerTile: 1 });

    const base = () => battle(['A', 'B', 'C'], { mode: 'Supreme Arena' });
    const alone = base();
    alone.formation.phantimal = { tile: 41, name: 'Wedge of Matter' } as never;
    expect((await send('POST', '/api/pvp/battles', alone)).status).toBe(400);
    const enemyAlone = base();
    (enemyAlone.opponent as any) = { heroes: [{ tile: 2, hero: 'A' }, { tile: 3, hero: 'B' }, { tile: 4, hero: 'C' }], phantimal: { tile: 0, name: 'Wedge of Matter' } };
    expect((await send('POST', '/api/pvp/battles', enemyAlone)).status).toBe(400);
    const sameTile = base();
    (sameTile.opponent as any) = { heroes: [{ tile: 2, hero: 'A' }, { tile: 3, hero: 'B' }, { tile: 4, hero: 'C' }], phantimal: { tile: 0, name: 'Wedge of Matter', partnerTile: 0 } };
    expect((await send('POST', '/api/pvp/battles', sameTile)).status).toBe(400);
    const wrongSide = base();
    (wrongSide.opponent as any) = { heroes: [{ tile: 2, hero: 'A' }, { tile: 3, hero: 'B' }, { tile: 4, hero: 'C' }], phantimal: { tile: 0, name: 'Wedge of Matter', partnerTile: 41 } };
    expect((await send('POST', '/api/pvp/battles', wrongSide)).status).toBe(400);
  });

  it('refuses a second tile for a phantimal that stands on one, and keeps an older lone wedge valid', async () => {
    db.prepare("INSERT INTO phantimal (name, faction, class) VALUES ('Gervan', 'Lightbearer', 'Mage'), ('Wedge of Power', 'Celestial-Hypogean', 'Support')").run();
    db.prepare("UPDATE hero SET faction = 'Lightbearer' WHERE name IN ('A', 'B', 'C')").run();
    const two = battle(['A', 'B', 'C'], { mode: 'Supreme Arena' });
    (two.opponent as any) = { heroes: [{ tile: 2, hero: 'A' }, { tile: 3, hero: 'B' }, { tile: 4, hero: 'C' }], phantimal: { tile: 0, name: 'Gervan', partnerTile: 1 } };
    expect((await send('POST', '/api/pvp/battles', two)).status).toBe(400);
    db.prepare("UPDATE hero SET faction = 'Celestial' WHERE name IN ('A', 'B', 'C')").run();
    const lone = battle(['A', 'B', 'C'], { mode: 'Supreme Arena' });
    (lone.opponent as any) = { heroes: [{ tile: 2, hero: 'A' }, { tile: 3, hero: 'B' }, { tile: 4, hero: 'C' }], phantimal: { tile: 0, name: 'Wedge of Power' } };
    expect((await send('POST', '/api/pvp/battles', lone)).status).toBe(201);
  });

  it('refuses a Side B phantimal that is unknown, off the enemy tiles, or on a used tile', async () => {
    db.prepare("INSERT INTO phantimal (name, faction, class) VALUES ('Gervan', 'Lightbearer', 'Mage')").run();
    db.prepare("UPDATE hero SET faction = 'Lightbearer' WHERE name IN ('A', 'B', 'C')").run();
    for (const phantimal of [{ tile: 1, name: 'Nobody' }, { tile: 39, name: 'Gervan' }, { tile: 0, name: 'Gervan' }]) {
      const body = battle(['A', 'B', 'C'], { mode: 'Supreme Arena' });
      (body.opponent as any) = { heroes: [{ tile: 0, hero: 'A' }, { tile: 2, hero: 'B' }, { tile: 3, hero: 'C' }], phantimal };
      expect((await send('POST', '/api/pvp/battles', body)).status).toBe(400);
    }
  });

  it('allows the same hero in several battles', async () => {
    expect((await send('POST', '/api/pvp/battles', battle(['A']))).status).toBe(201);
    expect((await send('POST', '/api/pvp/battles', battle(['A']))).status).toBe(201);
  });

  it('lists battles newest first and filters by mode', async () => {
    await send('POST', '/api/pvp/battles', battle(['A']));
    await send('POST', '/api/pvp/battles', battle(['B'], { mode: 'Super League' }));
    expect((await json(send('GET', '/api/pvp/battles'))).map((b: any) => b.mode)).toEqual(['Super League', 'Arena']);
    expect(await json(send('GET', '/api/pvp/battles?mode=Arena'))).toHaveLength(1);
  });

  it('only allows a rule in Supreme Arena', async () => {
    const response = await send('POST', '/api/pvp/battles', battle(['A'], { rule: 'Berserk' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Supreme Arena/);
  });

  it('rejects a non-Arena map, an unknown rule, an unknown mode and a bad opponent', async () => {
    const post = (extra: object) => send('POST', '/api/pvp/battles', battle(['A'], extra));
    expect((await post({ mapName: 'Open' })).status).toBe(400);
    expect((await post({ mode: 'Supreme Arena', rule: 'Nope' })).status).toBe(400);
    expect((await post({ mode: 'Chess' })).status).toBe(400);
    expect((await post({ opponent: { heroes: [{ tile: 40, hero: 'H' }] } })).status).toBe(400);
    expect((await post({ opponent: { heroes: [{ tile: 0, hero: 'H', rank: 'Nonsense' }] } })).status).toBe(400);
    expect((await post({ opponent: { heroes: [] } })).status).toBe(400);
  });

  it('edits a battle in place, keeping the rank entered for a hero that stays', async () => {
    const created = await json(send('POST', '/api/pvp/battles', battle(['A', 'B'])));
    const body = battle(['A', 'C'], { outcome: 'Loss', note: 'misclick' });
    body.formation.heroes[0] = { tile: 38, hero: 'A', rank: 'Mythic', equipmentLevel: null } as never;
    const edited = await json(send('PUT', `/api/pvp/battles/${created.id}`, body));
    expect(edited).toMatchObject({ id: created.id, outcome: 'Loss', note: 'misclick' });
    expect(edited.formation.heroes.map((h: any) => [h.name, h.rank])).toEqual([['A', 'Mythic'], ['C', null]]);
    expect(await json(send('GET', '/api/pvp/battles'))).toHaveLength(1);
  });

  it('refuses to edit an unknown battle, an invalid state, and keeps the rule from a non-Supreme edit', async () => {
    expect((await send('PUT', '/api/pvp/battles/999', battle(['A']))).status).toBe(404);
    const created = await json(send('POST', '/api/pvp/battles', battle(['A'])));
    const bad = battle(['A']);
    bad.formation.heroes[0] = { tile: 38, hero: 'A', rank: 'Nonsense' } as never;
    expect((await send('PUT', `/api/pvp/battles/${created.id}`, bad)).status).toBe(400);
    expect((await send('PUT', `/api/pvp/battles/${created.id}`, battle(['A'], { rule: 'Berserk' }))).status).toBe(400);
  });

  it('deletes a battle with the generic endpoint and keeps a rule in use from being deleted', async () => {
    const created = await json(send('POST', '/api/pvp/battles', battle(['A'], { mode: 'Supreme Arena', rule: 'Berserk' })));
    expect((await send('DELETE', '/api/boss-rules/Berserk')).status).toBe(409);
    expect((await send('DELETE', `/api/attempts/${created.id}`)).status).toBe(204);
    expect(db.prepare('SELECT count(*) FROM arena_attempt').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM arena_opponent_hero').pluck().get()).toBe(0);
  });
});

describe('formation ids', () => {
  const withId = (mine: string[], mineId: string | undefined, theirId?: string, extra: object = {}) => {
    const body = battle(mine, extra) as any;
    body.formation.formationId = mineId;
    body.opponent.formationId = theirId;
    return body;
  };

  it('stores the code of each side in the library with its deployment and the map, and shows it on the record', async () => {
    const saved = await json(send('POST', '/api/pvp/battles', withId(['A', 'B'], 'a1b2c3d4', 'ZZZZ9999')));
    expect(saved.formation.formationId).toBe('A1B2C3D4');
    expect(saved.opponent.formationId).toBe('ZZZZ9999');
    const library = await json(send('GET', '/api/formation-ids'));
    expect(library.map((e: any) => [e.code, e.maps, e.records])).toEqual([['A1B2C3D4', ['Duel'], 1], ['ZZZZ9999', ['Duel'], 1]]);
    expect(library[0].deployment.teams).toHaveLength(1);
    expect(library[0].deployment.teams[0].units.map((u: any) => [u.hero, u.tile])).toEqual([['A', 38], ['B', 39]]);
  });

  it('keeps the code when the record is deleted', async () => {
    const saved = await json(send('POST', '/api/pvp/battles', withId(['A'], 'A1B2C3D4')));
    await send('DELETE', `/api/attempts/${saved.id}`);
    const library = await json(send('GET', '/api/formation-ids'));
    expect(library).toMatchObject([{ code: 'A1B2C3D4', records: 0 }]);
  });

  it('refuses a malformed code and a known code on other units, and saves nothing', async () => {
    expect((await send('POST', '/api/pvp/battles', withId(['A'], 'nope'))).status).toBe(400);
    await send('POST', '/api/pvp/battles', withId(['A', 'B'], 'A1B2C3D4'));
    const clash = await send('POST', '/api/pvp/battles', withId(['A', 'C'], 'A1B2C3D4'));
    expect(clash.status).toBe(400);
    expect((await clash.json()).error).toMatch(/A1B2C3D4 is stored with other units or tiles/);
    expect(db.prepare('SELECT count(*) FROM attempt').pluck().get()).toBe(1);
  });

  it('adds and deletes codes by hand', async () => {
    const layout = { units: [{ kind: 'hero', hero: 'A', part: '', tile: 38 }] };
    const deployment = { teams: [{ ...layout, artifact: null }] };
    expect((await send('POST', '/api/formation-ids', { code: 'a1b2c3d4', deployment })).status).toBe(201);
    expect((await send('POST', '/api/formation-ids', { code: 'A1B2C3D4', deployment })).status).toBe(409);
    expect((await send('POST', '/api/formation-ids', { code: 'bad', deployment })).status).toBe(400);
    expect((await send('DELETE', '/api/formation-ids/A1B2C3D4')).status).toBe(204);
    expect((await send('DELETE', '/api/formation-ids/A1B2C3D4')).status).toBe(404);
  });

  it('refuses a code by hand whose units break the rules of units or share a tile', async () => {
    const add = (units: any[], phantimal: any = null) => send('POST', '/api/formation-ids', { code: 'A1B2C3D4', deployment: { teams: [{ units: units.map((u) => ({ kind: 'hero', ...u })), phantimal }] } });
    const half = await add([{ hero: 'Elijah & Lailah', part: 'Elijah', tile: 38 }]);
    expect(half.status).toBe(400);
    expect(await half.json()).toEqual({ error: 'Elijah & Lailah stands as Elijah and Lailah; place both' });
    expect((await add([{ hero: 'Phraesto', part: '', tile: 38 }])).status).toBe(400);
    expect((await add([{ hero: 'A', part: '', tile: 38 }, { hero: 'B', part: '', tile: 38 }])).status).toBe(400);
    expect((await add([{ hero: 'A', part: '', tile: 45 }])).status).toBe(400);
    expect((await add([{ hero: 'A', part: '', tile: 38 }], { name: 'Wedge of Matter', tile: 39, partnerTile: null })).status).toBe(400);
    expect((await add([{ hero: 'A', part: '', tile: 38 }], { name: 'Wedge of Matter', tile: 38, partnerTile: 39 })).status).toBe(400);
    const whole = [{ hero: 'Phraesto', part: '', tile: 38 }, { hero: 'Phraesto', part: 'Phraesto clone', tile: 39 }];
    expect((await add(whole, { name: 'Wedge of Matter', tile: 40, partnerTile: 41 })).status).toBe(201);
  });
});
