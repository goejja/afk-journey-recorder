import type Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import type { ImportScreen } from '../../domain/roster-import.js';
import { findBattleSides, findHallRows, findInfoTeams, findRecapBands, findSuggestionPlayers, NAME_ABOVE, type FoundRow } from '../../vision/tile-detect.js';
import type { TileBox } from '../../vision/tile-image.js';
import { portraitFile } from '../reference/images.js';

/** Where the player name sits on each screen, as fractions of the picture (left, top, width, height). */
const NAME_REGIONS: Partial<Record<ImportScreen, [number, number, number, number]>> = {
  info: [0, 0.311, 0.54, 0.07],
  battle: [0, 0.186, 1, 0.055],
  // the header with the names, titles and Union Levels; the tabs of the fights are added in planPicture
  report: [0, 0.17, 1, 0.075],
};

/** The row of fight tabs of a PvP battle report (the result of each fight is a tick or a cross on it). */
const REPORT_TABS: [number, number, number, number] = [0.3, 0.83, 0.4, 0.05];

/** A row of tiles the Agent is asked to read: `id` names it in the Agent's reply. */
interface CropPlan {
  id: string;
  boxes: TileBox[];
}

/** What a battle report shows of a side besides its five heroes: the artifact beside the name and the phantimal, a round tile under the heroes. */
export interface SideExtras {
  artifact: TileBox;
  phantimal: TileBox;
}

/** The artifact icon of the ally and of the enemy in the header of a report, with its level: left, top, width and height at 1170 px wide. */
const REPORT_ARTIFACT = [[180, 528, 128, 76], [876, 528, 128, 76]] as const;
/** The phantimal's round tile is wider than the hero tiles above it and is cut by the panel's end: how far it reaches left of the first hero tile and how far below the fifth tile's pitch it starts, its width, and the part of its height that shows. */
const REPORT_PHANTIMAL = { left: 12, down: 4, width: 100, height: 70 } as const;

/** The artifact and phantimal boxes of the two sides of a report, the ally first. The phantimal stands where a sixth hero tile would, below the five found. */
export function reportExtras(sides: FoundRow[], width: number, height: number): SideExtras[] {
  const scale = width / 1170;
  const clamp = (box: TileBox): TileBox => {
    const left = Math.max(0, Math.min(box.left, width - 1));
    const top = Math.max(0, Math.min(box.top, height - 1));
    return { left, top, width: Math.max(1, Math.min(box.width, width - left)), height: Math.max(1, Math.min(box.height, height - top)) };
  };
  return sides.map((row, i) => {
    const [left, top, w, h] = REPORT_ARTIFACT[i] ?? REPORT_ARTIFACT[1];
    const first = row.boxes[0]!;
    const pitch = (row.boxes[1]?.top ?? first.top + first.height) - first.top;
    return {
      artifact: clamp({ left: Math.round(left * scale), top: Math.round(top * scale), width: Math.round(w * scale), height: Math.round(h * scale) }),
      phantimal: clamp({ left: first.left - Math.round(REPORT_PHANTIMAL.left * scale), top: first.top + 5 * pitch + Math.round(REPORT_PHANTIMAL.down * scale), width: Math.round(REPORT_PHANTIMAL.width * scale), height: Math.round(REPORT_PHANTIMAL.height * scale) }),
    };
  });
}

export interface PicturePlan {
  /** The crops of each player of the picture, in the order the Agent is asked to reply for them. */
  players: CropPlan[][];
  /** The parts of the picture with player names, top to bottom, when the screen shows names: one for most screens, one per band or player for the Treasure Rush lists. */
  nameRegions: TileBox[];
  /** For a battle report: the artifact and phantimal boxes of each player, in the order of `players`. */
  extras?: SideExtras[];
}

/** The tile rows a picture holds, and which player each belongs to. Throws a message for the user when none are found. */
export async function planPicture(picture: Buffer, screen: ImportScreen): Promise<PicturePlan> {
  const { width = 0, height = 0 } = await sharp(picture).metadata();
  const region = NAME_REGIONS[screen];
  const box = (r: [number, number, number, number]): TileBox => ({ left: Math.round(r[0] * width), top: Math.round(r[1] * height), width: Math.round(r[2] * width), height: Math.round(r[3] * height) });
  const nameRegions: TileBox[] = region ? [box(region), ...(screen === 'report' ? [box(REPORT_TABS)] : [])] : [];
  const crop = (id: string, row: FoundRow): CropPlan => ({ id, boxes: row.boxes });
  if (screen === 'info') {
    const rows = await findInfoTeams(picture);
    const crops = rows.map((row) => crop(`team${row.team}`, row));
    if (crops.length === 0) throw new Error('No hero tiles were found: is this the Player Info screen with the formations?');
    return { players: [crops], nameRegions };
  }
  if (screen === 'recap') {
    const bands = await findRecapBands(picture);
    if (bands.length === 0) throw new Error('No battles were found: is this the Treasure Rush Daily Battle Recap, with the player names showing?');
    const above = Math.round((NAME_ABOVE.recap * width) / 1170);
    // the player's own team is the same in every battle: it is read once, from the first band
    return {
      players: [[crop('ally', bands[0]!.ally)], ...bands.map((band, i) => [crop(`enemy${i + 1}`, band.enemy)])],
      nameRegions: bands.map((band) => ({ left: 0, top: band.top - above - 45, width, height: 90 })),
    };
  }
  if (screen === 'suggestion') {
    const found = await findSuggestionPlayers(picture);
    if (found.length === 0) throw new Error('No team rows were found: is this the Treasure Rush Other Players\' Suggestion list, with the player names showing?');
    const above = Math.round((NAME_ABOVE.suggestion * width) / 1170);
    return {
      players: found.map((player) => player.rows.map((row, i) => crop(`team${i + 1}`, row))),
      nameRegions: found.map((player) => ({ left: Math.round(0.04 * width), top: player.top - above - 40, width: Math.round(0.56 * width), height: 80 })),
    };
  }
  if (screen === 'battle' || screen === 'report') {
    const rows = await findBattleSides(picture);
    if (rows.length === 0) throw new Error('No hero tiles were found: is this a battle result screen?');
    const side = (row: FoundRow) => (row.boxes[0]!.top < height * 0.4 ? 'ally' : 'enemy');
    const sorted = rows.sort((a, b) => a.boxes[0]!.top - b.boxes[0]!.top);
    // the extras are placed by the side (ally on the left, enemy on the right), so a picture where only the enemy was found does not give the ally's
    const extras = screen === 'report' && sorted.length === 2 ? reportExtras(sorted, width, height) : undefined;
    return { players: sorted.map((row) => [crop(side(row), row)]), nameRegions, ...(extras ? { extras } : {}) };
  }
  const rows = await findHallRows(picture);
  if (rows.length === 0) throw new Error('No hero tiles were found: is this the Resonating Hall list?');
  return { players: [rows.map((row, i) => crop(i === 0 && row.boxes.length === 5 ? 'hands' : `row${i + 1}`, row))], nameRegions };
}

/** How far above the detected box the tile is cut, as a share of its height: the top of the frame, whose shape tells the ranks above Supreme apart, sits just above where the edges find the tile. */
const FRAME_TOP = 0.12;

/** The box with the top of the frame in it. */
export const withFrameTop = (box: TileBox): TileBox => {
  const up = Math.min(box.top, Math.round(box.height * FRAME_TOP));
  return { ...box, top: box.top - up, height: box.height + up };
};

/** How far below the detected box the tile is cut for the eye (the Agent's strips and the review), as a share of its height: the edges stop inside the frame's bottom ornament. */
const FRAME_BOTTOM = 0.1;

/** How far beside the detected box the tile is cut for the eye, as a share of its width on each side: the frame's side ornaments reach a few pixels past the edges the detector fits. */
const FRAME_SIDE = 0.04;

/** The box with the whole frame in it, top, bottom and sides, for what is shown to the Agent and to the player. The tile kept for the readers (`withFrameTop`) is not cut below or beside, so that what they learnt from stays comparable. */
const withWholeFrame = (box: TileBox, picture: { width: number; height: number }): TileBox => {
  const framed = withFrameTop(box);
  const down = Math.min(picture.height - (framed.top + framed.height), Math.round(box.height * FRAME_BOTTOM));
  const side = Math.round(box.width * FRAME_SIDE);
  const left = Math.max(0, framed.left - side);
  const right = Math.min(picture.width, framed.left + framed.width + side);
  return { left, top: framed.top, width: right - left, height: framed.height + Math.max(0, down) };
};

const cutWhole = async (picture: Buffer, box: TileBox) => {
  const { width = 0, height = 0 } = await sharp(picture).metadata();
  return sharp(picture).extract(withWholeFrame(box, { width, height }));
};

/** A strip of tiles side by side, enlarged, as one image: the Agent reads tiles best at this size. */
export async function stripOf(picture: Buffer, boxes: TileBox[], tileWidth: number): Promise<Buffer> {
  const tiles = await Promise.all(boxes.map(async (box) => (await cutWhole(picture, box)).resize({ width: tileWidth, kernel: 'lanczos3' }).png().toBuffer()));
  const metas = await Promise.all(tiles.map((tile) => sharp(tile).metadata()));
  const gap = 12;
  const height = Math.max(...metas.map((m) => m.height ?? 0));
  const width = metas.reduce((sum, m) => sum + (m.width ?? 0) + gap, 0);
  let left = 0;
  const parts = tiles.map((input, i) => {
    const part = { input, left, top: 0 };
    left += (metas[i]!.width ?? 0) + gap;
    return part;
  });
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(parts).jpeg({ quality: 90 }).toBuffer();
}

/** The tile alone, small, for the review screen. */
/** The tile with its whole frame, as the review shows it. */
export const wholeTile = async (picture: Buffer, box: TileBox): Promise<Buffer> => (await cutWhole(picture, box)).png().toBuffer();

/** The parts of the picture with the player names, enlarged and stacked in one image. */
export async function nameImage(picture: Buffer, regions: TileBox[]): Promise<Buffer> {
  const width = Math.max(1000, ...regions.map((r) => r.width));
  const parts = await Promise.all(regions.map((region) => sharp(picture).extract(region).resize({ width }).png().toBuffer()));
  const heights = await Promise.all(parts.map(async (part) => (await sharp(part).metadata()).height ?? 0));
  const gap = 10;
  let top = 0;
  const composite = parts.map((input, i) => {
    const part = { input, left: 0, top };
    top += heights[i]! + gap;
    return part;
  });
  return sharp({ create: { width, height: Math.max(1, top - gap), channels: 3, background: '#ffffff' } }).composite(composite).jpeg({ quality: 90 }).toBuffer();
}

const CELL_WIDTH = 150;
const CELL_HEIGHT = 190;
const SHEET_COLUMNS = 8;
const SHEET_ROWS = 5;

const escapeXml = (text: string) => text.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export interface Reference {
  /** The name shown under the picture. */
  label: string;
  file: string;
}

/** The portrait of each artifact or phantimal that has one, then the crops the player confirmed ("seen", as a battle report draws them): what the Agent compares those crops against. */
export function namedReferences(db: Database.Database, imagesDir: string, kind: 'artifact' | 'phantimal'): Reference[] {
  const names = db.prepare(`SELECT name FROM ${kind} ORDER BY name`).pluck().all() as string[];
  const references = names.flatMap((name) => {
    const file = portraitFile(db, imagesDir, kind, name);
    return file ? [{ label: name, file }] : [];
  });
  const looks = db.prepare('SELECT name, file FROM unit_look WHERE kind = ? ORDER BY id').all(kind) as { name: string; file: string }[];
  for (const look of looks) {
    const file = join(imagesDir, 'custom', 'unit-look', look.file);
    if (existsSync(file)) references.push({ label: `${look.name} (seen)`, file });
  }
  return references;
}

/** The portrait of every hero that has one, then the Hero Looks: what the Agent compares tiles against. */
export function heroReferences(db: Database.Database, imagesDir: string): Reference[] {
  const heroes = db.prepare('SELECT name FROM hero ORDER BY name').pluck().all() as string[];
  const references: Reference[] = [];
  for (const name of heroes) {
    const file = portraitFile(db, imagesDir, 'hero', name);
    if (file) references.push({ label: name, file });
  }
  const looks = db.prepare('SELECT hero_name AS hero, file FROM hero_look ORDER BY id').all() as { hero: string; file: string }[];
  for (const look of looks) {
    const file = join(imagesDir, 'custom', 'look', look.file);
    if (existsSync(file)) references.push({ label: `${look.hero} (skin)`, file });
  }
  return references;
}

/** Contact sheets of the references, as JPEG images, each holding up to 40 portraits with their names. */
export async function contactSheets(references: Reference[]): Promise<Buffer[]> {
  const perSheet = SHEET_COLUMNS * SHEET_ROWS;
  const sheets: Buffer[] = [];
  for (let start = 0; start < references.length; start += perSheet) {
    const chunk = references.slice(start, start + perSheet);
    const parts: OverlayOptions[] = [];
    for (const [i, reference] of chunk.entries()) {
      const left = (i % SHEET_COLUMNS) * CELL_WIDTH;
      const top = Math.floor(i / SHEET_COLUMNS) * CELL_HEIGHT;
      parts.push({ input: await sharp(reference.file).resize({ width: CELL_WIDTH - 6, height: CELL_HEIGHT - 28, fit: 'cover', position: 'top' }).png().toBuffer(), left: left + 3, top: top + 2 });
      const label = `<svg width="${CELL_WIDTH}" height="24" xmlns="http://www.w3.org/2000/svg"><text x="${CELL_WIDTH / 2}" y="17" font-size="14" font-family="sans-serif" text-anchor="middle" fill="black">${escapeXml(reference.label)}</text></svg>`;
      parts.push({ input: Buffer.from(label), left, top: top + CELL_HEIGHT - 26 });
    }
    sheets.push(await sharp({ create: { width: SHEET_COLUMNS * CELL_WIDTH, height: Math.ceil(chunk.length / SHEET_COLUMNS) * CELL_HEIGHT, channels: 3, background: '#ffffff' } }).composite(parts).jpeg({ quality: 85 }).toBuffer());
  }
  return sheets;
}
