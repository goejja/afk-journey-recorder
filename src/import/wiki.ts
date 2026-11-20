import type Database from 'better-sqlite3';
import type { Fetcher } from './fetch.js';
import { upsertImported } from './upsert.js';

const API = 'https://afk-journey.fandom.com/api.php';
const IMAGE_BATCH = 50;
const MIN_ENEMIES = 300;

type EnemyCategory = 'Common' | 'Elite' | 'Boss';

export interface Enemy {
  name: string;
  category: EnemyCategory;
  class: string | null;
  damageType: 'Physical' | 'Magic' | null;
  imageUrl: string | null;
}

// Listed from lowest to highest priority: an enemy listed under several wins its highest category.
const CATEGORY_PAGES: [EnemyCategory, string][] = [
  ['Common', 'Common Enemies'],
  ['Elite', 'Elite Enemies'],
  ['Boss', 'Boss Enemies'],
];
const CLASSES = ['Tank', 'Support', 'Marksman', 'Mage', 'Rogue', 'Warrior'];

async function getJson(fetcher: Fetcher, params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  return JSON.parse(await fetcher.text(url));
}

/** Article titles in a wiki category, following the API's paging. */
export async function categoryMembers(fetcher: Fetcher, category: string): Promise<string[]> {
  const titles: string[] = [];
  let cont: string | undefined;
  do {
    const data = await getJson(fetcher, {
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmnamespace: '0',
      cmlimit: '500',
      ...(cont ? { cmcontinue: cont } : {}),
    });
    for (const member of data.query?.categorymembers ?? []) titles.push(member.title);
    cont = data.continue?.cmcontinue;
  } while (cont);
  return titles;
}

async function pageImages(fetcher: Fetcher, titles: string[]): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  for (let i = 0; i < titles.length; i += IMAGE_BATCH) {
    const data = await getJson(fetcher, {
      action: 'query',
      prop: 'pageimages',
      piprop: 'original',
      pilimit: String(IMAGE_BATCH),
      titles: titles.slice(i, i + IMAGE_BATCH).join('|'),
    });
    for (const page of Object.values<any>(data.query?.pages ?? {})) {
      if (page.original?.source) images.set(page.title, page.original.source);
    }
  }
  return images;
}

export async function fetchEnemies(fetcher: Fetcher): Promise<Enemy[]> {
  const categoryOf = new Map<string, EnemyCategory>();
  for (const [category, page] of CATEGORY_PAGES) {
    for (const title of await categoryMembers(fetcher, page)) categoryOf.set(title, category);
  }
  const classOf = new Map<string, string>();
  for (const cls of CLASSES) {
    for (const title of await categoryMembers(fetcher, `${cls} Class Enemies`)) classOf.set(title, cls);
  }
  const damageOf = new Map<string, 'Physical' | 'Magic'>();
  for (const kind of ['Physical', 'Magic'] as const) {
    for (const title of await categoryMembers(fetcher, `${kind} Damage Dealing Enemies`)) damageOf.set(title, kind);
  }
  const names = [...categoryOf.keys()];
  if (names.length < MIN_ENEMIES) {
    throw new Error(`Only ${names.length} enemies found on the wiki; expected at least ${MIN_ENEMIES}`);
  }
  const images = await pageImages(fetcher, names);
  return names.map((name) => ({
    name,
    category: categoryOf.get(name)!,
    class: classOf.get(name) ?? null,
    damageType: damageOf.get(name) ?? null,
    imageUrl: images.get(name) ?? null,
  }));
}

/** Upserts enemies; enemies the player edited by hand (source = 'manual') are left alone. */
export function storeEnemies(db: Database.Database, enemies: Enemy[], imagePathFor: (enemy: Enemy) => string | null): void {
  const upsert = upsertImported(db, 'enemy', ['name', 'name'], [['category', 'category'], ['class', 'class'], ['damage_type', 'damageType'], ['image_path', 'imagePath']]);
  db.transaction(() => {
    for (const enemy of enemies) {
      upsert.run({
        name: enemy.name,
        category: enemy.category,
        class: enemy.class,
        damageType: enemy.damageType,
        imagePath: imagePathFor(enemy),
      });
    }
  })();
}
