import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { extractMaps, storeArenaMaps } from '../../src/import/maps.js';
import type { Card } from '../../src/import/cards.js';
import { storeBosses, storeHeroes } from '../../src/import/store-cards.js';
import { takeOverLines } from '../../src/import/take-over.js';

const thane: Card = { name: 'Thane', imagePath: '/x/Thane.png', imageUrl: null, tier: 'A', class: 'Warrior', faction: 'Graveborn', damageType: 'Physical' };
const gloom: Card = { name: 'Gloomwing', imagePath: '/x/Gloomwing.png', imageUrl: null, tier: null, faction: null, class: 'Rogue', damageType: 'Physical' };
const path = (card: Card) => `images/${card.name}.png`;

describe('taking over a hero the player made by hand', () => {
  const handMade = () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type, image_path, source, hand_made) VALUES ('Thane', 'S', 'Warrior', 'Lightbearer', 'Physical', NULL, 'manual', 1)").run();
    return db;
  };

  it('replaces its fields with the source’s, makes it the importer’s, and says what differed', () => {
    const db = handMade();
    const taken = storeHeroes(db, [thane], path);
    expect(db.prepare("SELECT tier, class, faction, damage_type, image_path, source, hand_made FROM hero WHERE name = 'Thane'").get()).toEqual({ tier: 'A', class: 'Warrior', faction: 'Graveborn', damage_type: 'Physical', image_path: 'images/Thane.png', source: 'import', hand_made: 0 });
    expect(takeOverLines(taken)).toEqual(['Took over Thane from Yaphalla (tier S→A, faction Lightbearer→Graveborn)']);
  });

  it('says nothing differed when the source agrees with the row', () => {
    const db = handMade();
    expect(takeOverLines(storeHeroes(db, [{ ...thane, tier: 'S', faction: 'Lightbearer' }], path))).toEqual(['Took over Thane from Yaphalla (nothing differed)']);
  });

  it('leaves the units it brings, its hint and its roster entry alone', () => {
    const db = handMade();
    db.prepare("INSERT INTO hero_summon (hero, part, count) VALUES ('Thane', 'Turret', 2)").run();
    storeHeroes(db, [thane], path);
    expect(db.prepare("SELECT part, count FROM hero_summon WHERE hero = 'Thane'").get()).toEqual({ part: 'Turret', count: 2 });
  });

  it('is not repeated once the hero is the importer’s', () => {
    const db = handMade();
    storeHeroes(db, [thane], path);
    expect(storeHeroes(db, [thane], path)).toEqual([]);
  });

  it('leaves a hero the player edited after an import alone, also one the source gave no picture', () => {
    const db = openDb(':memory:');
    storeHeroes(db, [thane], path);
    db.prepare("UPDATE hero SET tier = 'S', source = 'manual' WHERE name = 'Thane'").run();
    expect(storeHeroes(db, [thane], path)).toEqual([]);
    expect(db.prepare("SELECT tier, source FROM hero WHERE name = 'Thane'").get()).toEqual({ tier: 'S', source: 'manual' });
    // an imported row without a picture path, edited: not a stand-in
    db.prepare("INSERT INTO hero (name, tier, image_path, source) VALUES ('Baden', 'S', NULL, 'import')").run();
    db.prepare("UPDATE hero SET tier = 'A', source = 'manual' WHERE name = 'Baden'").run();
    expect(storeHeroes(db, [{ ...thane, name: 'Baden' }], path)).toEqual([]);
    expect(db.prepare("SELECT tier FROM hero WHERE name = 'Baden'").pluck().get()).toBe('A');
  });
});

describe('taking over a boss the player made by hand', () => {
  it('replaces its class and damage type and makes it the importer’s', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO boss (name, class, damage_type, image_path, source, hand_made) VALUES ('Gloomwing', 'Mage', 'Magic', NULL, 'manual', 1)").run();
    const taken = storeBosses(db, [gloom], path);
    expect(db.prepare("SELECT class, damage_type, image_path, source, hand_made FROM boss WHERE name = 'Gloomwing'").get()).toEqual({ class: 'Rogue', damage_type: 'Physical', image_path: 'images/Gloomwing.png', source: 'import', hand_made: 0 });
    expect(takeOverLines(taken)).toEqual(['Took over Gloomwing from Yaphalla (class Mage→Rogue, damage type Magic→Physical)']);
  });

  it('leaves a boss the player edited after an import alone', () => {
    const db = openDb(':memory:');
    storeBosses(db, [gloom], path);
    db.prepare("UPDATE boss SET class = 'Tank', source = 'manual' WHERE name = 'Gloomwing'").run();
    expect(storeBosses(db, [gloom], path)).toEqual([]);
    expect(db.prepare("SELECT class FROM boss WHERE name = 'Gloomwing'").pluck().get()).toBe('Tank');
  });
});

describe('taking over a map the player drew by hand', () => {
  const rows = [2, 3, 2];
  const layout = rows.map((length) => `{length:${length},offset:"",reverse:"",preview:""}`).join(',');
  const mapRows = (cells: string) => {
    const entries = [`"Arena I":[${cells}]`];
    for (let i = 1; i < 22; i++) entries.push(`"Filler ${i}":[0,0,0,0,0,0,1]`);
    return extractMaps([`(self.webpackChunk_N_E=[]).push([[1],{9:(e,t,r)=>{let l=[${layout}],n={Custom:Array(7).fill(0),${entries.join(',')}};}}]);`]);
  };
  const drawn = (db: ReturnType<typeof openDb>) =>
    db.prepare("INSERT INTO map (name, tags, row_lengths, cells, boost_tiles, original_cells, source) VALUES ('Arena I', '[\"Arena\"]', '[2,3,2]', '[-1,-1,0,0,1,1,1]', '[4,6]', NULL, 'manual')").run();

  it('replaces its tiles and layout, sets its original, keeps its Boost tiles on deployment tiles, and says how many tiles differed', () => {
    const db = openDb(':memory:');
    drawn(db);
    const taken = storeArenaMaps(db, mapRows('-1,-1,0,-3,1,1,-2'));
    expect(db.prepare("SELECT cells, original_cells, boost_tiles, source, tags FROM map WHERE name = 'Arena I'").get()).toEqual({
      cells: '[-1,-1,0,-3,1,1,-2]',
      original_cells: '[-1,-1,0,-3,1,1,-2]',
      boost_tiles: '[4]', // tile 6 is no longer a deployment tile
      source: 'import',
      tags: '["Arena"]',
    });
    expect(takeOverLines(taken)).toEqual(['Took over Arena I from Yaphalla (2 of 7 tiles differed)']);
  });

  it('says how many records use it', () => {
    const db = openDb(':memory:');
    drawn(db);
    const attempt = db.prepare("INSERT INTO attempt (mode, outcome) VALUES ('Arena', 'Win')").run().lastInsertRowid;
    db.prepare("INSERT INTO arena_attempt (attempt_id, mode, map_name) VALUES (?, 'Arena', 'Arena I')").run(attempt);
    expect(takeOverLines(storeArenaMaps(db, mapRows('-1,-1,0,0,1,1,1')))).toEqual(['Took over Arena I from Yaphalla (no tile differed; 1 record uses it, check their placements)']);
  });

  it('leaves a map the player edited after an import, and a Stage map, alone', () => {
    const db = openDb(':memory:');
    storeArenaMaps(db, mapRows('-1,-1,0,-3,1,1,-2'));
    db.prepare("UPDATE map SET cells = '[]', source = 'manual' WHERE name = 'Arena I'").run();
    expect(storeArenaMaps(db, mapRows('-1,-1,0,-3,1,1,-2'))).toEqual([]);
    expect(db.prepare("SELECT cells FROM map WHERE name = 'Arena I'").pluck().get()).toBe('[]');
  });
});

describe('the overwrite option', () => {
  it('replaces a hero the player edited after an import, and says it overwrote it', () => {
    const db = openDb(':memory:');
    storeHeroes(db, [thane], path);
    db.prepare("UPDATE hero SET tier = 'S', source = 'manual' WHERE name = 'Thane'").run();
    db.prepare("INSERT INTO hero_summon (hero, part, count) VALUES ('Thane', 'Turret', 2)").run();
    const taken = storeHeroes(db, [thane], path, true);
    expect(db.prepare("SELECT tier, source, hand_made FROM hero WHERE name = 'Thane'").get()).toEqual({ tier: 'A', source: 'import', hand_made: 0 });
    expect(takeOverLines(taken)).toEqual(['Overwrote Thane from Yaphalla (tier S→A)']);
    expect(db.prepare("SELECT part FROM hero_summon WHERE hero = 'Thane'").pluck().get()).toBe('Turret');
  });

  it('keeps the roster entry and the records of an overwritten hero', () => {
    const db = openDb(':memory:');
    storeHeroes(db, [thane], path);
    const profile = db.prepare('SELECT id FROM profile WHERE is_default = 1').pluck().get() as number;
    db.prepare("INSERT INTO rank (name, position, source) VALUES ('Elite', 1, 'import')").run();
    db.prepare("INSERT INTO equipment_level (level, source) VALUES (0, 'import')").run();
    db.prepare("INSERT INTO roster (profile_id, hero_name, rank, equipment_level) VALUES (?, 'Thane', 'Elite', 0)").run(profile);
    db.prepare("UPDATE hero SET tier = 'S', source = 'manual' WHERE name = 'Thane'").run();
    storeHeroes(db, [thane], path, true);
    expect(db.prepare("SELECT count(*) FROM roster WHERE hero_name = 'Thane'").pluck().get()).toBe(1);
  });

  it('does nothing to an edited hero without the option, and reports a hand-made one as taken over, not overwritten', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type, image_path, source, hand_made) VALUES ('Thane', 'S', 'Warrior', 'Lightbearer', 'Physical', NULL, 'manual', 1)").run();
    expect(takeOverLines(storeHeroes(db, [thane], path, true))).toEqual(['Took over Thane from Yaphalla (tier S→A, faction Lightbearer→Graveborn)']);
  });

  it('replaces a boss the player edited after an import', () => {
    const db = openDb(':memory:');
    storeBosses(db, [gloom], path);
    db.prepare("UPDATE boss SET class = 'Tank', source = 'manual' WHERE name = 'Gloomwing'").run();
    expect(takeOverLines(storeBosses(db, [gloom], path, true))).toEqual(['Overwrote Gloomwing from Yaphalla (class Tank→Rogue)']);
    expect(db.prepare("SELECT class, source FROM boss WHERE name = 'Gloomwing'").get()).toEqual({ class: 'Rogue', source: 'import' });
  });

  it('replaces the tiles of an Arena map the player edited, keeping its Boost tiles on deployment tiles', () => {
    const db = openDb(':memory:');
    const layout = [2, 3, 2].map((length) => `{length:${length},offset:"",reverse:"",preview:""}`).join(',');
    const entries = ['"Arena I":[-1,-1,0,-3,1,1,-2]', ...Array.from({ length: 21 }, (_, i) => `"Filler ${i + 1}":[0,0,0,0,0,0,1]`)];
    const maps = extractMaps([`(self.webpackChunk_N_E=[]).push([[1],{9:(e,t,r)=>{let l=[${layout}],n={Custom:Array(7).fill(0),${entries.join(',')}};}}]);`]);
    storeArenaMaps(db, maps);
    db.prepare("UPDATE map SET cells = '[0,0,0,0,1,1,1]', boost_tiles = '[4,6]', source = 'manual' WHERE name = 'Arena I'").run();
    expect(storeArenaMaps(db, maps, undefined, false)).toEqual([]);
    const taken = storeArenaMaps(db, maps, undefined, true);
    expect(db.prepare("SELECT cells, boost_tiles, source FROM map WHERE name = 'Arena I'").get()).toEqual({ cells: '[-1,-1,0,-3,1,1,-2]', boost_tiles: '[4]', source: 'import' });
    expect(takeOverLines(taken)).toEqual(['Overwrote Arena I from Yaphalla (4 of 7 tiles differed)']);
  });
});
