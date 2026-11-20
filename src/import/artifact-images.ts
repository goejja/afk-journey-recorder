import type Database from 'better-sqlite3';
import { parse } from 'node-html-parser';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { safeFileName } from '../domain/file-name.js';
import type { Fetcher } from './fetch.js';

const ORIGIN = 'https://www.afk.global';
const PAGE = `${ORIGIN}/afk-journey/artifacts`;
const IMAGE_DIR = '/images/afk-journey/game/artifacts/';
const MAX_CONSECUTIVE_FAILURES = 3;

export interface SiteArtifact {
  name: string;
  /** The image's path on the site. */
  path: string;
  /** Which season's icon set it belongs to: "mn" (the pre-season set) or "ep7", "ep8"... */
  set: string;
}

const normalize = (name: string) => name.toLowerCase().replace(/\bspell\b/g, '').replace(/[^a-z0-9]/g, '');

/** The artifacts on the page, each with its icon. The page is read as data; nothing in it is run. */
export function parseArtifactPage(html: string): SiteArtifact[] {
  const found: SiteArtifact[] = [];
  for (const section of parse(html).querySelectorAll('section[id^="artifact-"]')) {
    const name = section.querySelector('h3')?.text.trim();
    const path = section.querySelectorAll('img').map((i) => i.getAttribute('src') ?? '').find((src) => src.startsWith(IMAGE_DIR));
    const set = path?.match(/icon_sys_fairy_(mn|ep\d+)_/)?.[1];
    if (name && path && set) found.push({ name, path, set });
  }
  if (found.length < 20) throw new Error(`Only ${found.length} artifacts found on ${PAGE}: the page structure has changed`);
  return found;
}

/** Our group name's icon set: "Pre-Season" uses "mn", "Season 8" uses "ep8". */
const setOf = (group: string) => (/^season (\d+)$/i.exec(group.trim())?.[1] ? `ep${/(\d+)/.exec(group)![1]}` : 'mn');

/**
 * Pairs our artifacts with the site's icons by name. A name that appears in several seasons takes the
 * icon of our artifact's own season; if that cannot decide, the artifact is left without one.
 */
export function chooseIcons(site: SiteArtifact[], ours: { name: string; grp: string }[]): { chosen: Map<string, SiteArtifact>; missing: string[] } {
  const byName = new Map<string, SiteArtifact[]>();
  for (const a of site) byName.set(normalize(a.name), [...(byName.get(normalize(a.name)) ?? []), a]);
  const chosen = new Map<string, SiteArtifact>();
  const missing: string[] = [];
  for (const { name, grp } of ours) {
    const candidates = byName.get(normalize(name)) ?? [];
    const own = candidates.filter((c) => c.set === setOf(grp));
    const pick = own.length === 1 ? own[0] : candidates.length === 1 ? candidates[0] : undefined;
    if (pick) chosen.set(name, pick);
    else missing.push(name);
  }
  return { chosen, missing };
}

const isWebp = (bytes: Buffer) => bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';

export interface ArtifactImageResult {
  downloaded: number;
  missing: string[];
  failed: string[];
}

/** Downloads each artifact's icon and records its path. Stops after a few failures in a row, as the other image imports do. */
export async function importArtifactImages(db: Database.Database, fetcher: Fetcher, imagesDir = 'images'): Promise<ArtifactImageResult> {
  const site = parseArtifactPage(await fetcher.text(PAGE));
  const ours = db.prepare('SELECT name, grp FROM artifact').all() as { name: string; grp: string }[];
  const { chosen, missing } = chooseIcons(site, ours);
  const dir = join(imagesDir, 'artifacts');
  mkdirSync(dir, { recursive: true });

  const save = db.prepare('UPDATE artifact SET image_path = ? WHERE name = ?');
  const failed: string[] = [];
  let downloaded = 0;
  let consecutive = 0;
  for (const [name, icon] of chosen) {
    const file = join(dir, `${safeFileName(name)}.webp`);
    try {
      await fetcher.download(ORIGIN + icon.path, file);
      if (!isWebp(readFileSync(file))) {
        rmSync(file);
        throw new Error('not a WebP image');
      }
      save.run(`images/artifacts/${safeFileName(name)}.webp`, name);
      downloaded += 1;
      consecutive = 0;
    } catch (e) {
      failed.push(`${name} (${(e as Error).message})`);
      if (++consecutive >= MAX_CONSECUTIVE_FAILURES) break;
    }
  }
  return { downloaded, missing, failed };
}
