import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, vi } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { storeReferenceData } from '../../src/import/store-reference.js';
import { createApp } from '../../src/server/app.js';
import type { AgentRunner } from '../../src/server/agent/scenario-run.js';

export const WIDTH = 1170;
export const HEIGHT = 2532;

/** A picture with three rows of five frames where the Player Info screen has its teams (synthetic: no real screenshot is kept in the repository). */
export async function infoPicture(): Promise<Buffer> {
  const data = Buffer.alloc(WIDTH * HEIGHT * 3, 110);
  const fill = (left: number, top: number, width: number, height: number, value: number) => {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) data.fill(value, (y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3);
  };
  for (const [left, top] of [[77, 1283], [617, 1283], [77, 1563]] as const) {
    for (let i = 0; i < 5; i++) {
      fill(left + i * 97, top, 93, 121, 235);
      fill(left + i * 97 + 6, top + 6, 81, 109, 40);
    }
  }
  return sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
}
/** A PvP battle report: the ally's five tiles stacked on the left of the upper panel, the enemy's in the lower one. */
export async function reportPicture(): Promise<Buffer> {
  const data = Buffer.alloc(WIDTH * HEIGHT * 3, 110);
  const fill = (left: number, top: number, width: number, height: number, value: number) => {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) data.fill(value, (y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3);
  };
  for (const [left, top] of [[63, 716], [67, 1418]] as const) {
    for (let i = 0; i < 5; i++) {
      fill(left, top + i * 98, 64, 90, 235);
      fill(left + 6, top + i * 98 + 6, 52, 78, 40);
    }
  }
  return sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
}
export const blankPicture = () => sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#707070' } }).png().toBuffer();

export const tile = (hero: string | null, rank: string, extra: Record<string, unknown> = {}) => ({ hero, candidates: [], rank, confident: true, ...extra });
export const team = (...tiles: ReturnType<typeof tile>[]) => [...tiles, ...Array.from({ length: 5 - tiles.length }, () => tile(null, 'Epic'))];

/**
 * What the roster import tests share: an in-memory database, an app whose agent is the fake `runner` (it prints what `reply` returns),
 * and the folders the app writes to. Call it once at the top of a test file; a test may replace `app` or `reply`.
 */
export function importFixture() {
  // reading a 1170 x 2532 picture takes a moment, more so when many test files run at once
  vi.setConfig({ testTimeout: 30_000 });

  const t = {
    db: undefined as unknown as Database.Database,
    app: undefined as unknown as Hono,
    work: '',
    images: '',
    calls: [] as Parameters<AgentRunner>[],
    /** What the fake agent prints; a function so that a test can read the command it was given. */
    reply: (() => '') as (command: Parameters<AgentRunner>[0]) => string | Promise<string>,
  };

  const fakeRunner: AgentRunner = async (command, options) => {
    t.calls.push([command, options]);
    return new Promise<string>((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Cancelled')));
      Promise.resolve(t.reply(command)).then(resolve, reject);
    });
  };

  beforeEach(() => {
    t.calls = [];
    t.work = mkdtempSync(join(tmpdir(), 'afk-import-'));
    t.images = mkdtempSync(join(tmpdir(), 'afk-images-'));
    const db = (t.db = openDb(':memory:'));
    storeReferenceData(db, {
      ranks: ['Epic', 'Mythic+', 'Supreme', 'Supreme+', 'Paragon 1'].map((name, position) => ({ name, position })),
      equipmentLevels: [0, 5, 10, 15, 20, 25],
      rankEquipmentCaps: ['Supreme', 'Supreme+', 'Paragon 1'].map((rank) => ({ rank, minLevel: null, maxLevel: 25 })),
      artifacts: [],
      phantimals: [],
    });
    for (const name of ['Evie', 'Thador', 'Valka', 'Nara']) {
      db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type) VALUES (?, 'S', 'Mage', 'Wilder', 'Magic')").run(name);
    }
    db.prepare("UPDATE profile SET name = 'Brin' WHERE is_default = 1").run();
    db.prepare("INSERT INTO profile (name) VALUES ('Mokka')").run();
    db.prepare("INSERT INTO roster (profile_id, hero_name, rank, equipment_level) VALUES (1, 'Evie', 'Supreme+', 10)").run();
    t.app = createApp(db, { agentRunner: fakeRunner, imagesDir: t.images, importWorkDir: t.work, importConcurrency: 1 });
    t.reply = () =>
      JSON.stringify({
        players: [{ name: 'Мокка', crops: { team1: team(tile('Evie', 'Paragon 1'), tile('Thador', 'Supreme'), tile(null, 'Supreme+', { candidates: ['Valka', 'Nara'], confident: false })), team2: team(), team3: team() } }],
      });
  });

  afterEach(() => {
    rmSync(t.work, { recursive: true, force: true });
    rmSync(t.images, { recursive: true, force: true });
  });

  const post = (url: string, body?: unknown, action = url.endsWith('/apply') ? 'apply' : url.endsWith('/cancel') ? 'cancel' : 'import') =>
    t.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-afk-action': action }, body: body === undefined ? undefined : JSON.stringify(body) });
  const upload = async (screen = 'info', picture?: Buffer, query = '') =>
    t.app.request(`/api/roster-import?screen=${screen}${query}`, { method: 'POST', headers: { 'x-afk-action': 'import', 'content-type': 'image/png' }, body: new Uint8Array(picture ?? (await infoPicture())) });
  const json = async (response: Response | Promise<Response>) => (await response).json() as Promise<any>;
  const state = () => json(t.app.request('/api/roster-import'));
  async function until(done: () => boolean) {
    for (let i = 0; i < 300 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  async function finished() {
    for (let i = 0; i < 200; i++) {
      const current = await state();
      if (current.job && current.job.state !== 'running' && current.job.state !== 'queued') return current.job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the import did not finish');
  }

  return Object.assign(t, { fakeRunner, post, upload, json, state, until, finished });
}
