import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import type { Card } from '../../src/import/cards.js';
import { storeBosses, storeHeroes } from '../../src/import/store-cards.js';

const evie: Card = {
  name: 'Evie',
  imagePath: '/x/Evie.png',
  tier: 'A',
  class: 'Support',
  faction: 'Lightbearer',
  damageType: 'Magic',
};
const croaker: Card = { ...evie, name: 'King Croaker', tier: null, faction: null, class: 'Mage' };
const path = (card: Card) => `images/${card.name}.png`;

describe('store cards', () => {
  it('stores heroes and bosses idempotently', () => {
    const db = openDb(':memory:');
    storeHeroes(db, [evie], path);
    storeHeroes(db, [evie], path);
    storeBosses(db, [croaker], path);
    expect(db.prepare('SELECT count(*) FROM hero').pluck().get()).toBe(1);
    expect(db.prepare('SELECT * FROM hero').get()).toMatchObject({ name: 'Evie', tier: 'A', image_path: 'images/Evie.png' });
    expect(db.prepare('SELECT class FROM boss').pluck().get()).toBe('Mage');
  });

  it('keeps manual edits', () => {
    const db = openDb(':memory:');
    storeHeroes(db, [evie], path);
    db.prepare("UPDATE hero SET tier = 'S', source = 'manual' WHERE name = 'Evie'").run();
    storeHeroes(db, [evie], path);
    expect(db.prepare('SELECT tier FROM hero').pluck().get()).toBe('S');
  });

  it('does not store a card named like a declared unit (a part of a pair, a summon)', () => {
    const db = openDb(':memory:');
    storeHeroes(db, [evie, { ...evie, name: 'Elijah' }, { ...evie, name: 'Laser Turret' }], path);
    expect(db.prepare('SELECT name FROM hero').pluck().all()).toEqual(['Evie']);
  });
});
