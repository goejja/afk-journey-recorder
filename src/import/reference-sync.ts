import type Database from 'better-sqlite3';
import { extname } from 'node:path';
import { parseCards, type Card } from './cards.js';
import { discoverChunkUrls } from './discover.js';
import type { Fetcher } from './fetch.js';
import { extractMaps, seedStageMaps, storeArenaMaps } from './maps.js';
import { storeBosses, storeHeroes } from './store-cards.js';
import { storeReferenceData } from './store-reference.js';
import { takeOverLines } from './take-over.js';
import { fetchEnemies, storeEnemies, type Enemy } from './wiki.js';
import { extractReferenceData } from './yaphalla-data.js';

const ORIGIN = 'https://www.yaphalla.com';
const PAGES = ['/editor', '/editor/ascension'];
const MIN_HEROES = 100;
const MIN_BOSSES = 20;
/** The wiki's image server may refuse downloads (HTTP 403). Images are optional, so give up after a few failures in a row. */
const MAX_CONSECUTIVE_IMAGE_FAILURES = 3;

/** What a sync says about itself: the lines of what it did, and the problems that did not stop it. */
export interface SyncOutcome {
  lines: string[];
  warnings: string[];
}

export interface ReferenceSyncOptions {
  /** Reads Yaphalla's pages, scripts and pictures. */
  yaphalla: Fetcher;
  /** Reads the fandom wiki's API and pictures. */
  wiki: Fetcher;
  /** Replaces the importer-owned fields of heroes, bosses and Arena maps the player edited after an import; never records, rosters or deletions. */
  overwrite?: boolean;
}

/**
 * The reference data of Yaphalla (ranks, equipment, artifacts, phantimals, Arena maps, heroes and bosses with their pictures) and the
 * enemies of the wiki. What `npm run import:reference` and Admin > Sync both run. Downloaded code is parsed statically and never run.
 */
export async function syncReference(db: Database.Database, { yaphalla, wiki, overwrite = false }: ReferenceSyncOptions): Promise<SyncOutcome> {
  const lines: string[] = [];
  const warnings: string[] = [];

  const chunkUrls = new Set<string>();
  for (const page of PAGES) for (const url of discoverChunkUrls(await yaphalla.text(ORIGIN + page), ORIGIN)) chunkUrls.add(url);
  const sources: string[] = [];
  for (const url of chunkUrls) sources.push(await yaphalla.text(url));

  const data = extractReferenceData(sources);
  storeReferenceData(db, data);
  const maps = extractMaps(sources);
  const takenMaps = storeArenaMaps(db, maps, undefined, overwrite);
  seedStageMaps(db);
  lines.push(`Imported ${data.ranks.length} ranks, ${data.equipmentLevels.length} equipment levels, ${data.rankEquipmentCaps.length} caps, ${data.artifacts.length} artifacts; ${maps.length} Arena maps`);

  async function importCards(page: string, kind: 'heroes' | 'bosses', minimum: number) {
    const cards = parseCards(await yaphalla.text(ORIGIN + page));
    if (cards.length < minimum) throw new Error(`Only ${cards.length} ${kind} found on ${page}; expected at least ${minimum}`);
    const imagePathFor = (card: Card) => `images/${kind}/${card.name.replace(/[^\w .&'-]/g, '_')}.png`;
    for (const card of cards) await yaphalla.download(card.imageUrl ? encodeURI(card.imageUrl) : ORIGIN + encodeURI(card.imagePath), imagePathFor(card));
    return { cards, imagePathFor };
  }
  const heroes = await importCards('/heroes', 'heroes', MIN_HEROES);
  const bosses = await importCards('/bosses', 'bosses', MIN_BOSSES);
  const takenHeroes = storeHeroes(db, heroes.cards, heroes.imagePathFor, overwrite);
  const takenBosses = storeBosses(db, bosses.cards, bosses.imagePathFor, overwrite);
  lines.push(`Imported ${heroes.cards.length} heroes and ${bosses.cards.length} bosses`);
  lines.push(...takeOverLines([...takenMaps, ...takenHeroes, ...takenBosses]));

  // Enemies: the wiki's API (its article pages are blocked to plain fetches).
  const enemies = await fetchEnemies(wiki);
  const enemyImagePath = (enemy: Enemy) =>
    enemy.imageUrl ? `images/enemies/${enemy.name.replace(/[^\w .&'-]/g, '_')}${extname(new URL(enemy.imageUrl).pathname.split('/revision')[0]!) || '.png'}` : null;
  const downloaded = new Set<string>();
  let consecutiveFailures = 0;
  for (const enemy of enemies) {
    const path = enemyImagePath(enemy);
    if (!path || consecutiveFailures >= MAX_CONSECUTIVE_IMAGE_FAILURES) continue;
    try {
      await wiki.download(enemy.imageUrl!, path);
      downloaded.add(enemy.name);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures++;
      warnings.push(`Enemy image skipped: ${(error as Error).message}`);
    }
  }
  if (consecutiveFailures >= MAX_CONSECUTIVE_IMAGE_FAILURES) warnings.push('Stopped downloading enemy images after repeated failures; enemy data was still imported.');
  storeEnemies(db, enemies, (enemy) => (downloaded.has(enemy.name) ? enemyImagePath(enemy) : null));
  lines.push(`Imported ${enemies.length} enemies`);
  return { lines, warnings };
}
