import type Database from 'better-sqlite3';
import type { Card } from './cards.js';
import { ensureStartingHeroes } from '../db/starting-heroes.js';
import { takeOverUnit, type TakenOver } from './take-over.js';
import { upsertImported } from './upsert.js';

/**
 * Upserts heroes; rows the player edited by hand (source = 'manual') are left alone, and so are the units a hero declares (a pair's parts,
 * a summon). A hero the player made by hand while the source lacked it is taken over when the source lists it (said in what it returns).
 */
export function storeHeroes(db: Database.Database, cards: Card[], imagePathFor: (card: Card) => string): TakenOver[] {
  const isUnit = db.prepare('SELECT 1 FROM hero_pair WHERE ? IN (part1, part2) UNION SELECT 1 FROM hero_summon WHERE part = ?');
  const upsert = upsertImported(db, 'hero', ['name', 'name'], [['tier', 'tier'], ['class', 'class'], ['faction', 'faction'], ['damage_type', 'damageType'], ['image_path', 'imagePath']]);
  const taken: TakenOver[] = [];
  db.transaction(() => {
    for (const card of cards) {
      if (isUnit.get(card.name, card.name)) continue;
      const imagePath = imagePathFor(card);
      // a hero the player made by hand while the source lacked it becomes the source's
      const over = takeOverUnit(db, 'hero', card.name, [
        { column: 'tier', label: 'tier', value: card.tier },
        { column: 'class', label: 'class', value: card.class },
        { column: 'faction', label: 'faction', value: card.faction },
        { column: 'damage_type', label: 'damage type', value: card.damageType },
        { column: 'image_path', label: 'picture', value: imagePath, report: false },
      ]);
      if (over) taken.push(over);
      upsert.run({ ...card, imagePath });
    }
    ensureStartingHeroes(db); // a starting hero seen for the first time goes on every roster
  })();
  return taken;
}

/** Upserts bosses; rows the player edited by hand are left alone, but one the player made by hand is taken over (said in what it returns). */
export function storeBosses(db: Database.Database, cards: Card[], imagePathFor: (card: Card) => string): TakenOver[] {
  const upsert = upsertImported(db, 'boss', ['name', 'name'], [['class', 'class'], ['damage_type', 'damageType'], ['image_path', 'imagePath']]);
  const taken: TakenOver[] = [];
  db.transaction(() => {
    for (const card of cards) {
      const imagePath = imagePathFor(card);
      const over = takeOverUnit(db, 'boss', card.name, [
        { column: 'class', label: 'class', value: card.class },
        { column: 'damage_type', label: 'damage type', value: card.damageType },
        { column: 'image_path', label: 'picture', value: imagePath, report: false },
      ]);
      if (over) taken.push(over);
      upsert.run({ ...card, imagePath });
    }
  })();
  return taken;
}
