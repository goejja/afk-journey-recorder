import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { extractMaps, seedStageMaps, storeArenaMaps } from '../../src/import/maps.js';

const rows = [2, 3, 2];
const layout = rows.map((length) => `{length:${length},offset:"",reverse:"",preview:""}`).join(',');

function chunk(maps: Record<string, string>, mapCount = 22): string {
  const entries = Object.entries(maps).map(([name, cells]) => `"${name}":[${cells}]`);
  for (let i = entries.length; i < mapCount; i++) entries.push(`"Filler ${i}":[0,0,0,0,0,0,1]`);
  return `(self.webpackChunk_N_E=[]).push([[1],{9:(e,t,r)=>{let l=[${layout}],n={Custom:Array(7).fill(0),${entries.join(',')}};}}]);`;
}

describe('extractMaps', () => {
  it('reads maps and row lengths, skipping the blank Custom map', () => {
    const maps = extractMaps([chunk({ 'Arena I': '-1,-1,0,-3,1,1,-2' })]);
    expect(maps).toHaveLength(22);
    expect(maps.find((b) => b.name === 'Arena I')).toEqual({
      name: 'Arena I',
      rowLengths: [2, 3, 2],
      cells: [-1, -1, 0, -3, 1, 1, -2],
    });
    expect(maps.some((b) => b.name === 'Custom')).toBe(false);
  });

  it('rejects a map with the wrong cell count', () => {
    expect(() => extractMaps([chunk({ 'Arena I': '0,0,0' })])).toThrow(/expected 7/);
  });

  it('rejects unknown cell values', () => {
    expect(() => extractMaps([chunk({ 'Arena I': '0,0,0,0,0,0,9' })])).toThrow(/unknown cell value 9/);
  });

  it('fails when too few maps are found', () => {
    expect(() => extractMaps([chunk({ 'Arena I': '0,0,0,0,0,0,1' }, 3)])).toThrow(/at least 20/);
  });
});

describe('storeArenaMaps', () => {
  const maps = () => extractMaps([chunk({ 'Arena I': '-1,-1,0,-3,1,1,-2' })]);

  it('stores maps tagged Arena with their original tiles, idempotently', () => {
    const db = openDb(':memory:');
    storeArenaMaps(db, maps());
    storeArenaMaps(db, maps());
    expect(db.prepare('SELECT count(*) FROM map').pluck().get()).toBe(22);
    expect(db.prepare("SELECT tags, cells = original_cells AS same, source FROM map WHERE name = 'Arena I'").get()).toEqual({
      tags: '["Arena"]',
      same: 1,
      source: 'import',
    });
  });

  it('keeps a manually edited map but refreshes its original', () => {
    const db = openDb(':memory:');
    storeArenaMaps(db, maps());
    db.prepare("UPDATE map SET cells = '[]', source = 'manual' WHERE name = 'Arena I'").run();
    storeArenaMaps(db, maps());
    const row = db.prepare("SELECT cells, original_cells FROM map WHERE name = 'Arena I'").get() as any;
    expect(row.cells).toBe('[]');
    expect(row.original_cells).toBe('[-1,-1,0,-3,1,1,-2]');
  });
});

describe('storeArenaMaps with a corrected map', () => {
  const maps = () => extractMaps([chunk({ 'Arena I': '-1,-1,0,-3,1,1,-2' })]);
  const corrections = { 'Arena I': [-1, -1, -2, -2, 1, 1, 0] };
  const row = (db: ReturnType<typeof openDb>) => db.prepare("SELECT cells, original_cells AS original, source FROM map WHERE name = 'Arena I'").get() as any;

  it('uses the corrected tiles instead of the imported ones, as the map and as what Restore returns', () => {
    const db = openDb(':memory:');
    storeArenaMaps(db, maps(), corrections);
    expect(row(db)).toEqual({ cells: '[-1,-1,-2,-2,1,1,0]', original: '[-1,-1,-2,-2,1,1,0]', source: 'import' });
  });

  it('puts the correction in place for a map still as first imported', () => {
    const db = openDb(':memory:');
    storeArenaMaps(db, maps());
    storeArenaMaps(db, maps(), corrections);
    expect(row(db)).toMatchObject({ cells: '[-1,-1,-2,-2,1,1,0]', original: '[-1,-1,-2,-2,1,1,0]' });
  });

  it('keeps a map the player edited, but makes the correction what Restore returns, also when the player already made the same edit', () => {
    const db = openDb(':memory:');
    storeArenaMaps(db, maps());
    db.prepare("UPDATE map SET cells = '[-1,-1,-2,-2,1,1,0]', source = 'manual' WHERE name = 'Arena I'").run();
    storeArenaMaps(db, maps(), corrections);
    storeArenaMaps(db, maps(), corrections); // and again on every later import
    expect(row(db)).toEqual({ cells: '[-1,-1,-2,-2,1,1,0]', original: '[-1,-1,-2,-2,1,1,0]', source: 'manual' });
  });

  it('refuses a correction with the wrong number of tiles, and ignores one for a map that is not imported', () => {
    expect(() => storeArenaMaps(openDb(':memory:'), maps(), { 'Arena I': [0, 0] })).toThrow(/Arena I.*expected 7/);
    const db = openDb(':memory:');
    storeArenaMaps(db, maps(), { 'No such map': [0, 0] });
    expect(db.prepare('SELECT count(*) FROM map').pluck().get()).toBe(22);
  });
});

describe('seedStageMaps', () => {
  it('creates one blank Stage map, Open, for the player to paint', () => {
    const db = openDb(':memory:');
    seedStageMaps(db);
    const names = db.prepare("SELECT name FROM map WHERE tags = '[\"Stage\"]' ORDER BY name").pluck().all();
    expect(names).toEqual(['Open']);
    const cells = JSON.parse(db.prepare("SELECT cells FROM map WHERE name = 'Open'").pluck().get() as string);
    expect(cells).toHaveLength(45);
    expect(cells.every((tile: number) => tile === 0)).toBe(true);
  });

  it('never overwrites an existing Stage map', () => {
    const db = openDb(':memory:');
    seedStageMaps(db);
    db.prepare("UPDATE map SET cells = '[9]' WHERE name = 'Open'").run();
    seedStageMaps(db);
    expect(db.prepare("SELECT cells FROM map WHERE name = 'Open'").pluck().get()).toBe('[9]');
  });
});
