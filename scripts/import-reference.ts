import { extractMaps, seedStageMaps, storeArenaMaps } from '../src/import/maps.js';
import { extname } from 'node:path';
import { openDb } from '../src/db/open.js';
import { parseCards, type Card } from '../src/import/cards.js';
import { discoverChunkUrls } from '../src/import/discover.js';
import { createCachedFetcher } from '../src/import/fetch.js';
import { storeBosses, storeHeroes } from '../src/import/store-cards.js';
import { takeOverLines } from '../src/import/take-over.js';
import { fetchEnemies, storeEnemies, type Enemy } from '../src/import/wiki.js';
import { storeReferenceData } from '../src/import/store-reference.js';
import { extractReferenceData } from '../src/import/yaphalla-data.js';

const ORIGIN = 'https://www.yaphalla.com';
const PAGES = ['/editor', '/editor/ascension'];

const refresh = process.argv.includes('--refresh');
const dbPath = process.argv.find((a) => a.endsWith('.db')) ?? 'data/afk.db';

const fetcher = createCachedFetcher('cache/yaphalla', refresh);
const chunkUrls = new Set<string>();
for (const page of PAGES) {
  for (const url of discoverChunkUrls(await fetcher.text(ORIGIN + page), ORIGIN)) chunkUrls.add(url);
}
const sources: string[] = [];
for (const url of chunkUrls) sources.push(await fetcher.text(url));

const data = extractReferenceData(sources);
const db = openDb(dbPath);
storeReferenceData(db, data);
const maps = extractMaps(sources);
const takenMaps = storeArenaMaps(db, maps);
seedStageMaps(db);
console.log(
  `Imported ${data.ranks.length} ranks, ${data.equipmentLevels.length} equipment levels, ` +
    `${data.rankEquipmentCaps.length} caps, ${data.artifacts.length} artifacts into ${dbPath}; ${maps.length} Arena maps`,
);

// Heroes and bosses: server-rendered list pages, plus portrait images.
const MIN_HEROES = 100;
const MIN_BOSSES = 20;

async function importCards(page: string, kind: 'heroes' | 'bosses', minimum: number) {
  const cards = parseCards(await fetcher.text(ORIGIN + page));
  if (cards.length < minimum) {
    throw new Error(`Only ${cards.length} ${kind} found on ${page}; expected at least ${minimum}`);
  }
  const imagePathFor = (card: Card) => `images/${kind}/${card.name.replace(/[^\w .&'-]/g, '_')}.png`;
  for (const card of cards) {
    await fetcher.download(ORIGIN + encodeURI(card.imagePath), imagePathFor(card));
  }
  return { cards, imagePathFor };
}

const heroes = await importCards('/heroes', 'heroes', MIN_HEROES);
const bosses = await importCards('/bosses', 'bosses', MIN_BOSSES);
const takenHeroes = storeHeroes(db, heroes.cards, heroes.imagePathFor);
const takenBosses = storeBosses(db, bosses.cards, bosses.imagePathFor);
console.log(`Imported ${heroes.cards.length} heroes and ${bosses.cards.length} bosses`);
for (const line of takeOverLines([...takenMaps, ...takenHeroes, ...takenBosses])) console.log(line);

// Enemies: the fandom wiki's API (the article pages themselves are blocked to plain fetches).
const wikiFetcher = createCachedFetcher('cache/wiki', refresh);
const enemies = await fetchEnemies(wikiFetcher);
const enemyImagePath = (enemy: Enemy) =>
  enemy.imageUrl ? `images/enemies/${enemy.name.replace(/[^\w .&'-]/g, '_')}${extname(new URL(enemy.imageUrl).pathname.split('/revision')[0]!) || '.png'}` : null;
// The wiki's image server may refuse downloads (HTTP 403). Images are optional, so give up
// after a few failures in a row instead of retrying, and leave those image paths empty.
const MAX_CONSECUTIVE_IMAGE_FAILURES = 3;
const downloaded = new Set<string>();
let consecutiveFailures = 0;
for (const enemy of enemies) {
  const path = enemyImagePath(enemy);
  if (!path || consecutiveFailures >= MAX_CONSECUTIVE_IMAGE_FAILURES) continue;
  try {
    await wikiFetcher.download(enemy.imageUrl!, path);
    downloaded.add(enemy.name);
    consecutiveFailures = 0;
  } catch (error) {
    consecutiveFailures++;
    console.warn(`Enemy image skipped: ${(error as Error).message}`);
  }
}
if (consecutiveFailures >= MAX_CONSECUTIVE_IMAGE_FAILURES) {
  console.warn('Stopped downloading enemy images after repeated failures; enemy data was still imported.');
}
storeEnemies(db, enemies, (enemy) => (downloaded.has(enemy.name) ? enemyImagePath(enemy) : null));
console.log(`Imported ${enemies.length} enemies`);
