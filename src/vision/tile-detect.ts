import sharp from 'sharp';
import type { TileBox } from './tile-image.js';

/**
 * A row of equal hero tiles lying along one axis. Sizes are fractions of the picture width, so the same layout fits
 * pictures of any resolution from the same phone shape.
 */
interface RowLayout {
  /** 'x' for tiles side by side, 'y' for tiles stacked. */
  axis: 'x' | 'y';
  count: number;
  /** Distance between the starts of two neighbouring tiles. */
  pitch: number;
  /** The tile's extent along the axis. */
  size: number;
  /** The tile's extent across the axis. */
  cross: number;
  /** Where rows start, as fractions of the picture: the range of the left edge across the width and of the top edge down the height. */
  window: { left: [number, number]; top: [number, number] };
  /**
   * How far a row found may be moved outward, as a fraction of the width, to the outermost start that scores at least 75% as well: on
   * the battle result the frame is soft against the dark panel and the sharper inner edge of the portrait wins. 0 for none.
   */
  outward: number;
  /** The same across the axis (the top of tiles side by side). */
  outwardCross: number;
  /** The share of the best score an outer start must reach to be taken, instead of 75%: a layout whose inner and outer edges are far apart needs a stricter one. */
  outerShare?: number;
  /** Rows scoring below this are not rows: partly hidden ones (scrolled off the screen) and stretches of background. */
  minScore: number;
  /** An edge between two neighbouring pixels counts when their grey levels differ by more than this. */
  edge: number;
}

/** The Player Info screen: three teams of five tiles side by side. */
const INFO_ROW: RowLayout = { axis: 'x', count: 5, pitch: 97 / 1170, size: 93 / 1170, cross: 121 / 1170, window: { left: [0.04, 0.6], top: [0.49, 0.64] }, edge: 24, outward: 0, outwardCross: 0, minScore: 0.2 };
/**
 * The battle result screen: a side's five tiles stacked, each about 64 px wide. The columns lie in the same place on every picture, so their
 * pitch and size are fixed, and the search for the first tile is narrow (see `BATTLE_SIDES`): a free fit wanders by up to 20 px, or settles on the dark border of the panel above the tile.
 */
const BATTLE_COLUMN: RowLayout = { axis: 'y', count: 5, pitch: 98 / 1170, size: 90 / 1170, cross: 64 / 1170, window: { left: [0.03, 0.12], top: [0.26, 0.6] }, edge: 12, outward: 0, outwardCross: 0, minScore: 0.2 };

/** The share of the best score an outer start must reach to be taken (see `RowLayout.outward`). */
const OUTER_SHARE = 0.75;

/** The Resonating Hall: the Hands of Resonance, five larger tiles, above a grid of six tiles per row that scrolls. */
const HALL_HANDS: RowLayout = { axis: 'x', count: 5, pitch: 218 / 1170, size: 190 / 1170, cross: 232 / 1170, window: { left: [0.02, 0.07], top: [0.2, 0.3] }, edge: 24, outward: 0, outwardCross: 0, minScore: 0.2 };
const HALL_GRID: RowLayout = { axis: 'x', count: 6, pitch: 178 / 1170, size: 156 / 1170, cross: 205 / 1170, window: { left: [0.02, 0.09], top: [0.36, 0.84] }, edge: 24, outward: 0, outwardCross: 0, minScore: 0.2 };

export interface FoundRow {
  layout: RowLayout;
  boxes: TileBox[];
  /** Share of the tile sides that show an edge (0 to 1), averaged with the weakest tile's. */
  score: number;
  /** The score over the median score of all positions searched: well above 1 for a real row, near 1 for noise. */
  contrast: number;
}

interface Grey {
  data: Uint8Array;
  width: number;
  height: number;
}

async function loadGrey(image: string | Buffer): Promise<Grey> {
  const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function transpose(g: Grey): Grey {
  const out = new Uint8Array(g.data.length);
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) out[x * g.height + y] = g.data[y * g.width + x]!;
  return { data: out, width: g.height, height: g.width };
}

/**
 * The rows of tiles that a layout finds in a picture, strongest first; rows that overlap an already found one are dropped. The pitch and size
 * are searched a little around the layout's, unless `exact` says they are known to the pixel.
 */
async function findRows(image: string | Buffer, layout: RowLayout, limit = 4, window = layout.window, exact = false): Promise<FoundRow[]> {
  const picture = await loadGrey(image);
  const grey = layout.axis === 'x' ? picture : transpose(picture);
  // fractions are of the width of the picture as it is shown, which is the long side of a transposed one
  const unit = picture.width;
  const pitch = Math.round(layout.pitch * unit);
  const size = Math.round(layout.size * unit);
  const cross = Math.round(layout.cross * unit);
  const { width: W, height: H, data } = grey;

  // vertical[y * W + x]: edges between columns x-1 and x, summed over the rows above y; horizontal[y * W + x]: edges between rows y-1 and y, summed over the columns left of x
  const vertical = new Float32Array((H + 1) * W);
  const horizontal = new Float32Array((H + 1) * (W + 1));
  for (let y = 0; y < H; y++) {
    for (let x = 1; x < W; x++) vertical[(y + 1) * W + x] = vertical[y * W + x]! + (Math.abs(data[y * W + x]! - data[y * W + x - 1]!) > layout.edge ? 1 : 0);
    if (y === 0) continue;
    for (let x = 0; x < W; x++) horizontal[y * (W + 1) + x + 1] = horizontal[y * (W + 1) + x]! + (Math.abs(data[y * W + x]! - data[(y - 1) * W + x]!) > layout.edge ? 1 : 0);
  }
  const side = (top: number, x: number) => (vertical[(top + cross) * W + x]! - vertical[top * W + x]!) / cross;
  const lid = (y: number, x: number, length: number) => (horizontal[y * (W + 1) + x + length]! - horizontal[y * (W + 1) + x]!) / length;

  const span = (layout.count - 1) * pitch + size;
  /** How well a row of tiles at this place shows the edges of its tiles' four sides: the mean over the tiles averaged with the weakest tile. */
  const scoreAt = (top: number, left: number, p: number, s: number) => {
    let sum = 0;
    let weakest = 1;
    for (let i = 0; i < layout.count; i++) {
      const x = left + i * p;
      const tile = (side(top, x) + side(top, x + s) + lid(top, x, s) + lid(top + cross, x, s)) / 4;
      sum += tile;
      weakest = Math.min(weakest, tile);
    }
    return (sum / layout.count + weakest) / 2;
  };
  const candidates: { top: number; left: number; pitch: number; size: number; score: number }[] = [];
  const alongRange = (layout.axis === 'x' ? window.left : window.top).map((f) => Math.round(f * W));
  const crossRange = (layout.axis === 'x' ? window.top : window.left).map((f) => Math.round(f * H));
  for (let top = crossRange[0]!; top < crossRange[1]! && top + cross < H; top += 2) {
    // one candidate per stretch of the axis, so that two rows side by side at the same height are both kept
    const bests = new Map<number, { top: number; left: number; pitch: number; size: number; score: number }>();
    for (let left = Math.max(1, alongRange[0]!); left < alongRange[1]! && left + span < W; left++) {
      for (let dp = exact ? 0 : -2; dp <= (exact ? 0 : 2); dp++) {
        for (let ds = exact ? 0 : -2; ds <= (exact ? 0 : 2); ds++) {
          const p = pitch + dp;
          const s = size + ds;
          const score = scoreAt(top, left, p, s);
          const stretch = Math.floor(left / span);
          if (score > (bests.get(stretch)?.score ?? -1)) bests.set(stretch, { top, left, pitch: p, size: s, score });
        }
      }
    }
    candidates.push(...bests.values());
  }

  // the search steps two pixels across the axis, and a sharp frame edge one pixel off scores badly: a row that is not on an even pixel
  // would lose to a worse place that is. So every candidate that could be a row is tried a pixel above and below.
  for (const c of candidates) {
    if (c.score < layout.minScore * 0.8) continue;
    for (const top of [c.top - 1, c.top + 1]) {
      if (top < 0 || top + cross >= H) continue;
      const score = scoreAt(top, c.left, c.pitch, c.size);
      if (score > c.score) Object.assign(c, { top, score });
    }
  }

  const median = candidates.map((c) => c.score).sort((a, b) => a - b)[Math.floor(candidates.length / 2)] || 1e-6;
  const rows: FoundRow[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (rows.length >= limit || c.score < layout.minScore) break;
    // a row that crosses an already found one is the same row seen a little off
    if (rows.some((r) => Math.abs(crossOf(r) - c.top) < cross && Math.abs(alongOf(r) - c.left) < span)) continue;
    // inner edges (the portrait inside the frame) can score as well as the frame: take the outermost start that scores nearly as well
    for (let left = Math.max(1, c.left - Math.round(layout.outward * unit)); left < c.left; left++) {
      if (scoreAt(c.top, left, c.pitch, c.size) >= (layout.outerShare ?? OUTER_SHARE) * c.score) {
        c.left = left;
        break;
      }
    }
    for (let top = Math.max(0, c.top - Math.round(layout.outwardCross * unit)); top < c.top; top++) {
      if (top + cross < H && scoreAt(top, c.left, c.pitch, c.size) >= (layout.outerShare ?? OUTER_SHARE) * c.score) {
        c.top = top;
        break;
      }
    }
    const boxes = Array.from({ length: layout.count }, (_, i): TileBox => {
      const along = c.left + i * c.pitch;
      return layout.axis === 'x' ? { left: along, top: c.top, width: c.size, height: cross } : { left: c.top, top: along, width: cross, height: c.size };
    });
    rows.push({ layout, boxes, score: c.score, contrast: c.score / median });
  }
  return rows;
}

const alongOf = (row: FoundRow) => (row.layout.axis === 'x' ? row.boxes[0]!.left : row.boxes[0]!.top);
const crossOf = (row: FoundRow) => (row.layout.axis === 'x' ? row.boxes[0]!.top : row.boxes[0]!.left);

/** Where the rows of each screen lie, as windows for `findRows` (fractions of the picture). */
const BATTLE_SIDES = [{ left: [0.03, 0.12], top: [713 / 2532, 721 / 2532] }, { left: [0.03, 0.12], top: [1415 / 2532, 1423 / 2532] }] as const;

/**
 * The Player Info team slots, numbered as the game does: two columns, team 1 and 2 on the first row, 3 and 4 on the second, 5 alone on the
 * third. A slot is searched where it is known to lie: a team that holds fewer than five heroes ends with a flat empty slot, which makes the
 * whole row score badly and lets a wider search settle on a false row. Rows are about 280 px (at 1170 wide) apart; the third row, seen only
 * with five teams, is placed by that spacing, not from a picture.
 */
const INFO_COLUMNS = [[0.04, 0.09], [0.5, 0.56]] as const;
const INFO_ROWS = [[0.49, 0.53], [0.612, 0.624], [0.723, 0.735]] as const;
const INFO_SLOTS = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] as const;
/** How far the exact tile start may lie from where the first tile was found, in pixels (at 1170 wide, scaled to the picture). */
const INFO_ANCHOR_REACH = 4;

/**
 * The team rows of a Player Info picture, each with the number of its slot in `team` (1 to 5), in team order. A slot with no team
 * shows no tile and gives no row. The first tile of a team is found on its own, which a flat empty slot at the end cannot disturb, and the
 * whole row is then fitted around it.
 */
export async function findInfoTeams(image: string | Buffer): Promise<(FoundRow & { team: number })[]> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  const reachX = INFO_ANCHOR_REACH / width;
  const reachY = INFO_ANCHOR_REACH / height;
  const teams: (FoundRow & { team: number })[] = [];
  for (const [i, [column, row]] of INFO_SLOTS.entries()) {
    const window = { left: [...INFO_COLUMNS[column]!] as [number, number], top: [...INFO_ROWS[row]!] as [number, number] };
    const [first] = await findRows(image, { ...INFO_ROW, count: 1 }, 1, window);
    if (!first) continue;
    const at = first.boxes[0]!;
    const pinned = { left: [at.left / width - reachX, at.left / width + reachX] as [number, number], top: [at.top / height - reachY, at.top / height + reachY] as [number, number] };
    const [found] = await findRows(image, { ...INFO_ROW, minScore: 0 }, 1, pinned);
    if (found) teams.push({ ...found, team: i + 1 });
  }
  return teams;
}

/** The two sides of a battle result picture, the ally side (the player on the left) first. */
export async function findBattleSides(image: string | Buffer): Promise<FoundRow[]> {
  return (await Promise.all(BATTLE_SIDES.map((w) => findRows(image, BATTLE_COLUMN, 1, { left: [...w.left], top: [...w.top] }, true)))).flat();
}

/** The tile rows of a Resonating Hall picture: the Hands of Resonance, then the rows of the grid that show whole (the scrolled ones at the edges are skipped). */
export async function findHallRows(image: string | Buffer): Promise<FoundRow[]> {
  return [...(await findRows(image, HALL_HANDS, 1)), ...(await findRows(image, HALL_GRID, 8))].sort((a, b) => boxTop(a) - boxTop(b));
}

const boxTop = (row: FoundRow) => row.boxes[0]!.top;

/** Treasure Rush, Daily Battle Recap: one band per battle, the player's five tiles on the left and the opponent's on the right, scrolling down the screen. */
const RECAP_ALLY: RowLayout = { axis: 'x', count: 5, pitch: 96 / 1170, size: 88 / 1170, cross: 122 / 1170, window: { left: [0.03, 0.08], top: [0.25, 0.9] }, edge: 12, outward: 0, outwardCross: 14 / 1170, outerShare: 0.9, minScore: 0.45 };
/**
 * The opponent's row is searched at the height of the player's (see `findRecapBands`), which has already been moved to the frame's outer edge.
 * Its first tile always starts at 647 px (at 1170 wide): a wider window let a row whose edges are weak settle 9 px to the left.
 */
const RECAP_ENEMY: RowLayout = { ...RECAP_ALLY, window: { left: [643 / 1170, 653 / 1170], top: [0.25, 0.9] }, outwardCross: 0, minScore: 0.3 };
/** Treasure Rush, Other Players' Suggestion: a team row is a Deployment icon and five tiles; each player has two to five rows. */
const SUGGESTION_ROW: RowLayout = { axis: 'x', count: 5, pitch: 114 / 1170, size: 104 / 1170, cross: 150 / 1170, window: { left: [0.18, 0.26], top: [0.3, 0.9] }, edge: 12, outward: 0, outwardCross: 0, minScore: 0.45 };

/** Fractions of the picture height: the scrolling list shows between these, and a band whose player name is above the top is cut off. */
const LIST_TOP = 0.285;
const LIST_BOTTOM = 0.875;
/** Where the recap list is clipped by the footer, and the card margin a whole band shows below its tiles: a band cut by it has no whole tiles, and a false row can fit its remains. */
const RECAP_LIST_BOTTOM = 0.867;
const RECAP_BAND_MARGIN = 40;
/** Pixels at 1170 wide between a band's tile top and the player name above it (the name is centred about 175 px above the tiles of a recap band, 70 px above the first row of a suggestion). */
const RECAP_NAME_ABOVE = 175;
const SUGGESTION_NAME_ABOVE = 70;
/** Rows of one player are about 195 px apart in the suggestion list; the next player is more than 400 px below. */
const SAME_PLAYER_GAP = 260;

export interface RecapBand {
  ally: FoundRow;
  enemy: FoundRow;
  /** Pixel position of the band's tile tops: the player names lie above it. */
  top: number;
}

/** Pixels at 1170 wide between the tile tops of two neighbouring battles of the recap list: every band is a card of the same height. */
const RECAP_BAND_PITCH = 404;
/** How far a band's tile top may lie from the list's regular spacing before it is fitted again, in pixels at 1170 wide. */
const RECAP_BAND_REACH = 4;

/**
 * The bands of the list lie at one regular spacing, so a band whose tiles were fitted off it (the strong edge of the level label under the
 * tiles can win over the frame) is fitted again at the place the other bands give. The spacing is taken from the most bands that agree.
 */
async function alignedAllies(image: string | Buffer, allies: FoundRow[], width: number, height: number): Promise<FoundRow[]> {
  if (allies.length < 2) return allies;
  const pitch = (RECAP_BAND_PITCH * width) / 1170;
  const reach = (RECAP_BAND_REACH * width) / 1170;
  const offset = (top: number, from: number) => {
    const d = (top - from) % pitch;
    return Math.min(Math.abs(d), pitch - Math.abs(d));
  };
  const agree = (from: number) => allies.filter((a) => offset(boxTop(a), from) <= reach).length;
  const reference = allies.reduce((best, a) => (agree(boxTop(a)) > agree(boxTop(best)) ? a : best));
  if (agree(boxTop(reference)) < 2) return allies;
  const fixed: FoundRow[] = [];
  for (const ally of allies) {
    if (offset(boxTop(ally), boxTop(reference)) <= reach) {
      fixed.push(ally);
      continue;
    }
    const steps = Math.round((boxTop(ally) - boxTop(reference)) / pitch);
    const expected = boxTop(reference) + steps * pitch;
    const again = (await findRows(image, RECAP_ALLY, 1, { left: RECAP_ALLY.window.left, top: [(expected - reach) / height, (expected + reach) / height] }))[0];
    if (again) fixed.push(again);
  }
  return fixed;
}

/** The battles of a Daily Battle Recap picture that show whole, top to bottom: a band whose player names are scrolled off, or that the bottom edge cuts, is left out. */
export async function findRecapBands(image: string | Buffer): Promise<RecapBand[]> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  const bands: RecapBand[] = [];
  const allies = (await findRows(image, RECAP_ALLY, 6)).sort((a, b) => boxTop(a) - boxTop(b));
  for (const ally of (await alignedAllies(image, allies, width, height)).sort((a, b) => boxTop(a) - boxTop(b))) {
    const top = boxTop(ally);
    if (top - (RECAP_NAME_ABOVE * width) / 1170 < LIST_TOP * height || top + ally.boxes[0]!.height + (RECAP_BAND_MARGIN * width) / 1170 > RECAP_LIST_BOTTOM * height) continue;
    // both players' tiles of a band stand at the same height; searching only there keeps a tile whose edges are weak (a hero the viewer does not own) from settling a few pixels off
    const near = { left: RECAP_ENEMY.window.left, top: [top / height, (top + 1) / height] as [number, number] };
    // the pitch and size are known, but a row of weak tiles scores too low for them: it is then fitted with the size left free
    const enemy = (await findRows(image, RECAP_ENEMY, 1, near, true))[0] ?? (await findRows(image, RECAP_ENEMY, 1, near))[0];
    if (enemy) bands.push({ ally, enemy, top });
  }
  return bands;
}

export interface SuggestionPlayer {
  /** The player's team rows, top to bottom. */
  rows: FoundRow[];
  /** Pixel position of the first row's tile tops. */
  top: number;
}

/** The players of an Other Players' Suggestion picture whose name shows, with their team rows; rows cut by the bottom edge are left out. */
export async function findSuggestionPlayers(image: string | Buffer): Promise<SuggestionPlayer[]> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  const rows = (await findRows(image, SUGGESTION_ROW, 12)).filter((row) => boxTop(row) + row.boxes[0]!.height <= LIST_BOTTOM * height).sort((a, b) => boxTop(a) - boxTop(b));
  const players: SuggestionPlayer[] = [];
  for (const row of rows) {
    const last = players[players.length - 1];
    if (last && boxTop(row) - boxTop(last.rows[last.rows.length - 1]!) < (SAME_PLAYER_GAP * width) / 1170) last.rows.push(row);
    else players.push({ rows: [row], top: boxTop(row) });
  }
  return players.filter((p) => p.top - (95 * width) / 1170 >= LIST_TOP * height);
}

export const NAME_ABOVE = { recap: RECAP_NAME_ABOVE, suggestion: SUGGESTION_NAME_ABOVE };
