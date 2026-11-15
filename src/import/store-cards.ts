import type Database from 'better-sqlite3';
import type { Card } from './cards.js';
import { upsertImported } from './upsert.js';

/** Upserts heroes; rows the player edited by hand (source = 'manual') are left alone, and so are the units a hero declares (a pair's parts, a summon). */
export function storeHeroes(db: Database.Database, cards: Card[], imagePathFor: (card: Card) => string): void {
  const isUnit = db.prepare('SELECT 1 FROM hero_pair WHERE ? IN (part1, part2) UNION SELECT 1 FROM hero_summon WHERE part = ?');
  const upsert = upsertImported(db, 'hero', ['name', 'name'], [['tier', 'tier'], ['class', 'class'], ['faction', 'faction'], ['damage_type', 'damageType'], ['image_path', 'imagePath']]);
  db.transaction(() => {
    for (const card of cards) if (!isUnit.get(card.name, card.name)) upsert.run({ ...card, imagePath: imagePathFor(card) });
  })();
}

export function storeBosses(db: Database.Database, cards: Card[], imagePathFor: (card: Card) => string): void {
  const upsert = upsertImported(db, 'boss', ['name', 'name'], [['class', 'class'], ['damage_type', 'damageType'], ['image_path', 'imagePath']]);
  db.transaction(() => {
    for (const card of cards) upsert.run({ ...card, imagePath: imagePathFor(card) });
  })();
}
