import { describe, expect, it } from 'vitest';
import type { HeroStateRules } from '../../src/domain/hero-state.js';
import { buildSection, parseImportReply, type ImportPlayer, type ImportProfile, type ProposalContext, type TileReading } from '../../src/domain/roster-import.js';

const ranks = ['Rare', 'Epic', 'Supreme', 'Supreme+', 'Paragon 1'];
const rules: HeroStateRules = {
  ranks,
  equipmentLevels: [0, 5, 10, 15, 20, 25, 26],
  caps: [{ rank: 'Supreme', minLevel: null, maxLevel: null }, { rank: 'Supreme+', minLevel: null, maxLevel: null }, { rank: 'Paragon 1', minLevel: null, maxLevel: null }],
};
const heroes = ['Evie', 'Thador', 'Valka', 'Nara', 'Rhys'];
const tiers = new Map(heroes.map((h) => [h, 'S']));

const tile = (key: string, hero: string | null, rank: string | null, stars: TileReading['stars'], extra: Partial<TileReading> = {}): TileReading => ({
  key, crop: 'team1', index: 0, hero, candidates: [], rank, confident: hero !== null, rankConfident: true, notOwned: false, stars, ...extra,
});
const present = (level: number): TileReading['stars'] => ({ state: 'present', level });

function context(profiles: ImportProfile[], screen: ProposalContext['screen'] = 'hall'): ProposalContext {
  return { screen, profiles, rules, tiers };
}
const profile = (id: number, name: string, roster: Record<string, [string | null, number | null]>): ImportProfile => ({
  id, name, heroes: new Map(Object.entries(roster).map(([hero, [rank, equipmentLevel]]) => [hero, { rank, equipmentLevel }])),
});

describe('parseImportReply', () => {
  const expected = [['team1', 'team2']];
  const reply = JSON.stringify({
    players: [{ name: 'Мокка', crops: { team1: [{ hero: 'evie', rank: 'paragon 1', rankSure: false }, { hero: null, candidates: ['Valka', 'Nobody', 'Nara'], rank: 'Supreme+' }], team2: [{ hero: 'Thador', rank: 'Legend', confident: false }] } }],
  });

  it('reads heroes and ranks ignoring case, and keeps only the candidates that are heroes', () => {
    const parsed = parseImportReply('```json\n' + reply + '\n```', expected, heroes, ranks);
    expect(parsed).toMatchObject({ players: [{ name: 'Мокка' }] });
    const tiles = (parsed as any).players[0].tiles;
    expect(tiles[0]).toMatchObject({ crop: 'team1', index: 0, hero: 'Evie', rank: 'Paragon 1', confident: true, rankConfident: false });
    expect(tiles[1]).toMatchObject({ hero: null, candidates: ['Valka', 'Nara'], rank: 'Supreme+', confident: false });
    expect(tiles[2]).toMatchObject({ crop: 'team2', hero: 'Thador', rank: null, confident: false });
  });

  it('says so when the reply is not the expected JSON or lacks a crop', () => {
    expect(parseImportReply('I could not read it', expected, heroes, ranks)).toEqual({ error: 'The agent did not reply with the players it read (it said: I could not read it)' });
    expect(parseImportReply(JSON.stringify({ players: [{ name: 'A', crops: { team1: [] } }] }), expected, heroes, ranks)).toEqual({ error: 'The agent did not reply for team2' });
    expect(parseImportReply(JSON.stringify({ players: [] }), expected, heroes, ranks)).toEqual({ error: 'The agent did not reply for player 1' });
  });
});

describe('parseImportReply', () => {
  it('finds a strip the Agent listed under the other player', () => {
    const reply = JSON.stringify({ players: [{ name: 'A', crops: { ally: [{ hero: 'Evie', rank: 'Supreme' }], enemy: [{ hero: 'Nara', rank: 'Supreme' }] } }, { name: 'B' }] });
    const parsed = parseImportReply(reply, [['ally'], ['enemy']], heroes, ['Supreme']);
    expect('players' in parsed && parsed.players.map((p) => p.tiles.map((t) => t.hero))).toEqual([['Evie'], ['Nara']]);
  });
});

describe('parseImportReply on a battle report', () => {
  const extras = { artifacts: ['Arc Burst', 'Awakening'], phantimals: ['Orson', 'Wedge of Matter'] };
  const side = (over: object) => ({ name: 'A', crops: { ally: [{ hero: 'Evie', rank: 'Supreme' }] }, ...over });

  it('reads the artifact with its level and the phantimal of a side, ignoring case, and drops names that are not on the lists', () => {
    const reply = JSON.stringify({ players: [side({ artifact: { name: 'arc burst', level: 24 }, phantimal: 'orson' }), side({ crops: { enemy: [{ hero: 'Nara', rank: 'Supreme' }] }, artifact: { name: 'Nothing', level: 23 }, phantimal: 'Nobody' })] });
    const parsed = parseImportReply(reply, [['ally'], ['enemy']], heroes, ['Supreme'], extras);
    expect('players' in parsed && parsed.players.map((p) => [p.artifact, p.phantimal])).toEqual([[{ name: 'Arc Burst', level: 24 }, 'Orson'], [{ name: null, level: 23 }, null]]);
  });

  it('leaves them out when the Agent gave none, and when the picture was not asked about them', () => {
    const reply = JSON.stringify({ players: [side({ artifact: { name: null, level: null } })] });
    const asked = parseImportReply(reply, [['ally']], heroes, ['Supreme'], extras);
    expect('players' in asked && asked.players[0]).toMatchObject({ artifact: null, phantimal: null });
    const notAsked = parseImportReply(reply, [['ally']], heroes, ['Supreme']);
    expect('players' in notAsked && 'artifact' in notAsked.players[0]!).toBe(false);
  });
});

describe('buildSection', () => {
  const me = profile(1, 'Brin', { Evie: ['Supreme+', 10], Thador: ['Paragon 1', 10], Rhys: ['Epic', null] });

  it('ticks new and upgraded heroes, leaves downgrades unticked and leaves heroes the picture does not show alone', () => {
    const player: ImportPlayer = {
      name: 'Brin',
      tiles: [
        tile('a', 'Evie', 'Paragon 1', present(10)), // upgrade
        tile('b', 'Thador', 'Supreme+', present(10)), // downgrade
        tile('c', 'Valka', 'Supreme', present(5)), // new
      ],
    };
    const section = buildSection(player, context([me]), { kind: 'match' });
    expect(section.profile).toEqual({ id: 1, name: 'Brin' });
    expect(section.rows.map((r) => [r.hero, r.direction, r.selected])).toEqual([['Evie', 'upgrade', true], ['Thador', 'downgrade', false], ['Valka', 'new', true]]);
    expect(section.rows.some((r) => r.hero === 'Rhys')).toBe(false);
    expect(section.rows[2]!.to).toEqual({ rank: 'Supreme', equipmentLevel: 5 });
  });

  it('offers to rename a profile spelled with look-alike letters, and to create one when no profile matches', () => {
    const typed = profile(2, 'Mokka', {});
    const player: ImportPlayer = { name: 'Мокка', tiles: [tile('a', 'Evie', 'Supreme', present(0))] };
    expect(buildSection(player, context([me, typed]), { kind: 'match' })).toMatchObject({ profile: { id: 2 }, rename: 'Мокка', create: null });
    expect(buildSection({ ...player, name: 'Nini' }, context([me, typed]), { kind: 'match' })).toMatchObject({ profile: null, rename: null, create: 'Nini' });
  });

  it('puts the heroes in a profile the player chose, and into a new one on request', () => {
    const player: ImportPlayer = { name: 'Nini', tiles: [tile('a', 'Evie', 'Paragon 1', present(10))] };
    expect(buildSection(player, context([me]), { kind: 'profile', id: 1 }).rows[0]).toMatchObject({ direction: 'upgrade' });
    const created = buildSection(player, context([me]), { kind: 'new' });
    expect(created).toMatchObject({ profile: null, create: 'Nini' });
    expect(created.rows[0]).toMatchObject({ direction: 'new' });
  });

  it('leaves a changed equipment level read from a small tile unticked, but not one from the Hall', () => {
    const player: ImportPlayer = { name: 'Brin', tiles: [tile('a', 'Evie', 'Supreme+', present(15))] };
    const small = buildSection(player, context([me], 'info'), { kind: 'match' }).rows[0]!;
    expect(small).toMatchObject({ selected: false, check: ['stars'] });
    expect(buildSection(player, context([me], 'hall'), { kind: 'match' }).rows[0]).toMatchObject({ selected: true, check: [] });
  });

  it('leaves an unsure or impossible star reading unticked and keeps the old equipment', () => {
    const unsure = buildSection({ name: 'Brin', tiles: [tile('a', 'Evie', 'Paragon 1', { state: 'unsure', level: null })] }, context([me]), { kind: 'match' }).rows[0]!;
    expect(unsure).toMatchObject({ selected: false, check: ['stars'], to: { rank: 'Paragon 1', equipmentLevel: 10 } });
    const impossible = buildSection({ name: 'Brin', tiles: [tile('a', 'Evie', 'Paragon 1', present(7))] }, context([me]), { kind: 'match' }).rows[0]!;
    expect(impossible.to.equipmentLevel).toBe(10);
    expect(impossible.check).toContain('stars');
  });

  it('gives no equipment to a rank that has none, and does not flag the stars of a hero without a weapon', () => {
    const player: ImportPlayer = { name: 'Brin', tiles: [tile('a', 'Rhys', 'Epic', { state: 'absent', level: null }), tile('b', 'Nara', 'Epic', { state: 'absent', level: null })] };
    const section = buildSection(player, context([me]), { kind: 'match' });
    expect(section.rows).toEqual([expect.objectContaining({ hero: 'Nara', direction: 'new', selected: true, to: { rank: 'Epic', equipmentLevel: null } })]);
  });

  it('unticks a tile read with low confidence or a rank the hero cannot have', () => {
    const unsureHero = tile('a', 'Valka', 'Supreme', present(0), { confident: false });
    const impossible = tile('b', 'Nara', 'Rare', null);
    const section = buildSection({ name: 'Brin', tiles: [unsureHero, impossible] }, context([me]), { kind: 'match' });
    expect(section.rows.map((r) => [r.hero, r.selected, r.check])).toEqual([['Valka', false, ['hero']], ['Nara', false, ['rank']]]);
  });

  it('unticks a row whose rank the Agent was not sure of', () => {
    const section = buildSection({ name: 'Brin', tiles: [tile('a', 'Valka', 'Supreme', present(5), { rankConfident: false })] }, context([me]), { kind: 'match' });
    expect(section.rows[0]).toMatchObject({ selected: false, check: ['rank'] });
  });

  it('lists tiles it could not name, with candidates, and heroes it knows but without a rank', () => {
    const player: ImportPlayer = {
      name: 'Brin',
      tiles: [tile('a', null, 'Supreme+', present(5), { candidates: ['Valka', 'Nara'] }), tile('b', 'Valka', null, present(5))],
    };
    const section = buildSection(player, context([me]), { kind: 'match' });
    expect(section.unknown).toEqual([{ tile: 'a', candidates: ['Valka', 'Nara'], rank: 'Supreme+' }]);
    expect(section.withoutRank).toEqual([{ tile: 'b', hero: 'Valka' }]);
    expect(section.rows).toEqual([]);
  });

  it('still asks for a tile the Agent could not name and had no candidates for, but not for an empty slot', () => {
    const player: ImportPlayer = {
      name: 'Brin',
      tiles: [tile('a', null, null, null), tile('b', null, null, null, { blank: true })],
    };
    const section = buildSection(player, context([me]), { kind: 'match' });
    expect(section.unknown).toEqual([{ tile: 'a', candidates: [], rank: null }]);
  });

  it('unticks a Not Owned tile of a Treasure Rush list and asks the player to set its rank and equipment', () => {
    const section = buildSection({ name: 'Fenn', tiles: [tile('a', 'Valka', 'Supreme', null, { notOwned: true })] }, { ...context([me]), screen: 'suggestion' }, { kind: 'match' });
    expect(section.rows[0]).toMatchObject({ selected: false, check: ['not-owned'] });
  });

  it('leaves a hero the Profile has alone when its tile is marked Not Owned', () => {
    const section = buildSection({ name: 'Brin', tiles: [tile('a', 'Evie', 'Epic', null, { notOwned: true })] }, { ...context([me]), screen: 'suggestion' }, { kind: 'match' });
    expect(section.rows).toEqual([]);
  });

  it('reads the notOwned flag of the Agent reply', () => {
    const reply = JSON.stringify({ players: [{ name: 'Fenn', crops: { team1: [{ hero: 'Valka', rank: 'Supreme', notOwned: true }, { hero: 'Nara', rank: 'Supreme' }] } }] });
    const parsed = parseImportReply(reply, [['team1']], heroes, ['Supreme']);
    expect('players' in parsed && parsed.players[0]!.tiles.map((t) => t.notOwned)).toEqual([true, false]);
  });

  it('takes the rank the rank reader is sure of, and unticks the row when the Agent said another', () => {
    const reading = (rank: string, confident = true) => ({ rank, distance: 0.04, support: 4, margin: 1, confident });
    const agrees = buildSection({ name: 'Brin', tiles: [tile('a', 'Valka', 'Paragon 1', present(10), { rankConfident: false, rankRead: reading('Paragon 1') })] }, context([me]), { kind: 'match' });
    expect(agrees.rows[0]).toMatchObject({ selected: true, check: [], to: { rank: 'Paragon 1' }, reader: { rank: 'Paragon 1', support: 4, agrees: true } });
    const differs = buildSection({ name: 'Brin', tiles: [tile('a', 'Valka', 'Supreme', present(10), { rankRead: reading('Paragon 2') })] }, context([me]), { kind: 'match' });
    expect(differs.rows[0]).toMatchObject({ selected: false, check: ['rank'], to: { rank: 'Paragon 2' }, reader: { rank: 'Paragon 2', agrees: false } });
    const unsure = buildSection({ name: 'Brin', tiles: [tile('a', 'Valka', 'Supreme', present(10), { rankRead: reading('Paragon 2', false) })] }, context([me]), { kind: 'match' });
    expect(unsure.rows[0]).toMatchObject({ to: { rank: 'Supreme' }, reader: null });
  });
});
