import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { planPicture } from '../../../src/server/reader/import-pictures.js';
import { importFixture, WIDTH, HEIGHT, tile, team } from '../../support/roster-import.js';

const t = importFixture();
const { upload, json, until } = t;

/** A report whose tiles are not flat: each has its own noise, so that the readers can tell a tile from a blank one and from another. */
async function noisyReportPicture(): Promise<Buffer> {
  const data = Buffer.alloc(WIDTH * HEIGHT * 3, 110);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) >> 8) % 200;
  for (const [left, top] of [[63, 716], [67, 1418]] as const) {
    for (let i = 0; i < 5; i++) {
      for (let y = top + i * 98; y < top + i * 98 + 90; y++) {
        for (let x = left; x < left + 64; x++) {
          const edge = y < top + i * 98 + 6 || y >= top + i * 98 + 84 || x < left + 6 || x >= left + 58;
          const value = edge ? 235 : noise();
          data.fill(value, (y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3);
        }
      }
    }
  }
  return sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
}

/** The picture with the artifact icon of each side painted in its own colour, so that the unit reader can tell them apart. */
async function withArtifacts(picture: Buffer, colours: [number, number, number][]): Promise<Buffer> {
  const plan = await planPicture(picture, 'report');
  return sharp(picture)
    .composite(plan.extras!.map((side, i) => ({ input: { create: { width: side.artifact.width, height: side.artifact.height, channels: 3 as const, background: { r: colours[i]![0], g: colours[i]![1], b: colours[i]![2] } } }, left: side.artifact.left, top: side.artifact.top })))
    .png()
    .toBuffer();
}

describe('tiles the local readers know', () => {
  const sureReply = () =>
    JSON.stringify({
      fight: { number: 1, ally: 'won', unionLevelAlly: null, unionLevelEnemy: null },
      players: [{ name: 'Brin', crops: {} }, { name: 'Rover', crops: {} }],
    });

  /** Teaches the readers every tile of the picture: its hero and its rank, as a confirmed roster import would. */
  async function teach(picture: Buffer, heroes: string[]) {
    const plan = await planPicture(picture, 'report');
    mkdirSync(join(t.images, 'custom', 'hero-example'), { recursive: true });
    mkdirSync(join(t.images, 'custom', 'rank-look'), { recursive: true });
    let n = 0;
    for (const crops of plan.players) {
      for (const crop of crops) {
        for (const [i, box] of crop.boxes.entries()) {
          const top = Math.min(box.top, Math.round(box.height * 0.12));
          const png = await sharp(picture).extract({ ...box, top: box.top - top, height: box.height + top }).png().toBuffer();
          const file = `t${n++}.png`;
          writeFileSync(join(t.images, 'custom', 'hero-example', file), png);
          writeFileSync(join(t.images, 'custom', 'rank-look', file), png);
          t.db.prepare('INSERT INTO hero_example (hero_name, file) VALUES (?, ?)').run(heroes[i % heroes.length], file);
          t.db.prepare("INSERT INTO rank_look (rank, file) VALUES ('Supreme', ?)").run(file);
        }
      }
    }
  }

  it('does not send the strips or hero sheets the readers are sure of, and still gives their heroes', async () => {
    const picture = await noisyReportPicture();
    await teach(picture, ['Evie', 'Thador', 'Valka', 'Nara', 'Evie']);
    t.reply = sureReply;
    await upload('report', picture, '&mode=Guild%20Duel');
    await until(() => t.calls.length === 1);
    const prompt = String(t.calls[0]![0].args.join(' '));
    expect(prompt).not.toContain('ally" (5 tiles)');
    expect(prompt).not.toContain('Reference portraits of every known hero');
    for (let i = 0; i < 300 && (await json(t.app.request('/api/roster-import?kind=report'))).queue.some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const draft = (await json(t.app.request('/api/roster-import?kind=report'))).queue[0].draft;
    expect(draft.sideA.heroes.map((h: any) => [h.hero, h.rank])).toEqual([['Evie', 'Supreme'], ['Thador', 'Supreme'], ['Valka', 'Supreme'], ['Nara', 'Supreme'], ['Evie', 'Supreme']]);
  });

  it('logs how much of each picture the local readers spared the Agent', async () => {
    const picture = await noisyReportPicture();
    await teach(picture, ['Evie', 'Thador', 'Valka', 'Nara', 'Evie']);
    t.reply = sureReply;
    await upload('report', picture, '&mode=Guild%20Duel');
    await until(() => t.calls.length === 1);
    await until(() => (t.db.prepare('SELECT count(*) FROM import_run').pluck().get() as number) === 1);
    expect(t.db.prepare('SELECT screen, mode, fresh, strips_total, strips_known, tiles_total, tiles_sent, agent_called FROM import_run').all()).toEqual([
      { screen: 'report', mode: 'Guild Duel', fresh: 0, strips_total: 2, strips_known: 2, tiles_total: 10, tiles_sent: 0, agent_called: 1 },
    ]);
    expect(t.db.prepare('SELECT strips_known_percent AS s, tiles_sent_percent AS t FROM v_import_skip_rate').get()).toEqual({ s: 100, t: 0 });
  });

  it('logs a picture read again as one the Agent was asked about in full', async () => {
    const picture = await noisyReportPicture();
    await teach(picture, ['Evie', 'Thador', 'Valka', 'Nara', 'Evie']);
    t.reply = () => JSON.stringify({ players: [{ name: 'Brin', crops: { ally: team(tile('Evie', 'Supreme')) } }, { name: 'Rover', crops: { enemy: team(tile('Valka', 'Supreme')) } }] });
    await upload('report', picture, '&mode=Guild%20Duel&fresh=1');
    await until(() => (t.db.prepare('SELECT count(*) FROM import_run').pluck().get() as number) === 1);
    expect(t.db.prepare('SELECT fresh, strips_known, tiles_sent, agent_called FROM import_run').get()).toEqual({ fresh: 1, strips_known: 0, tiles_sent: 10, agent_called: 1 });
  });

  it('asks the Agent only about the tiles the readers do not know', async () => {
    const picture = await noisyReportPicture();
    await teach(picture, ['Evie', 'Thador', 'Valka', 'Nara', 'Evie']);
    t.db.prepare("DELETE FROM hero_example WHERE id = 1").run();
    t.reply = () => JSON.stringify({ players: [{ name: 'Brin', crops: { ally: team(tile('Evie', 'Supreme')) } }, { name: 'Rover', crops: { enemy: team(tile('Valka', 'Supreme')) } }] });
    await upload('report', picture, '&mode=Guild%20Duel');
    await until(() => t.calls.length === 1);
    const prompt = String(t.calls[0]![0].args.join(' '));
    expect(prompt).toContain('"ally" (1 tile)'); // the ally has a tile the hero reader has no example of
    expect(prompt).not.toContain('"enemy"'); // and the enemy's five are all known
    await until(() => (t.db.prepare('SELECT count(*) FROM import_run').pluck().get() as number) === 1);
    expect(t.db.prepare('SELECT strips_known, tiles_total, tiles_sent FROM import_run').get()).toEqual({ strips_known: 1, tiles_total: 10, tiles_sent: 1 });
  });

  it('does not send the artifact crops or sheets of sides whose artifact the reader knows, and gives their names', async () => {
    const picture = await withArtifacts(await noisyReportPicture(), [[220, 40, 40], [40, 40, 220]]);
    await teach(picture, ['Evie', 'Thador', 'Valka', 'Nara', 'Evie']);
    t.db.prepare("INSERT INTO artifact (name, grp) VALUES ('Bladestorm', 'Pre-Season'), ('Coreforge', 'Pre-Season')").run();
    const plan = await planPicture(picture, 'report');
    mkdirSync(join(t.images, 'custom', 'unit-look'), { recursive: true });
    for (const [side, name] of ['Bladestorm', 'Coreforge'].entries()) {
      const png = await sharp(picture).extract(plan.extras![side]!.artifact).png().toBuffer();
      for (let i = 0; i < 3; i++) {
        const file = `${name}-${i}.png`;
        writeFileSync(join(t.images, 'custom', 'unit-look', file), png);
        t.db.prepare("INSERT INTO unit_look (kind, name, file) VALUES ('artifact', ?, ?)").run(name, file);
      }
    }
    t.reply = () => JSON.stringify({ fight: { number: 1, ally: 'won', unionLevelAlly: null, unionLevelEnemy: null }, players: [{ name: 'Brin', phantimal: null, crops: {} }, { name: 'Rover', phantimal: null, crops: {} }] });
    await upload('report', picture, '&mode=Guild%20Duel');
    await until(() => t.calls.length === 1);
    const prompt = String(t.calls[0]![0].args.join(' '));
    expect(prompt).not.toContain('artifact-1.png');
    expect(prompt).not.toContain('Reference artifacts');
    expect(prompt).toContain('phantimal-1.png');
    for (let i = 0; i < 300 && (await json(t.app.request('/api/roster-import?kind=report'))).queue.some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const draft = (await json(t.app.request('/api/roster-import?kind=report'))).queue[0].draft;
    expect([draft.sideA.artifact, draft.sideB.artifact]).toEqual([{ name: 'Bladestorm', level: null }, { name: 'Coreforge', level: null }]);
  });

  it('still asks the Agent for the artifacts when the picture is read again', async () => {
    const picture = await withArtifacts(await noisyReportPicture(), [[220, 40, 40], [40, 40, 220]]);
    await teach(picture, ['Evie', 'Thador', 'Valka', 'Nara', 'Evie']);
    t.db.prepare("INSERT INTO artifact (name, grp) VALUES ('Bladestorm', 'Pre-Season')").run();
    const plan = await planPicture(picture, 'report');
    mkdirSync(join(t.images, 'custom', 'unit-look'), { recursive: true });
    const png = await sharp(picture).extract(plan.extras![0]!.artifact).png().toBuffer();
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(t.images, 'custom', 'unit-look', `b${i}.png`), png);
      t.db.prepare("INSERT INTO unit_look (kind, name, file) VALUES ('artifact', 'Bladestorm', ?)").run(`b${i}.png`);
    }
    t.reply = sureReply;
    await upload('report', picture, '&mode=Guild%20Duel&fresh=1');
    await until(() => t.calls.length === 1);
    expect(String(t.calls[0]![0].args.join(' '))).toContain('artifact-1.png');
  });

  it('asks for all five tiles of each strip when the picture is read again', async () => {
    const picture = await noisyReportPicture();
    await teach(picture, ['Evie', 'Thador', 'Valka', 'Nara', 'Evie']);
    t.reply = sureReply;
    await upload('report', picture, '&mode=Guild%20Duel&fresh=1');
    await until(() => t.calls.length === 1);
    const prompt = String(t.calls[0]![0].args.join(' '));
    expect(prompt).toContain('"ally" (5 tiles)');
    expect(prompt).toContain('"enemy" (5 tiles)');
  });

  it('names a tile the Agent left unnamed when the hero reader is sure of it', async () => {
    const picture = await noisyReportPicture();
    await teach(picture, ['Evie', 'Thador', 'Valka', 'Nara', 'Evie']);
    t.db.prepare('DELETE FROM hero_example WHERE id = 1').run(); // the Agent is asked about the ally, who has a tile the reader does not know
    t.reply = () => JSON.stringify({ players: [{ name: 'Brin', crops: { ally: team(tile('Evie', 'Supreme')) } }, { name: 'Rover', crops: { enemy: team(tile('Valka', 'Supreme')) } }] });
    await upload('report', picture, '&mode=Guild%20Duel');
    for (let i = 0; i < 300 && (await json(t.app.request('/api/roster-import?kind=report'))).queue.some((q: any) => q.state !== 'done'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const draft = (await json(t.app.request('/api/roster-import?kind=report'))).queue[0].draft;
    // the four tiles the Agent left unnamed are the heroes the player confirmed on them
    expect(draft.sideA.heroes.map((h: any) => h.hero)).toEqual(['Evie', 'Thador', 'Valka', 'Nara', 'Evie']);
  });
});
