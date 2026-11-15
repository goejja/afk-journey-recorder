import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { checkFactionRequirement, checkUnits, heroCount } from '../../src/domain/units.js';
import { heroStats } from '../../src/query/index.js';
import { createApp } from '../../src/server/app.js';

describe('checkFactionRequirement (ADR 0029)', () => {
  const factions = new Map([
    ['A', 'Lightbearer'],
    ['B', 'Lightbearer'],
    ['C', 'Wilder'],
    ['D', 'Lightbearer'],
  ]);

  it('wants three heroes of the phantimal’s own faction', () => {
    expect(checkFactionRequirement([{ hero: 'A' }, { hero: 'B' }, { hero: 'D' }], 'Gervan', 'Lightbearer', factions)).toBeNull();
    expect(checkFactionRequirement([{ hero: 'A' }, { hero: 'B' }, { hero: 'C' }], 'Gervan', 'Lightbearer', factions)).toBe(
      'Gervan needs 3 Lightbearer heroes; this team has 2',
    );
  });

  it('counts a pair once and summons not at all, since their rows name their owner', () => {
    expect(checkFactionRequirement([{ hero: 'A' }, { hero: 'A' }, { hero: 'B' }], 'Gervan', 'Lightbearer', factions)).toBe(
      'Gervan needs 3 Lightbearer heroes; this team has 2',
    );
    const zanie = [{ hero: 'A' }, { hero: 'A', part: 'Laser Turret' }, { hero: 'A', part: 'Laser Turret' }, { hero: 'B' }, { hero: 'C' }];
    expect(checkFactionRequirement(zanie, 'Gervan', 'Lightbearer', factions)).toBe('Gervan needs 3 Lightbearer heroes; this team has 2');
  });

  it('accepts Celestial and Hypogean together for a Celestial-Hypogean phantimal', () => {
    const wedges = new Map([
      ['X', 'Celestial'],
      ['Y', 'Hypogean'],
      ['Z', 'Hypogean'],
      ['W', 'Wilder'],
    ]);
    expect(checkFactionRequirement([{ hero: 'X' }, { hero: 'Y' }, { hero: 'Z' }], 'Wedge of Matter', 'Celestial-Hypogean', wedges)).toBeNull();
    expect(checkFactionRequirement([{ hero: 'X' }, { hero: 'W' }], 'Wedge of Matter', 'Celestial-Hypogean', wedges)).toBe(
      'Wedge of Matter needs 3 Celestial or Hypogean heroes; this team has 1',
    );
  });

  it('does not check a phantimal whose faction is unknown', () => {
    expect(checkFactionRequirement([{ hero: 'C' }], 'Mystery', null, factions)).toBeNull();
  });
});

describe('checkUnits', () => {
  it('accepts a hero standing alone, a pair on two tiles and a hero with all its summons', () => {
    expect(checkUnits([{ hero: 'A' }, { hero: 'B', part: '' }])).toBeNull();
    expect(checkUnits([{ hero: 'Elijah & Lailah', part: 'Elijah' }, { hero: 'Elijah & Lailah', part: 'Lailah' }])).toBeNull();
    expect(checkUnits([{ hero: 'Zanie' }, { hero: 'Zanie', part: 'Laser Turret' }, { hero: 'Zanie', part: 'Laser Turret' }])).toBeNull();
    expect(checkUnits([{ hero: 'Phraesto' }, { hero: 'Phraesto', part: 'Phraesto clone' }])).toBeNull();
  });

  it('wants every summon of a hero: two turrets for Zanie, one clone for Phraesto', () => {
    expect(checkUnits([{ hero: 'Zanie' }])).toBe('Zanie brings 2 Laser Turret; place all');
    expect(checkUnits([{ hero: 'Zanie' }, { hero: 'Zanie', part: 'Laser Turret' }])).toBe('Zanie brings 2 Laser Turret; place all');
    expect(checkUnits([{ hero: 'Phraesto' }])).toBe('Phraesto brings 1 Phraesto clone; place it');
    const two = [{ hero: 'Phraesto' }, { hero: 'Phraesto', part: 'Phraesto clone' }, { hero: 'Phraesto', part: 'Phraesto clone' }];
    expect(checkUnits(two)).toBe('Phraesto has at most 1 Phraesto clone');
  });

  it('wants both parts of a pair, and no more than two turrets', () => {
    expect(checkUnits([{ hero: 'Elijah & Lailah', part: 'Elijah' }])).toBe('Elijah & Lailah stands as Elijah and Lailah; place both');
    expect(checkUnits([{ hero: 'Elijah & Lailah' }])).toBe('Elijah & Lailah stands as Elijah and Lailah; place both');
    const turrets = [{ hero: 'Zanie' }, ...[1, 2, 3].map(() => ({ hero: 'Zanie', part: 'Laser Turret' }))];
    expect(checkUnits(turrets)).toBe('Zanie has at most 2 Laser Turret');
  });

  it('keeps a turret with its owner and a hero from being placed twice', () => {
    expect(checkUnits([{ hero: 'Zanie', part: 'Laser Turret' }])).toBe('Laser Turret needs Zanie on the map');
    expect(checkUnits([{ hero: 'A', part: 'Laser Turret' }])).toBe('A has no Laser Turret');
    expect(checkUnits([{ hero: 'A' }, { hero: 'A' }])).toBe('A is placed twice');
  });

  it('counts a pair once and turrets not at all', () => {
    expect(heroCount([{ hero: 'Zanie' }, { hero: 'Zanie' }, { hero: 'Elijah & Lailah' }, { hero: 'Elijah & Lailah' }])).toBe(2);
  });
});

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Stage\",\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of ['A', 'B', 'X', 'Zanie', 'Elijah & Lailah']) db.prepare('INSERT INTO hero (name, tier) VALUES (?, ?)').run(name, 'S');
  db.prepare("INSERT INTO rank (name, position) VALUES ('Mythic+', 2)").run();
  app = createApp(db);
});

const post = (url: string, body: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const battle = (a: object[], b: object[]) =>
  post('/api/pvp/battles', {
    mode: 'Arena', mapName: 'Open', outcome: 'Win',
    formation: { heroes: a, phantimal: null, assistHero: null, artifact: null}, opponent: { heroes: b },
  });

describe('units in battles', () => {
  const twins = (tile: number) => [
    { tile, hero: 'Elijah & Lailah', part: 'Elijah' },
    { tile: tile + 1, hero: 'Elijah & Lailah', part: 'Lailah' },
  ];

  it('saves a pair on two tiles and turrets without rank or equipment, and counts each hero once', async () => {
    const res = await battle(
      [...twins(38), { tile: 40, hero: 'Zanie', rank: 'Mythic+' }, { tile: 41, hero: 'Zanie', part: 'Laser Turret', rank: 'Mythic+', equipmentLevel: 10 }, { tile: 42, hero: 'Zanie', part: 'Laser Turret' }],
      [{ tile: 0, hero: 'X' }],
    );
    expect(res.status).toBe(201);
    const saved = (await res.json()) as any;
    expect(saved.formation.heroes.map((h: any) => [h.tile, h.name, h.part, h.rank])).toEqual([
      [38, 'Elijah & Lailah', 'Elijah', null], [39, 'Elijah & Lailah', 'Lailah', null], [40, 'Zanie', '', 'Mythic+'], [41, 'Zanie', 'Laser Turret', null], [42, 'Zanie', 'Laser Turret', null],
    ]);
    const stats = Object.fromEntries((heroStats(db) as any[]).map((r) => [r.hero, r.games]));
    expect(stats).toEqual({ 'Elijah & Lailah': 1, Zanie: 1, X: 1 });
  });

  it('refuses half a pair, a third turret and a turret without its owner', async () => {
    expect((await battle([{ tile: 38, hero: 'Elijah & Lailah', part: 'Elijah' }], [{ tile: 0, hero: 'X' }])).status).toBe(400);
    const three = [{ tile: 38, hero: 'Zanie' }, ...[39, 40, 41].map((tile) => ({ tile, hero: 'Zanie', part: 'Laser Turret' }))];
    expect((await battle(three, [{ tile: 0, hero: 'X' }])).status).toBe(400);
    expect((await battle([{ tile: 38, hero: 'A' }, { tile: 39, hero: 'Zanie', part: 'Laser Turret' }], [{ tile: 0, hero: 'X' }])).status).toBe(400);
  });

  it('puts a pair on the enemy side too, and counts it as one of five heroes', async () => {
    const enemy = [{ tile: 0, hero: 'Elijah & Lailah', part: 'Elijah' }, { tile: 1, hero: 'Elijah & Lailah', part: 'Lailah' }, { tile: 2, hero: 'X' }];
    expect((await battle([{ tile: 38, hero: 'A' }], enemy)).status).toBe(201);
  });

  it('plans a scenario with a pair, keeping the unit', async () => {
    const res = await post('/api/scenarios', {
      name: 'S', mode: 'Arena',
      slots: [{ mapName: 'Open', mine: [], enemy: [...twins(0), { tile: 2, hero: 'Zanie' }, { tile: 3, hero: 'Zanie', part: 'Laser Turret' }, { tile: 4, hero: 'Zanie', part: 'Laser Turret' }] }],
    });
    expect(res.status).toBe(201);
    const scenario = (await res.json()) as any;
    expect(scenario.slots[0].enemy.map((h: any) => [h.name, h.part])).toEqual([
      ['Elijah & Lailah', 'Elijah'], ['Elijah & Lailah', 'Lailah'], ['Zanie', ''], ['Zanie', 'Laser Turret'], ['Zanie', 'Laser Turret'],
    ]);
  });
});
