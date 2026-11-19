import type Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';

let db: Database.Database;
let app: Hono;
let images: string;

beforeEach(() => {
  db = openDb(':memory:');
  images = mkdtempSync(join(tmpdir(), 'afk-findings-'));
  app = createApp(db, { imagesDir: images });
});

const findings = async () => (await app.request('/api/admin/review/findings')).json() as Promise<{ wrong: any[]; obsolete: any[]; improve: any[]; kept: any[] }>;
const rankLooks = (rank: string, count: number) => {
  for (let i = 0; i < count; i++) db.prepare('INSERT INTO rank_look (rank, file) VALUES (?, ?)').run(rank, `${rank}-${i}.png`);
};

describe('the Improve findings', () => {
  it('names a rank seen fewer than three times, because the rank reader names a rank only after three', async () => {
    rankLooks('Paragon 3', 2);
    rankLooks('Supreme+', 3);
    const { improve } = await findings();
    expect(improve.map((f) => [f.code, f.subject])).toEqual([['rank-few-looks', 'Paragon 3']]);
    expect(improve[0].message).toContain('2');
  });

  it('names a hero with no example and no look, in name order, and not one that has either', async () => {
    for (const name of ['Zed', 'Evie', 'Fay', 'Anya']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
    db.prepare('INSERT INTO hero_example (hero_name, file) VALUES (?, ?)').run('Evie', 'evie.png');
    db.prepare('INSERT INTO hero_look (hero_name, file) VALUES (?, ?)').run('Fay', 'fay.png');
    const { improve } = await findings();
    expect(improve.map((f) => [f.code, f.subject])).toEqual([['hero-no-example', 'Anya'], ['hero-no-example', 'Zed']]);
  });
});

describe('the Obsolete findings', () => {
  const file = (folder: string, name: string) => {
    mkdirSync(join(images, 'custom', folder), { recursive: true });
    writeFileSync(join(images, 'custom', folder, name), 'x');
  };

  it('names a learned picture file that no row references, in each of the four learned folders, and no referenced one', async () => {
    db.prepare('INSERT INTO hero (name) VALUES (?)').run('Evie');
    db.prepare('INSERT INTO rank_look (rank, file) VALUES (?, ?)').run('Supreme+', 'kept-rank.png');
    db.prepare('INSERT INTO hero_example (hero_name, file) VALUES (?, ?)').run('Evie', 'kept-example.png');
    db.prepare('INSERT INTO hero_look (hero_name, file) VALUES (?, ?)').run('Evie', 'kept-look.png');
    db.prepare('INSERT INTO unit_look (kind, name, file) VALUES (?, ?, ?)').run('artifact', 'Arc Burst', 'kept-unit.png');
    for (const [folder, kept] of [['rank-look', 'kept-rank.png'], ['hero-example', 'kept-example.png'], ['look', 'kept-look.png'], ['unit-look', 'kept-unit.png']] as const) {
      file(folder, kept);
      file(folder, 'stray.png');
    }
    file('rank-look', '.DS_Store'); // a hidden file is the system's, not a picture
    file('hero', 'portrait.png'); // a folder whose files are not learned pictures is not judged
    const { obsolete } = await findings();
    expect(obsolete.map((f) => [f.code, f.subject]).sort()).toEqual(
      ['hero-example', 'look', 'rank-look', 'unit-look'].map((folder) => ['unreferenced-file', `${folder}/stray.png`]),
    );
  });
});

describe('deleting unreferenced files', () => {
  const post = (body: unknown) => app.request('/api/admin/review/files/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const put = (folder: string, name: string) => {
    mkdirSync(join(images, 'custom', folder), { recursive: true });
    writeFileSync(join(images, 'custom', folder, name), 'x');
    return join(images, 'custom', folder, name);
  };

  it('removes the files the findings offer and leaves the others', async () => {
    const stray = put('rank-look', 'stray.png');
    const other = put('look', 'other.png');
    const response = await post({ files: ['rank-look/stray.png'] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1 });
    expect(existsSync(stray)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });

  it('removes the other files and names the ones it could not remove, instead of stopping at the first', async () => {
    const locked = put('rank-look', 'locked.png');
    const free = put('look', 'free.png');
    chmodSync(join(images, 'custom', 'rank-look'), 0o500); // a folder that cannot be written to: its file cannot be removed
    try {
      const response = await post({ files: ['rank-look/locked.png', 'look/free.png'] });
      expect(response.status).toBe(500);
      expect(((await response.json()) as { error: string }).error).toMatch(/Removed 1 of 2.*rank-look\/locked\.png/);
      expect(existsSync(free)).toBe(false);
      expect(existsSync(locked)).toBe(true);
    } finally {
      chmodSync(join(images, 'custom', 'rank-look'), 0o700);
    }
  });

  it('counts a file listed twice once', async () => {
    const stray = put('rank-look', 'stray.png');
    const response = await post({ files: ['rank-look/stray.png', 'rank-look/stray.png'] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1 });
    expect(existsSync(stray)).toBe(false);
  });

  it('refuses the whole request when a file is referenced by a row, is outside the offered folders, or is unknown, removing nothing', async () => {
    db.prepare('INSERT INTO rank_look (rank, file) VALUES (?, ?)').run('Supreme+', 'kept.png');
    const kept = put('rank-look', 'kept.png');
    const stray = put('rank-look', 'stray.png');
    const portrait = put('hero', 'portrait.png');
    for (const files of [['rank-look/kept.png'], ['rank-look/stray.png', 'rank-look/kept.png'], ['hero/portrait.png'], ['../hero/portrait.png'], ['rank-look/../look/x.png'], ['rank-look/missing.png']]) {
      expect((await post({ files })).status).toBe(409);
    }
    for (const file of [kept, stray, portrait]) expect(existsSync(file)).toBe(true);
  });

  it('answers 400 to a body that is not a list of file names', async () => {
    for (const body of [{}, { files: [] }, { files: 'all' }, { files: [3] }, null]) expect((await post(body)).status).toBe(400);
  });
});

describe('the pictures kept for a purpose', () => {
  const write = (path: string[], content: string, date: string) => {
    mkdirSync(join(images, ...path.slice(0, -1)), { recursive: true });
    const file = join(images, ...path);
    writeFileSync(file, content);
    utimesSync(file, new Date(`${date}T12:00:00Z`), new Date(`${date}T12:00:00Z`));
  };

  it('shows the count, the size and the oldest date of the Kept pictures and of the Hero Looks, and offers no removal', async () => {
    write(['imports', 'report', 'a.jpg'], 'ab', '2026-03-05');
    write(['imports', 'battle', 'b.jpg'], 'abc', '2026-01-02');
    write(['custom', 'look', 'skin.png'], 'abcd', '2026-02-10');
    const { kept, obsolete } = await findings();
    expect(kept).toEqual([
      { category: 'Kept pictures', files: 2, bytes: 5, oldest: '2026-01-02' },
      { category: 'Hero Looks', files: 1, bytes: 4, oldest: '2026-02-10' },
    ]);
    // the Hero Look has no row here, so it is also unreferenced; the Kept pictures are never called obsolete on their own
    expect(obsolete.map((f) => f.subject)).toEqual(['look/skin.png']);
  });

  it('leaves out a category with no file', async () => {
    expect((await findings()).kept).toEqual([]);
  });
});

/** A tile picture: a top of one colour with a band of another over a plain body (as in review-thinning-api.test). */
const tile = (top: [number, number, number], band: [number, number, number]) =>
  sharp({ create: { width: 90, height: 150, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .composite([
      { input: { create: { width: 90, height: 40, channels: 3, background: { r: top[0], g: top[1], b: top[2] } } }, left: 0, top: 0 },
      { input: { create: { width: 50, height: 12, channels: 3, background: { r: band[0], g: band[1], b: band[2] } } }, left: 20, top: 6 },
    ])
    .png()
    .toBuffer();

describe('the Wrong findings', () => {
  const rankLook = async (rank: string, png: Buffer) => {
    mkdirSync(join(images, 'custom', 'rank-look'), { recursive: true });
    const id = Number(db.prepare('INSERT INTO rank_look (rank, file) VALUES (?, ?)').run(rank, 'x').lastInsertRowid);
    db.prepare('UPDATE rank_look SET file = ? WHERE id = ?').run(`${id}.png`, id);
    writeFileSync(join(images, 'custom', 'rank-look', `${id}.png`), png);
    return id;
  };
  const GREEN: [number, number, number][] = [[21, 181, 26], [56, 202, 69]];
  const PURPLE: [number, number, number][] = [[91, 90, 131], [163, 100, 121]];

  it('names a Rank Look the others read as another rank, with both ranks, and no look they read as its own', async () => {
    for (let i = 0; i < 3; i++) await rankLook('R1', await tile(GREEN[0]!, GREEN[1]!));
    for (let i = 0; i < 3; i++) await rankLook('R2', await tile(PURPLE[0]!, PURPLE[1]!));
    const stray = await rankLook('R1', await tile(PURPLE[0]!, PURPLE[1]!)); // a purple frame filed under R1
    const { wrong } = await findings();
    expect(wrong.map((f) => [f.code, f.subject])).toEqual([['rank-look-misread', String(stray)]]);
    expect(wrong[0].message).toContain('R1');
    expect(wrong[0].message).toContain('R2');
    expect(wrong[0]).toMatchObject({ filedUnder: 'R1', readAs: 'R2' });
  });

  it('names a stored record whose Phantimal its heroes cannot have brought, with the reason, and links it by its record id', async () => {
    for (const [name, faction] of [['A', 'Lightbearer'], ['C', 'Wilder'], ['D', 'Wilder']] as const) db.prepare('INSERT INTO hero (name, faction) VALUES (?, ?)').run(name, faction);
    db.prepare("INSERT INTO phantimal (name, faction) VALUES ('Gervan', 'Lightbearer')").run();
    db.prepare("INSERT OR IGNORE INTO map (name, tags, row_lengths, cells, source) VALUES ('Alpha', '[\"Arena\"]', '[2,5,6,6,7,6,6,5,2]', ?, 'manual')").run(
      JSON.stringify(Array.from({ length: 45 }, (_, i) => (i < 5 ? -1 : i >= 38 ? 1 : -2))),
    );
    const battle = db.prepare("INSERT INTO attempt (mode, outcome) VALUES ('Arena', 'Win')").run().lastInsertRowid as number;
    const formation = db.prepare("INSERT INTO formation (attempt_id, phantimal_name, phantimal_tile) VALUES (?, 'Gervan', 40)").run(battle).lastInsertRowid as number;
    for (const [i, hero] of ['A', 'C', 'D'].entries()) db.prepare('INSERT INTO formation_hero (formation_id, tile, hero_name) VALUES (?, ?, ?)').run(formation, 38 + i, hero);
    db.prepare("INSERT INTO arena_attempt (attempt_id, mode, map_name) VALUES (?, 'Supreme Arena', 'Alpha')").run(battle);
    const { wrong } = await findings();
    expect(wrong.map((f) => [f.code, f.subject])).toEqual([['record-phantimal-faction', String(battle)]]);
    expect(wrong[0].message).toContain('Gervan needs 3 Lightbearer heroes; this team has 1');
  });

  describe('a roster rank below the latest recorded one', () => {
    /** A record whose Side A fielded `hero` at `rank`; `player` names the Player behind Side A of an Arena record (null for none). */
    const record = (mode: 'Stage' | 'Arena', hero: string, rank: string, player: string | null = null) => {
      const battle = db.prepare('INSERT INTO attempt (mode, outcome) VALUES (?, ?)').run(mode, 'Win').lastInsertRowid as number;
      const formation = db.prepare('INSERT INTO formation (attempt_id) VALUES (?)').run(battle).lastInsertRowid as number;
      db.prepare('INSERT INTO formation_hero (formation_id, tile, hero_name, rank) VALUES (?, 38, ?, ?)').run(formation, hero, rank);
      if (player) db.prepare("INSERT INTO attempt_player (attempt_id, side, player_id) VALUES (?, 'A', ?)").run(battle, player);
      return battle;
    };
    beforeEach(() => {
      for (const [position, name] of ['Elite', 'Epic', 'Legend'].entries()) db.prepare('INSERT INTO rank (name, position) VALUES (?, ?)').run(name, position);
      for (const name of ['A', 'B', 'C', 'D']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
      db.prepare("UPDATE profile SET player_id = 'P1' WHERE is_default = 1").run();
    });
    const roster = (hero: string, rank: string) => db.prepare('INSERT INTO roster (hero_name, rank) VALUES (?, ?)').run(hero, rank);

    it('asks to check a hero whose roster rank is below its rank in the latest record of the owner, linking that record', async () => {
      record('Stage', 'A', 'Epic');
      const latest = record('Stage', 'A', 'Legend');
      roster('A', 'Epic');
      const { wrong } = await findings();
      expect(wrong).toHaveLength(1);
      expect(wrong[0]).toMatchObject({ code: 'roster-below-record', subject: 'A', recordId: latest });
      expect(wrong[0].message).toMatch(/Epic.*Legend|Legend.*Epic/);
      expect(wrong[0].message).toContain('check');
    });

    it('says nothing when the roster is at or above the latest record, or when the latest record shows a lower rank', async () => {
      record('Stage', 'B', 'Legend');
      roster('B', 'Legend');
      record('Stage', 'C', 'Legend'); // an older, higher record...
      record('Stage', 'C', 'Epic'); // ...then the latest is lower, and the roster matches it
      roster('C', 'Epic');
      expect((await findings()).wrong).toEqual([]);
    });

    it('ignores the matches of other Players, and counts an Arena record only of the owner', async () => {
      record('Arena', 'D', 'Legend', 'P2'); // someone else's match
      roster('D', 'Epic');
      expect((await findings()).wrong).toEqual([]);
      const own = record('Arena', 'D', 'Legend', 'p1'); // the owner's Player ID, whatever its case
      expect((await findings()).wrong).toMatchObject([{ code: 'roster-below-record', subject: 'D', recordId: own }]);
    });
  });
});
