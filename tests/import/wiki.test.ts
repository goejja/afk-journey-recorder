import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import type { Fetcher } from '../../src/import/fetch.js';
import { categoryMembers, fetchEnemies, storeEnemies } from '../../src/import/wiki.js';

/** Answers wiki API calls from a table keyed by the `cmtitle` / `titles` parameter. */
function fakeWiki(categories: Record<string, string[]>, images: Record<string, string> = {}, pageSize = 500): Fetcher {
  return {
    async download() {},
    async text(url) {
      const q = new URL(url).searchParams;
      if (q.get('list') === 'categorymembers') {
        const all = categories[q.get('cmtitle')!.replace('Category:', '')] ?? [];
        const start = Number(q.get('cmcontinue') ?? 0);
        const page = all.slice(start, start + pageSize);
        const next = start + pageSize < all.length ? { continue: { cmcontinue: String(start + pageSize) } } : {};
        return JSON.stringify({ query: { categorymembers: page.map((title) => ({ title })) }, ...next });
      }
      const pages: Record<string, unknown> = {};
      for (const title of q.get('titles')!.split('|')) {
        pages[title] = { title, ...(images[title] ? { original: { source: images[title] } } : {}) };
      }
      return JSON.stringify({ query: { pages } });
    },
  };
}

const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} ${i}`);

describe('categoryMembers', () => {
  it('follows paging', async () => {
    const fetcher = fakeWiki({ X: many('E', 5) }, {}, 2);
    expect(await categoryMembers(fetcher, 'X')).toEqual(many('E', 5));
  });
});

describe('fetchEnemies', () => {
  const common = many('Grunt', 300);
  const wiki = fakeWiki(
    {
      'Common Enemies': common,
      'Elite Enemies': ['Captain'],
      'Boss Enemies': ['Alpha Bear', 'Grunt 0'],
      'Warrior Class Enemies': ['Alpha Bear'],
      'Physical Damage Dealing Enemies': ['Alpha Bear'],
    },
    { 'Alpha Bear': 'https://img.test/bear.png' },
  );

  it('merges categories, class, damage type and image, with Boss winning over Common', async () => {
    const enemies = await fetchEnemies(wiki);
    const byName = Object.fromEntries(enemies.map((e) => [e.name, e]));
    expect(byName['Alpha Bear']).toEqual({
      name: 'Alpha Bear',
      category: 'Boss',
      class: 'Warrior',
      damageType: 'Physical',
      imageUrl: 'https://img.test/bear.png',
    });
    expect(byName['Grunt 0']?.category).toBe('Boss');
    expect(byName['Captain']).toMatchObject({ category: 'Elite', class: null, imageUrl: null });
  });

  it('fails when far fewer enemies than expected come back', async () => {
    await expect(fetchEnemies(fakeWiki({ 'Common Enemies': ['Only one'] }))).rejects.toThrow(/at least 300/);
  });
});

describe('storeEnemies', () => {
  it('stores idempotently and keeps manual edits', () => {
    const db = openDb(':memory:');
    const enemy = { name: 'Alpha Bear', category: 'Boss' as const, class: 'Warrior', damageType: 'Physical' as const, imageUrl: null };
    storeEnemies(db, [enemy], () => null);
    storeEnemies(db, [enemy], () => null);
    expect(db.prepare('SELECT count(*) FROM enemy').pluck().get()).toBe(1);
    db.prepare("UPDATE enemy SET faction = 'Wilder', class = 'Tank', source = 'manual'").run();
    storeEnemies(db, [enemy], () => null);
    expect(db.prepare('SELECT class, faction FROM enemy').get()).toEqual({ class: 'Tank', faction: 'Wilder' });
  });
});
