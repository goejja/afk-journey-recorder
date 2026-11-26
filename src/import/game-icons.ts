import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERO_CLASSES, HERO_FACTIONS } from '../domain/hero-admin.js';
import type { SyncOutcome } from './reference-sync.js';

// The round class and faction icons of the game, as Yaphalla shows them. They are the publisher's art, so they are
// kept in the git-ignored images/ folder and never in a commit; this file is private and the public edition shows letter chips.
const BASE = 'https://res.cloudinary.com/vvib7uec/image/upload/assets/images';
const SETS = [
  { remote: 'class', local: 'class', names: HERO_CLASSES },
  { remote: 'factions', local: 'factions', names: HERO_FACTIONS },
];

/** Saves the class and faction icons into `images/icons`. A file already there is kept unless `refresh` is set. */
export async function syncGameIcons({ fetchImage = fetch, imagesDir = 'images', refresh = false }: { fetchImage?: typeof fetch; imagesDir?: string; refresh?: boolean } = {}): Promise<SyncOutcome> {
  let saved = 0;
  const failed: string[] = [];
  for (const set of SETS) {
    const dir = join(imagesDir, 'icons', set.local);
    mkdirSync(dir, { recursive: true });
    for (const name of set.names) {
      const lower = name.toLowerCase();
      const file = join(dir, `${lower}.png`);
      if (!refresh && existsSync(file)) continue;
      const res = await fetchImage(`${BASE}/${set.remote}/${lower}.png`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        failed.push(`${set.remote}/${lower} (${res.status})`);
        continue;
      }
      writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
      saved += 1;
    }
  }
  return { lines: [`Game icons: ${saved} saved into ${imagesDir}/icons`], warnings: failed.length ? [`Failed: ${failed.join(', ')}`] : [] };
}
