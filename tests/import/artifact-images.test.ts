import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { chooseIcons, importArtifactImages, parseArtifactPage } from '../../src/import/artifact-images.js';
import type { Fetcher } from '../../src/import/fetch.js';

const section = (id: number, name: string, file: string) =>
  `<section id="artifact-${id}"><div><img src="/images/afk-journey/game/artifacts/${file}" alt=""/></div><h3>${name} Spell</h3></section>`;

/** A page cut down to the real structure; 20 filler entries keep it above the "page changed" threshold. */
const PAGE = `<html><body>${[
  section(8007, 'Bladesummon', 'icon_sys_fairy_ep8_7.aaaaaaaa.webp'),
  section(3006, 'Bladesummon', 'icon_sys_fairy_ep3_6.bbbbbbbb.webp'),
  section(1, 'Awakening', 'icon_sys_fairy_mn_1.cccccccc.webp'),
  section(8005, 'Healwind', 'icon_sys_fairy_ep8_5.dddddddd.webp'),
  ...Array.from({ length: 20 }, (_, i) => section(9000 + i, `Filler${i}`, `icon_sys_fairy_ep9_${i}.eeeeeeee.webp`)),
].join('')}</body></html>`;

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from([1, 2, 3])]);

describe('parseArtifactPage', () => {
  it('reads each artifact with its icon and icon set', () => {
    const found = parseArtifactPage(PAGE);
    expect(found.slice(0, 3)).toEqual([
      { name: 'Bladesummon Spell', path: '/images/afk-journey/game/artifacts/icon_sys_fairy_ep8_7.aaaaaaaa.webp', set: 'ep8' },
      { name: 'Bladesummon Spell', path: '/images/afk-journey/game/artifacts/icon_sys_fairy_ep3_6.bbbbbbbb.webp', set: 'ep3' },
      { name: 'Awakening Spell', path: '/images/afk-journey/game/artifacts/icon_sys_fairy_mn_1.cccccccc.webp', set: 'mn' },
    ]);
  });

  it('refuses a page whose structure has changed', () => {
    expect(() => parseArtifactPage('<html><body><p>Nothing</p></body></html>')).toThrow(/structure has changed/);
  });
});

describe('chooseIcons', () => {
  const site = parseArtifactPage(PAGE);

  it('takes the icon of the artifact’s own season when the name appears in several', () => {
    const { chosen, missing } = chooseIcons(site, [
      { name: 'Bladesummon', grp: 'Season 8' },
      { name: 'Awakening', grp: 'Pre-Season' },
      { name: 'Healwind', grp: 'Season 8' },
      { name: 'Unknown', grp: 'Season 8' },
    ]);
    expect(chosen.get('Bladesummon')!.set).toBe('ep8');
    expect(chosen.get('Awakening')!.set).toBe('mn');
    expect(chosen.get('Healwind')!.set).toBe('ep8');
    expect(missing).toEqual(['Unknown']);
  });

  it('leaves an artifact without an icon when several seasons match and none is its own', () => {
    expect(chooseIcons(site, [{ name: 'Bladesummon', grp: 'Season 7' }]).missing).toEqual(['Bladesummon']);
  });
});

describe('importArtifactImages', () => {
  let dir: string;
  let downloads: string[];
  const fetcher = (bytes: Buffer): Fetcher => ({
    text: async () => PAGE,
    download: async (url, destination) => {
      downloads.push(url);
      writeFileSync(destination, bytes);
    },
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'artifact-img-'));
    downloads = [];
  });

  const database = () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO artifact (name, grp) VALUES ('Bladesummon', 'Season 8'), ('Awakening', 'Pre-Season'), ('Unknown', 'Season 8')").run();
    return db;
  };

  it('downloads each icon, records its path, and lists what it could not find', async () => {
    const db = database();
    const result = await importArtifactImages(db, fetcher(WEBP), dir);
    expect(result).toEqual({ downloaded: 2, missing: ['Unknown'], failed: [] });
    expect(downloads).toContain('https://www.afk.global/images/afk-journey/game/artifacts/icon_sys_fairy_ep8_7.aaaaaaaa.webp');
    expect(db.prepare("SELECT image_path FROM artifact WHERE name = 'Bladesummon'").pluck().get()).toBe('images/artifacts/Bladesummon.webp');
    expect(db.prepare("SELECT image_path FROM artifact WHERE name = 'Unknown'").pluck().get()).toBeNull();
    expect(existsSync(join(dir, 'artifacts', 'Bladesummon.webp'))).toBe(true);
  });

  it('rejects a download that is not really a WebP image, and stops after repeated failures', async () => {
    const db = database();
    const result = await importArtifactImages(db, fetcher(Buffer.from('<html>blocked</html>')), dir);
    expect(result.downloaded).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toMatch(/not a WebP image/);
    expect(existsSync(join(dir, 'artifacts', 'Bladesummon.webp'))).toBe(false);
    expect(db.prepare('SELECT count(*) FROM artifact WHERE image_path IS NOT NULL').pluck().get()).toBe(0);
  });
});
