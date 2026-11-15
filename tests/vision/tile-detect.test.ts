import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { findBattleSides, findHallRows, findInfoTeams, findRecapBands, findSuggestionPlayers } from '../../src/vision/tile-detect.js';

const WIDTH = 1170;
const HEIGHT = 2532;

interface Tile {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A plain picture with a bright frame and a dark portrait for each tile, on a mid-grey background. */
async function picture(tiles: Tile[], cards: Tile[] = []): Promise<Buffer> {
  const data = Buffer.alloc(WIDTH * HEIGHT * 3, 110);
  const fill = (left: number, top: number, width: number, height: number, value: number) => {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) data.fill(value, (y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3);
  };
  for (const c of cards) fill(c.left, c.top, c.width, c.height, 170);
  for (const t of tiles) {
    fill(t.left, t.top, t.width, t.height, 235);
    fill(t.left + 6, t.top + 6, t.width - 12, t.height - 12, 40);
  }
  return sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
}

const across = (left: number, top: number, count: number, width: number, height: number, pitch: number): Tile[] =>
  Array.from({ length: count }, (_, i) => ({ left: left + i * pitch, top, width, height }));
const down = (left: number, top: number, count: number, width: number, height: number, pitch: number): Tile[] =>
  Array.from({ length: count }, (_, i) => ({ left, top: top + i * pitch, width, height }));

const near = (box: Tile, want: Tile, by = 4) =>
  Math.abs(box.left - want.left) <= by && Math.abs(box.top - want.top) <= by && Math.abs(box.width - want.width) <= by;

describe('findInfoTeams', () => {
  it('finds the three team rows of a Player Info picture', async () => {
    const teams = [across(77, 1283, 5, 93, 121, 97), across(617, 1283, 5, 93, 121, 97), across(77, 1563, 5, 93, 121, 97)];
    const rows = await findInfoTeams(await picture(teams.flat()));
    expect(rows).toHaveLength(3);
    for (const team of teams) {
      const row = rows.find((r) => near(r.boxes[0]!, team[0]!));
      expect(row, `a row near ${team[0]!.left},${team[0]!.top}`).toBeDefined();
      team.forEach((tile, i) => expect(near(row!.boxes[i]!, tile)).toBe(true));
    }
  });

  it('finds nothing in a picture without tiles', async () => {
    expect(await findInfoTeams(await picture([]))).toEqual([]);
  });
});

describe('findBattleSides', () => {
  it('finds the ally and the enemy column of a battle result', async () => {
    const ally = down(66, 716, 5, 64, 90, 98);
    const enemy = down(66, 1418, 5, 64, 90, 98);
    const rows = await findBattleSides(await picture([...ally, ...enemy]));
    expect(rows).toHaveLength(2);
    expect(near(rows[0]!.boxes[0]!, ally[0]!, 3)).toBe(true);
    expect(near(rows[1]!.boxes[0]!, enemy[0]!, 3)).toBe(true);
    expect(rows[0]!.boxes).toHaveLength(5);
  });

  it('keeps every tile of both columns on the tiles, with the same pitch, instead of letting the enemy column drift', async () => {
    const ally = down(66, 718, 5, 64, 90, 98);
    const enemy = down(66, 1420, 5, 64, 90, 98);
    const [a, e] = await findBattleSides(await picture([...ally, ...enemy]));
    expect(a!.boxes.every((box, i) => Math.abs(box.top - ally[i]!.top) <= 2)).toBe(true);
    expect(e!.boxes.every((box, i) => Math.abs(box.top - enemy[i]!.top) <= 2)).toBe(true);
  });
});

describe('findHallRows', () => {
  it('finds the Hands of Resonance and the whole rows of the grid, top to bottom', async () => {
    const hands = across(55, 564, 5, 190, 232, 218);
    const grid = [1134, 1388, 1638].flatMap((top) => across(70, top, 6, 156, 205, 178));
    const rows = await findHallRows(await picture([...hands, ...grid]));
    expect(rows.map((r) => r.boxes.length)).toEqual([5, 6, 6, 6]);
    expect(rows.map((r) => Math.round(r.boxes[0]!.top / 10) * 10)).toEqual([560, 1130, 1390, 1640]);
  });
});

describe('findInfoTeams with five teams', () => {
  const slots = [[77, 1283], [617, 1283], [77, 1563], [617, 1563], [77, 1843]] as const;

  it('numbers the teams as the game does: two columns, then team 5 alone', async () => {
    const teams = slots.map(([left, top]) => across(left, top, 5, 93, 121, 97));
    const rows = await findInfoTeams(await picture(teams.flat()));
    expect(rows.map((r) => r.team)).toEqual([1, 2, 3, 4, 5]);
    rows.forEach((row, i) => expect(near(row.boxes[0]!, teams[i]![0]!)).toBe(true));
  });

  it('numbers three teams 1 to 3 and finds no team in the empty slots', async () => {
    const rows = await findInfoTeams(await picture(slots.slice(0, 3).flatMap(([left, top]) => across(left, top, 5, 93, 121, 97))));
    expect(rows.map((r) => r.team)).toEqual([1, 2, 3]);
  });

  it('finds team 2 when it holds four heroes and an empty slot, whatever sits around it', async () => {
    const teams = [across(77, 1283, 5, 93, 121, 97), across(617, 1283, 4, 93, 121, 97), across(77, 1563, 5, 93, 121, 97)];
    const rows = await findInfoTeams(await picture(teams.flat()));
    expect(rows.map((r) => r.team)).toEqual([1, 2, 3]);
    expect(near(rows[1]!.boxes[0]!, teams[1]![0]!)).toBe(true);
    expect(rows[1]!.boxes).toHaveLength(5);
  });
});

describe('findInfoTeams', () => {
  it('finds team 3 at its usual height when it holds four heroes and an empty slot', async () => {
    const teams = [across(77, 1283, 5, 93, 121, 97), across(617, 1283, 5, 93, 121, 97), across(77, 1563, 4, 93, 121, 97)];
    const rows = await findInfoTeams(await picture(teams.flat()));
    expect(rows.some((row) => Math.abs(row.boxes[0]!.top - 1563) <= 4)).toBe(true);
  });
});

describe('findRecapBands', () => {
  const band = (top: number) => [...across(65, top, 5, 88, 122, 96), ...across(647, top, 5, 88, 122, 96)];

  it('finds the battles that show whole: the player on the left, the opponent on the right', async () => {
    const bands = await findRecapBands(await picture([...band(909), ...band(1303), ...band(1715)]));
    expect(bands.map((b) => b.top).map((t) => Math.round(t / 10) * 10)).toEqual([910, 1300, 1720]);
    expect(near(bands[0]!.enemy.boxes[0]!, { left: 647, top: 909, width: 88, height: 122 })).toBe(true);
    expect(bands[0]!.ally.boxes).toHaveLength(5);
  });

  it('puts a band on the pixel row of its tiles, whether that row is odd or even', async () => {
    // the search steps two pixels at a time, so a band on the other parity once settled on a worse place a few dozen pixels away
    for (const tops of [[898, 1302, 1706], [899, 1303, 1707]]) {
      // each band sits on a card whose bottom edge is a long straight line just under the tiles, which a row one card-margin too low would also fit
      const cards = tops.map((top) => ({ left: 30, top: top - 30, width: 1100, height: 185 }));
      const bands = await findRecapBands(await picture(tops.flatMap(band), cards));
      expect(bands.map((b) => b.top)).toHaveLength(3);
      bands.forEach((b, i) => {
        expect(Math.abs(b.top - tops[i]!)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.enemy.boxes[0]!.top - tops[i]!)).toBeLessThanOrEqual(1);
      });
    }
  });

  it('puts a band on the spacing of the others when a row of edges just below its tiles fits better', async () => {
    // the strong edges of the level labels under one band's tiles once won over its frame, and every portrait of it was cut too low
    const tops = [1211, 1615, 2019];
    const decoy = across(65, 1645, 5, 88, 122, 96);
    const bands = await findRecapBands(await picture([...tops.flatMap(band), ...decoy]));
    expect(bands).toHaveLength(3);
    bands.forEach((b, i) => expect(Math.abs(b.top - tops[i]!)).toBeLessThanOrEqual(2));
  });

  it('keeps the opponent column at its place even when a decoy row of edges lies to the left of it', async () => {
    // a row of weak tiles once settled nine pixels left of the column, so the last frame ran past its box
    const decoy = across(638, 1303, 5, 90, 122, 96);
    const bands = await findRecapBands(await picture([...band(1303), ...decoy]));
    expect(bands).toHaveLength(1);
    expect(Math.abs(bands[0]!.enemy.boxes[0]!.left - 647)).toBeLessThanOrEqual(3);
  });

  it('leaves out a band whose names are scrolled off the top of the list', async () => {
    const bands = await findRecapBands(await picture([...band(809), ...band(1213)]));
    expect(bands).toHaveLength(1);
    expect(Math.abs(bands[0]!.top - 1213)).toBeLessThanOrEqual(4);
  });
});

describe('findSuggestionPlayers', () => {
  const row = (top: number) => across(259, top, 5, 104, 150, 114);

  it('groups the rows of one player and starts a new player after a gap', async () => {
    const players = await findSuggestionPlayers(await picture([...row(894), ...row(1088), ...row(1512), ...row(1708)]));
    expect(players.map((p) => p.rows.length)).toEqual([2, 2]);
  });

  it('leaves out a row cut by the bottom of the list', async () => {
    const players = await findSuggestionPlayers(await picture([...row(894), ...row(1088), ...row(2092)]));
    expect(players.flatMap((p) => p.rows)).toHaveLength(2);
  });
});
