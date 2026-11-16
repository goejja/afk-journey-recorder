import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { PAIR_HEROES, SUMMONS, UNIT_OWNERS } from '../../src/domain/units.js';
import { createApp } from '../../src/server/app.js';

let db: Database.Database;
let app: Hono;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type, image_path, source) VALUES ('Alna', 'S', 'Mage', 'Wilder', 'Magic', 'images/heroes/Alna.png', 'import')").run();
  app = createApp(db);
});

const send = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const thane = { name: ' Thane ', tier: 'S', class: 'Warrior', faction: 'Lightbearer', damageType: 'Physical' };
const list = async () => (await (await send('GET', '/api/admin/heroes')).json()) as any[];
const error = async (response: Response) => ((await response.json()) as { error: string }).error;

describe('hero admin API', () => {
  it('seeds the PVP Tier hints from Prydwen, under the database spellings, and leaves unrated heroes without one', async () => {
    db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type) VALUES ('Elijah & Lailah', 'S', 'Support', 'Celestial', 'Magic'), ('Thane', 'S', 'Warrior', 'Lightbearer', 'Physical')").run();
    const heroes = await list();
    expect(heroes.find((h) => h.name === 'Alna')).toMatchObject({ pvpTier: 'S+', pvpRole: 'Tank', pvpSetOn: '2026-11-13', pvpSource: 'prydwen' });
    expect(heroes.find((h) => h.name === 'Elijah & Lailah')).toMatchObject({ pvpTier: 'S', pvpRole: 'Support' });
    expect(heroes.find((h) => h.name === 'Thane')).toMatchObject({ pvpTier: null, pvpRole: null, pvpSetOn: null, pvpSource: null });
    expect(db.prepare('SELECT count(*) FROM hero_pvp_hint').pluck().get()).toBe(129);
  });

  it('keeps range, energy and mechanic tags apart from the hero: dated, manual, tags sorted and unique, and the hero stays imported', async () => {
    expect((await list()).find((h) => h.name === 'Alna')).toMatchObject({ attributes: null });
    const body = { range: 1, energy: [0, 200], mechanics: ['Dot', 'execute', 'dot'], releasedInSeason: 5 };
    const response = await send('PUT', '/api/admin/heroes/Alna/attributes', body);
    const today = db.prepare("SELECT date('now', 'localtime')").pluck().get();
    expect(await response.json()).toMatchObject({ name: 'Alna', source: 'import', attributes: { range: 1, energy: [0, 200], mechanics: ['dot', 'execute'], releasedInSeason: 5, setOn: today, source: 'manual' } });
    expect(await error(await send('PUT', '/api/admin/heroes/Alna/attributes', { ...body, range: -1 }))).toContain('Range cannot be negative');
    expect((await send('PUT', '/api/admin/heroes/Nobody/attributes', body)).status).toBe(404);
    // an empty form removes the row, and a deleted hero takes its attributes with it
    await send('PUT', '/api/admin/heroes/Alna/attributes', { range: null, energy: [], mechanics: [], releasedInSeason: null });
    expect(db.prepare('SELECT count(*) FROM hero_attribute').pluck().get()).toBe(0);
    await send('PUT', '/api/admin/heroes/Alna/attributes', body);
    expect((await send('DELETE', '/api/admin/heroes/Alna')).status).toBe(204);
    expect(db.prepare('SELECT count(*) FROM hero_attribute').pluck().get()).toBe(0);
  });

  it('keeps the player\'s PVP Tier hint apart from the hero: it is dated, manual and leaves the hero as imported', async () => {
    const response = await send('PUT', '/api/admin/heroes/Alna/pvp-hint', { pvpTier: 'B', pvpRole: 'Tank' });
    expect(await response.json()).toMatchObject({ name: 'Alna', pvpTier: 'B', pvpRole: 'Tank', pvpSource: 'manual', source: 'import' });
    expect(db.prepare("SELECT set_on FROM hero_pvp_hint WHERE hero = 'Alna'").pluck().get()).toBe(db.prepare("SELECT date('now', 'localtime')").pluck().get());
    expect(await error(await send('PUT', '/api/admin/heroes/Alna/pvp-hint', { pvpTier: 'Z', pvpRole: null }))).toContain('PVP tier must be one of');
    expect((await send('PUT', '/api/admin/heroes/Nobody/pvp-hint', { pvpTier: 'B', pvpRole: null })).status).toBe(404);
    // saving the same hint again changes nothing, and clearing both removes it
    await send('PUT', '/api/admin/heroes/Alna/pvp-hint', { pvpTier: 'B', pvpRole: 'Tank' });
    expect(await (await send('PUT', '/api/admin/heroes/Alna/pvp-hint', { pvpTier: null, pvpRole: null })).json()).toMatchObject({ pvpTier: null, pvpSetOn: null });
  });

  it('lists the Placement Rules, adds one as the player\'s own, and refuses a second rule for the same relation', async () => {
    db.prepare("INSERT INTO placement_rule (hero, relation, effect, wants_role, note, source) VALUES ('Pandora', 'rearmost', 'protects', 'Damage dealer', 'test rule', 'manual')").run();
    const rules = async () => (await (await send('GET', '/api/admin/placement-rules')).json()) as any[];
    expect((await rules()).find((r) => r.hero === 'Pandora')).toMatchObject({ relation: 'rearmost', effect: 'protects', wantsRole: 'Damage dealer', source: 'manual', enabled: true });
    const made = await send('POST', '/api/admin/heroes/Alna/placement-rules', { relation: 'behind', effect: 'boosts', wantsRole: 'Support', note: ' my note ', enabled: true });
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ hero: 'Alna', relation: 'behind', effect: 'boosts', wantsRole: 'Support', note: 'my note', source: 'manual' });
    expect(await error(await send('POST', '/api/admin/heroes/Alna/placement-rules', { relation: 'behind', effect: 'other', wantsRole: null, enabled: true }))).toMatch(/already has a rule for behind/);
    expect((await send('POST', '/api/admin/heroes/Nobody/placement-rules', { relation: 'behind', effect: 'other', wantsRole: null, enabled: true })).status).toBe(404);
    expect((await send('POST', '/api/admin/heroes/Alna/placement-rules', { relation: 'sideways', effect: 'other', wantsRole: null, enabled: true })).status).toBe(400);
  });


  it('deletes rules one by one and with their hero', async () => {
    db.prepare("INSERT INTO placement_rule (hero, relation, effect, wants_role, note, source) VALUES ('Alna', 'behind', 'other', NULL, 'test rule', 'manual')").run();
    const id = db.prepare("SELECT id FROM placement_rule WHERE hero = 'Alna'").pluck().get() as number;
    expect((await send('DELETE', `/api/admin/placement-rules/${id}`)).status).toBe(204);
    expect((await send('DELETE', `/api/admin/placement-rules/${id}`)).status).toBe(404);
    db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type) VALUES ('Thane', 'S', 'Warrior', 'Lightbearer', 'Physical')").run();
    await send('POST', '/api/admin/heroes/Thane/placement-rules', { relation: 'mirror', effect: 'other', wantsRole: null, enabled: true });
    expect((await send('DELETE', '/api/admin/heroes/Thane')).status).toBe(204);
    expect(db.prepare("SELECT count(*) FROM placement_rule WHERE hero = 'Thane'").pluck().get()).toBe(0);
  });

  it('removes the hint with the hero', async () => {
    db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type) VALUES ('Thane', 'S', 'Warrior', 'Lightbearer', 'Physical')").run();
    await send('PUT', '/api/admin/heroes/Thane/pvp-hint', { pvpTier: 'A', pvpRole: null });
    expect((await send('DELETE', '/api/admin/heroes/Thane')).status).toBe(204);
    expect(db.prepare("SELECT count(*) FROM hero_pvp_hint WHERE hero = 'Thane'").pluck().get()).toBe(0);
  });

  it('lists the heroes with their info and the units they bring', async () => {
    db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type) VALUES ('Zanie', 'S', 'Marksman', 'Mauler', 'Physical')").run();
    expect((await list()).map((h) => h.name)).toEqual(['Alna', 'Zanie']);
    expect((await list())[1]).toMatchObject({ name: 'Zanie', summon: { part: 'Laser Turret', count: 2 }, pair: null });
    expect((await list())[0]).toMatchObject({ name: 'Alna', damageType: 'Magic', source: 'import', pair: null, summon: null });
  });

  it('creates a hero as the player\'s own, with no image path, and says nothing is needed from the importer', async () => {
    const response = await send('POST', '/api/admin/heroes', thane);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: 'Thane', tier: 'S', class: 'Warrior', faction: 'Lightbearer', damageType: 'Physical', source: 'manual' });
    expect(db.prepare("SELECT image_path FROM hero WHERE name = 'Thane'").pluck().get()).toBeNull();
  });

  it('needs all four pieces of information on a new hero, and a free name', async () => {
    expect(await error(await send('POST', '/api/admin/heroes', { ...thane, faction: null }))).toBe('A new hero needs its faction');
    expect((await send('POST', '/api/admin/heroes', { ...thane, class: 'Wizard' })).status).toBe(400);
    expect((await send('POST', '/api/admin/heroes', { ...thane, name: 'a,b' })).status).toBe(400);
    expect((await send('POST', '/api/admin/heroes', { ...thane, name: 'ALNA' })).status).toBe(409);
    expect((await send('POST', '/api/admin/heroes', { ...thane, name: 'Elijah' })).status).toBe(409); // a part of a pair
  });

  it('edits the information, makes an imported hero the player\'s own and never renames', async () => {
    const response = await send('PUT', '/api/admin/heroes/Alna', { name: 'Other', tier: 'A', class: 'Mage', faction: 'Wilder', damageType: 'Magic' });
    expect(await response.json()).toMatchObject({ name: 'Alna', tier: 'A', source: 'manual' });
    expect(await list()).toHaveLength(1);
  });

  it('leaves an unchanged hero as imported, and lets an old row keep a value it lacks', async () => {
    db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type) VALUES ('Old', 'R', NULL, 'Wilder', NULL)").run();
    await send('PUT', '/api/admin/heroes/Alna', { name: 'Alna', tier: 'S', class: 'Mage', faction: 'Wilder', damageType: 'Magic' });
    expect((await list())[0].source).toBe('import');
    expect((await send('PUT', '/api/admin/heroes/Old', { name: 'Old', tier: 'R', faction: 'Wilder' })).status).toBe(200);
    expect(await error(await send('PUT', '/api/admin/heroes/Alna', { name: 'Alna', tier: 'S', class: null, faction: 'Wilder', damageType: 'Magic' }))).toBe('Alna has a class; choose one');
  });

  it('declares a pair and a summoner, never both, with names nobody else has, and the code follows', async () => {
    await send('POST', '/api/admin/heroes', thane);
    const put = (body: object) => send('PUT', '/api/admin/heroes/Thane', { ...thane, ...body });
    expect((await put({ pair: { part1: 'A', part2: 'B' }, summon: { part: 'C', count: 1 } })).status).toBe(400);
    expect((await put({ pair: { part1: 'A', part2: 'a' } })).status).toBe(400);
    expect((await put({ pair: { part1: 'Alna', part2: 'B' } })).status).toBe(409);
    expect((await put({ summon: { part: 'Laser Turret', count: 1 } })).status).toBe(409);
    expect((await put({ summon: { part: 'Drone', count: 0 } })).status).toBe(400);
    expect((await put({ summon: { part: 'Drone', count: 3 } })).status).toBe(200);
    expect(SUMMONS.Thane).toEqual({ part: 'Drone', count: 3 });
    expect(UNIT_OWNERS.Drone).toBe('Thane');
    expect((await put({ summon: { part: 'Drone', count: 3 } })).status).toBe(200); // its own part is not a collision
    expect((await put({ pair: { part1: 'Thane west', part2: 'Thane east' } })).status).toBe(200);
    expect(SUMMONS.Thane).toBeUndefined();
    expect(PAIR_HEROES.Thane).toEqual(['Thane west', 'Thane east']);
    expect((await put({})).status).toBe(200);
    expect(PAIR_HEROES.Thane).toBeUndefined();
  });

  it('locks the units a hero brings once a record, a scenario or a Formation ID has it on a board', async () => {
    await send('POST', '/api/admin/heroes', thane);
    db.prepare("INSERT INTO attempt (id, mode, outcome) VALUES (1, 'Arena', 'Win')").run();
    db.prepare("INSERT INTO formation (id, attempt_id) VALUES (1, 1)").run();
    db.prepare("INSERT INTO formation_hero (formation_id, tile, hero_name, part) VALUES (1, 30, 'Thane', '')").run();
    const response = await send('PUT', '/api/admin/heroes/Thane', { ...thane, summon: { part: 'Drone', count: 1 } });
    expect(response.status).toBe(409);
    expect(await error(response)).toMatch(/Thane is on a board in 1 records/);
    expect((await send('PUT', '/api/admin/heroes/Thane', { ...thane, tier: 'A' })).status).toBe(200); // the information stays editable
    expect(await (await send('GET', '/api/admin/heroes/Thane/usage')).json()).toMatchObject({ records: 1, onBoard: 1 });

    await send('POST', '/api/admin/heroes', { ...thane, name: 'Mira' });
    db.prepare("INSERT INTO formation_id (code, deployment) VALUES ('ABCD1234', ?)").run(JSON.stringify({ teams: [{ units: [{ kind: 'hero', hero: 'Mira', part: '', tile: 3 }], artifact: null }] }));
    expect((await send('PUT', '/api/admin/heroes/Mira', { ...thane, name: 'Mira', summon: { part: 'Drone', count: 1 } })).status).toBe(409);
  });

  it('deletes a hero nothing uses, with its declaration, and says what blocks it otherwise', async () => {
    await send('POST', '/api/admin/heroes', { ...thane, summon: { part: 'Drone', count: 2 } });
    expect((await send('DELETE', '/api/admin/heroes/Thane')).status).toBe(204);
    expect(db.prepare('SELECT count(*) FROM hero_summon').pluck().get()).toBe(2); // Zanie's and Phraesto's
    expect(SUMMONS.Thane).toBeUndefined();
    expect((await send('DELETE', '/api/admin/heroes/Thane')).status).toBe(404);

    db.prepare("INSERT INTO roster (hero_name, profile_id) VALUES ('Alna', 1)").run();
    db.prepare("INSERT INTO hero_look (hero_name, file) VALUES ('Alna', '1.png')").run();
    const blocked = await send('DELETE', '/api/admin/heroes/Alna');
    expect(blocked.status).toBe(409);
    expect(await error(blocked)).toBe('Alna is used by 1 roster entries, 1 reader pictures, so it cannot be deleted');
    expect(await list()).toHaveLength(1);
  });
});
