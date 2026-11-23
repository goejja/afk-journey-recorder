import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { TILE, TILE_COUNT } from '../../src/domain/map.js';
import { groupCounters, groupSides } from '../../src/query/index.js';
import { counterFights, type CounterFight } from '../../src/query/formations.js';
import { createApp } from '../../src/server/app.js';

const RULE = { winRate: 0.65, minGames: 5 };
const FIRE = ['A', 'B', 'C', 'D', 'E'];
const ICE = ['F', 'G', 'H', 'I', 'J'];
const WIND = ['K', 'L', 'M', 'N', 'O'];

/** `times` battles of `a` against `b`, `aWins` of them won by `a`. */
const battles = (a: string[], b: string[], times: number, aWins: number): CounterFight[] =>
  Array.from({ length: times }, (_, i) => [
    { heroes: a, won: Number(i < aWins) },
    { heroes: b, won: Number(i >= aWins) },
  ]);
const groupsOf = (all: CounterFight[]) => groupSides(all.flatMap((pair) => pair.map((s) => ({ ...s, playerId: null }))));
const indexOf = (groups: ReturnType<typeof groupsOf>, hero: string) => groups.findIndex((g) => g.core.some((c) => c.hero === hero));

describe('groupCounters', () => {
  it('lists a group as beating another from the minimum games and win rate, and the other as losing to it', () => {
    const all = battles(FIRE, ICE, 10, 7);
    const groups = groupsOf(all);
    const [fire, ice] = [indexOf(groups, 'A'), indexOf(groups, 'F')];
    const counters = groupCounters(groups, all, RULE);

    expect(counters[fire]!.beats).toEqual([{ vs: ice, games: 10, wins: 7, losses: 3, winRate: 0.7, anecdote: false }]);
    expect(counters[fire]!.losesTo).toEqual([]);
    expect(counters[ice]!.beats).toEqual([]);
    expect(counters[ice]!.losesTo).toEqual([{ vs: fire, games: 10, wins: 3, losses: 7, winRate: 0.3, anecdote: false }]);
  });

  it('keeps a result below the win rate out of both lists, but still in the matchups', () => {
    const all = battles(FIRE, ICE, 10, 6);
    const groups = groupsOf(all);
    const counters = groupCounters(groups, all, RULE);

    expect(counters.every((c) => c.beats.length === 0 && c.losesTo.length === 0)).toBe(true);
    expect(counters[indexOf(groups, 'A')]!.matchups).toHaveLength(1);
  });

  it('calls a record under the minimum games anecdote and never a counter, however good', () => {
    const all = battles(FIRE, ICE, 4, 4);
    const groups = groupsOf(all);
    const fire = groupCounters(groups, all, RULE)[indexOf(groups, 'A')]!;

    expect(fire.beats).toEqual([]);
    expect(fire.matchups[0]).toMatchObject({ games: 4, wins: 4, anecdote: true });
  });

  it('follows the rule it is given', () => {
    const all = battles(FIRE, ICE, 10, 6);
    const groups = groupsOf(all);
    const fire = indexOf(groups, 'A');

    expect(groupCounters(groups, all, { winRate: 0.55, minGames: 5 })[fire]!.beats).toHaveLength(1);
    expect(groupCounters(groups, all, { winRate: 0.55, minGames: 11 })[fire]!.beats).toEqual([]);
  });

  it('adds up the battles of both orders of the sides and of every variant of a group', () => {
    const all = [...battles(FIRE, ICE, 3, 3), ...battles(ICE, FIRE, 3, 0), ...battles(['A', 'B', 'C', 'D', 'X'], ICE, 2, 2)];
    const groups = groupsOf(all);
    const fire = indexOf(groups, 'A');

    expect(groups).toHaveLength(2);
    expect(groupCounters(groups, all, RULE)[fire]!.matchups[0]).toMatchObject({ games: 8, wins: 8, losses: 0 });
  });

  it('skips a group against itself and a side that belongs to no listed group', () => {
    const all = [...battles(FIRE, FIRE, 6, 3), ...battles(FIRE, ICE, 5, 5)];
    const groups = groupsOf(all);
    const counters = groupCounters(groups.filter((g) => g.core.some((c) => c.hero === 'A')), all, RULE);

    expect(counters).toHaveLength(1);
    expect(counters[0]!.matchups).toEqual([]);
  });

  it('orders the counters by win rate, then games', () => {
    const all = [...battles(FIRE, ICE, 10, 7), ...battles(FIRE, WIND, 5, 5)];
    const groups = groupsOf(all);
    const fire = groupCounters(groups, all, RULE)[indexOf(groups, 'A')]!;

    expect(fire.beats.map((m) => groups[m.vs]!.core[0]!.hero)).toEqual(['K', 'F']);
  });
});

describe('counter battles and the counters report', () => {
  let app: Hono;
  let db: Database.Database;
  const cells = Array.from({ length: TILE_COUNT }, (_, i) => (i < 5 ? TILE.ENEMY : i >= 38 ? TILE.PLAYER : TILE.OPEN));
  const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;

  beforeEach(() => {
    db = openDb(':memory:');
    db.prepare("INSERT INTO map (name, tags, row_lengths, cells, source) VALUES ('Open', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(JSON.stringify(cells));
    for (const name of 'ABCDEFGHIJKLMNO'.split('')) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
    app = createApp(db);
  });

  const side = (names: string[], base: number) => names.map((hero, i) => ({ tile: base + i, hero }));
  const fight = (outcome: 'Win' | 'Loss', mine: string[], theirs: string[], extra: Record<string, unknown> = {}) =>
    app.request('/api/pvp/fights', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'Arena', mapName: 'Open', outcome, formation: { heroes: side(mine, 38), phantimal: null, assistHero: null, artifact: null }, opponent: { heroes: side(theirs, 0) }, ...extra }),
    });
  const record = async (times: number, wins: number, mine: string[], theirs: string[], extra: Record<string, unknown> = {}) => {
    for (let i = 0; i < times; i += 1) await fight(i < wins ? 'Win' : 'Loss', mine, theirs, extra);
  };

  it('reads both sides of each battle, as Side A and Side B', async () => {
    await record(2, 2, FIRE, ICE);

    const battles = counterFights(db, {});
    expect(battles).toHaveLength(2);
    expect(battles[0]).toEqual([{ heroes: FIRE, won: 1 }, { heroes: ICE, won: 0 }]);
  });

  it('gives the counters of the groups over HTTP, with the saved rule', async () => {
    await record(10, 7, FIRE, ICE);

    const report = await json(app.request('/api/stats/group-counters'));
    expect(report.rule).toEqual({ winRate: 0.65, minGames: 5 });
    const fire = report.groups.find((g: any) => g.core.includes('A'));
    expect(fire).toMatchObject({ games: 10, wins: 7, beats: [{ games: 10, wins: 7, losses: 3, winRate: 0.7, anecdote: false }] });
    expect(report.groups[fire.beats[0].vs].core).toEqual(ICE);
  });

  it('uses the rule saved in Admin', async () => {
    await record(10, 6, FIRE, ICE);
    await app.request('/api/counter-rule', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ winRate: 0.55, minGames: 5 }) });

    const report = await json(app.request('/api/stats/group-counters'));
    expect(report.rule).toEqual({ winRate: 0.55, minGames: 5 });
    expect(report.groups.find((g: any) => g.core.includes('A')).beats).toHaveLength(1);
  });

  it('keeps the battles a Player was in, on either side, so the opponent is not lost', async () => {
    await record(6, 6, FIRE, ICE, { playerIdA: '111' });
    await record(6, 0, WIND, ICE, { playerIdB: '222' });

    const report = await json(app.request('/api/stats/group-counters?player=222'));
    expect(report.groups.map((g: any) => g.core).sort()).toEqual([ICE, WIND]);
    expect(report.groups.find((g: any) => g.core.includes('F')).beats).toHaveLength(1);
  });

  it('applies the Mode and Season filters to the battles', async () => {
    await record(6, 6, FIRE, ICE);
    db.prepare('UPDATE attempt SET season = 7 WHERE id <= 3').run();

    expect((await json(app.request('/api/stats/group-counters?playedIn=8'))).groups[0].games).toBe(3);
    expect((await json(app.request('/api/stats/group-counters?mode=Guild%20Duel'))).groups).toEqual([]);
  });
});
