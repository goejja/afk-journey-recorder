import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { migration } from '../../src/db/migrations/030-clear-stage-hero-state.js';

describe('clearing the hero state of Stage records (migration 30)', () => {
  it('clears the rank and equipment of Stage attempts and of their assist hero, and leaves the other modes alone', () => {
    const db = openDb(':memory:');
    for (const name of ['A', 'B']) db.prepare('INSERT INTO hero (name) VALUES (?)').run(name);
    db.prepare("INSERT INTO rank (name, position) VALUES ('Mythic+', 0)").run();
    db.prepare('INSERT INTO equipment_level (level) VALUES (10)').run();
    const record = (mode: string) => {
      const attempt = Number(db.prepare('INSERT INTO attempt (mode, outcome) VALUES (?, ?)').run(mode, 'Win').lastInsertRowid);
      const formation = Number(
        db.prepare("INSERT INTO formation (attempt_id, assist_hero, assist_rank, assist_equipment_level) VALUES (?, 'B', 'Mythic+', 10)").run(attempt).lastInsertRowid,
      );
      db.prepare("INSERT INTO formation_hero (formation_id, tile, hero_name, part, rank, equipment_level) VALUES (?, 38, 'A', '', 'Mythic+', 10)").run(formation);
      return attempt;
    };
    const stage = record('Stage');
    const dreamHunt = record('Dream Hunt');

    migration(db);

    const state = (attempt: number) => ({
      hero: db.prepare('SELECT fh.rank, fh.equipment_level AS equipment FROM formation_hero fh JOIN formation f ON f.id = fh.formation_id WHERE f.attempt_id = ?').get(attempt),
      assist: db.prepare('SELECT assist_hero AS hero, assist_rank AS rank, assist_equipment_level AS equipment FROM formation WHERE attempt_id = ?').get(attempt),
    });
    expect(state(stage)).toEqual({ hero: { rank: null, equipment: null }, assist: { hero: 'B', rank: null, equipment: null } }); // the assist hero keeps its name
    expect(state(dreamHunt)).toEqual({ hero: { rank: 'Mythic+', equipment: 10 }, assist: { hero: 'B', rank: 'Mythic+', equipment: 10 } });
    db.close();
  });
});
