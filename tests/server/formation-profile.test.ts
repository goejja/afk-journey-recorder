import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { formationProfile, formationReport } from '../../src/query/formation-profile.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;
let db: Database.Database;
const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
const HEROES = 'ABCDEFGHIJKLMNOPQRSTUV'.split('');
const MINE = ['A', 'B', 'C', 'D', 'E'];
const FOES = ['H', 'I', 'J', 'K', 'L'];
const OTHER_FOES = ['N', 'O', 'P', 'Q', 'R'];

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  for (const name of HEROES) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
  db.prepare("INSERT OR IGNORE INTO rank (name, position) VALUES ('Rare', 0), ('Mythic+', 1), ('Supreme', 2)").run();
  for (const name of ['Bladesummon', 'Candleflame']) db.prepare("INSERT INTO artifact (name, grp, source) VALUES (?, 'Pre-Season', 'manual')").run(name);
  db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Other', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
  app = createApp(db);
});

interface Side {
  heroes: string[];
  rank?: string;
  /** The tile of each hero in order, when it is not the first free ones. */
  tiles?: number[];
}
/** One fight; `mine` is Side A. */
const fight = (outcome: 'Win' | 'Loss', mine: Side | string[], foe: Side | string[], extra: Record<string, unknown> = {}, artifact: string | null = null) => {
  const a = Array.isArray(mine) ? { heroes: mine } : mine;
  const b = Array.isArray(foe) ? { heroes: foe } : foe;
  return app.request('/api/pvp/battles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'Arena',
      mapName: 'Open',
      outcome,
      formation: { heroes: a.heroes.map((hero, i) => ({ tile: a.tiles?.[i] ?? 38 + i, hero, rank: a.rank })), phantimal: null, assistHero: null, artifact},
      opponent: { heroes: b.heroes.map((hero, i) => ({ tile: b.tiles?.[i] ?? i, hero, rank: b.rank })) },
      ...extra,
    }),
  });
};
const record = async (times: number, outcome: 'Win' | 'Loss', mine: Side | string[], foe: Side | string[] = FOES, extra: Record<string, unknown> = {}, artifact: string | null = null) => {
  for (let i = 0; i < times; i += 1) await fight(outcome, mine, foe, extra, artifact);
};
const profile = (core = MINE) => formationProfile(db, core)!;

describe('the profile of a formation group', () => {
  it('is null for a core that no group has', async () => {
    await record(1, 'Win', MINE);
    expect(formationProfile(db, ['A', 'B', 'V'])).toBeNull();
  });

  it('gives each artifact its use, record and share of the group appearances', async () => {
    await record(2, 'Win', MINE, FOES, {}, 'Bladesummon');
    await record(1, 'Loss', MINE, FOES, {}, 'Bladesummon');
    await record(1, 'Win', MINE, FOES, {}, 'Candleflame');

    expect(profile().artifacts).toEqual([
      { artifact: 'Bladesummon', games: 3, wins: 2, winRate: 0.667, share: 0.75 },
      { artifact: 'Candleflame', games: 1, wins: 1, winRate: 1, share: 0.25 },
    ]);
  });

  it('lists the variations seen at least 3 times and the other exact lineups apart', async () => {
    await record(4, 'Win', MINE);
    await record(3, 'Loss', ['A', 'B', 'C', 'D', 'F']);
    await record(1, 'Win', ['A', 'B', 'C', 'D', 'G']);

    const p = profile(['A', 'B', 'C', 'D']);
    expect(p.variations).toEqual([
      { flex: ['E'], games: 4, wins: 4, winRate: 1 },
      { flex: ['F'], games: 3, wins: 0, winRate: 0 },
    ]);
    expect(p.otherLineups).toEqual([{ heroes: ['A', 'B', 'C', 'D', 'G'], games: 1, wins: 1, winRate: 1 }]);
  });

  it('gives the record with and without each flex hero', async () => {
    await record(4, 'Win', MINE);
    await record(4, 'Loss', ['A', 'B', 'C', 'D', 'F']);

    expect(profile(['A', 'B', 'C', 'D']).heroImpact).toEqual([
      { hero: 'E', with: { games: 4, wins: 4, winRate: 1 }, without: { games: 4, wins: 0, winRate: 0 } },
      { hero: 'F', with: { games: 4, wins: 0, winRate: 0 }, without: { games: 4, wins: 4, winRate: 1 } },
    ]);
  });

  it('names the enemy groups it is strong or weak against from 5 games, and leaves smaller samples out', async () => {
    await record(5, 'Win', MINE, FOES);
    await record(5, 'Loss', MINE, OTHER_FOES);
    await record(2, 'Loss', MINE, ['S', 'T', 'U', 'V', 'M']);

    const p = profile();
    expect(p.strongAgainst).toEqual([{ enemy: FOES, games: 5, wins: 5, winRate: 1 }]);
    expect(p.weakAgainst).toEqual([{ enemy: OTHER_FOES, games: 5, wins: 0, winRate: 0 }]);
  });

  it('records the results when ahead, near level and behind in ranks, and counts unknown gaps apart', async () => {
    await record(2, 'Win', { heroes: MINE, rank: 'Supreme' }, { heroes: FOES, rank: 'Rare' });
    await record(1, 'Loss', { heroes: MINE, rank: 'Mythic+' }, { heroes: FOES, rank: 'Mythic+' });
    await record(1, 'Loss', { heroes: MINE, rank: 'Rare' }, { heroes: FOES, rank: 'Supreme' });
    await record(1, 'Win', MINE, FOES);

    expect(profile().gapRecords).toEqual({
      ahead: { games: 2, wins: 2 },
      near: { games: 1, wins: 0 },
      behind: { games: 1, wins: 0 },
      unknown: { games: 1, wins: 1 },
    });
  });

  it('labels a group worse than it looks when it won mostly with more upgrades, from 10 battles with a known gap', async () => {
    await record(10, 'Win', { heroes: MINE, rank: 'Supreme' }, { heroes: FOES, rank: 'Rare' });

    const p = profile();
    expect(p.gapAdjustment).toEqual({ games: 10, shift: -0.5 });
    expect(p.labels.map((l) => l.name)).toContain('Worse than it looks');
  });
});

describe('where a group stands on each map', () => {
  it('counts, per map, the tile most used by each hero and its share, the map played most first', async () => {
    await record(3, 'Win', MINE);
    await record(1, 'Loss', ['E', 'D', 'C', 'B', 'A']);
    await record(2, 'Loss', MINE, FOES, { mapName: 'Other' });

    const [open, other] = profile().placement;
    expect([open!.map, open!.games, open!.wins]).toEqual(['Open', 4, 3]);
    expect(open!.heroes.find((h) => h.hero === 'A')).toEqual({ hero: 'A', tile: 38, share: 0.75, games: 4, secondChoice: false });
    expect(open!.heroes.find((h) => h.hero === 'B')).toMatchObject({ tile: 39, share: 0.75 });
    expect([other!.map, other!.games, other!.wins]).toEqual(['Other', 2, 0]);
  });

  it('reads a side that stood on Side B turned over, as if on the half of Side A', async () => {
    await record(1, 'Win', ['B', 'C', 'A', 'D', 'E']); // A on tile 40
    await record(1, 'Loss', FOES, { heroes: ['B', 'C', 'A', 'D', 'E'], tiles: [3, 2, 4, 1, 0] }); // A on tile 4, which is 40 turned over

    const a = profile().placement[0]!.heroes.find((h) => h.hero === 'A');
    expect(a).toMatchObject({ tile: 40, share: 1, games: 2 });
  });

  it('moves a hero whose favourite tile is taken to its next most used one and says so', async () => {
    await record(2, 'Win', ['A', 'B', 'C', 'D', 'E']); // A on 38, B on 39
    await record(2, 'Win', ['B', 'A', 'C', 'D', 'E']); // B on 38, A on 39

    const heroes = profile().placement[0]!.heroes;
    expect(heroes.find((h) => h.hero === 'A')).toMatchObject({ tile: 38, secondChoice: false });
    expect(heroes.find((h) => h.hero === 'B')).toMatchObject({ tile: 39, share: 0.5, secondChoice: true });
  });
});

describe('the report of formation groups', () => {
  it('gives each group its win rate against the average of all sides, its players and its labels, under archetype rows', async () => {
    await record(3, 'Win', MINE, FOES, { playerIdA: '111' }, 'Bladesummon');
    await record(1, 'Loss', MINE, FOES, { playerIdA: '222' });

    const report = formationReport(db);
    expect(report.baseline).toBe(0.5);
    const row = report.rows.find((r) => r.core.some((c) => c.hero === 'A'))!;
    expect(row.groups).toHaveLength(1);
    expect(row.groups[0]).toMatchObject({ games: 4, wins: 3, winRate: 0.75, vsAverage: 0.25, players: 2, artifact: { artifact: 'Bladesummon', share: 0.75 } });
    expect(row.groups[0]!.labels.map((l) => l.name)).toContain('Limited evidence');
  });
});

describe('the stats API of formation groups', () => {
  const get = async (url: string) => {
    const response = await app.request(url);
    return { status: response.status, body: (await response.json()) as any };
  };

  it('gives the report, filtered by the heroes picked', async () => {
    await record(2, 'Win', MINE, FOES, { playerIdA: '111' });
    await record(2, 'Win', ['P', 'Q', 'R', 'S', 'T'], OTHER_FOES, { playerIdA: '111' });

    const all = await get('/api/stats/formation-report?player=111');
    expect(all.body.rows.map((r: any) => r.core.map((c: any) => c.hero))).toEqual([MINE, ['P', 'Q', 'R', 'S', 'T']]);
    const picked = await get('/api/stats/formation-report?player=111&hero=C&hero=E');
    expect(picked.body.rows.map((r: any) => r.core.map((c: any) => c.hero))).toEqual([MINE]);
  });

  it('gives a profile by core heroes, and 404 for a core no group has', async () => {
    await record(2, 'Win', MINE);

    const found = await get('/api/stats/formation-profile?core=E&core=D&core=C&core=B&core=A');
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ games: 2, wins: 2 });
    expect((await get('/api/stats/formation-profile?core=A&core=V')).status).toBe(404);
  });
});
