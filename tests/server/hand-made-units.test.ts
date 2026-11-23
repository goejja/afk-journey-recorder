import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';

describe('migration 36: the heroes and bosses made by hand', () => {
  it('marks a manual row with no picture path, and not an imported row, an edited import or a row with a picture', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'afk-hand-made-')), 'afk.db');
    const old = openDb(path);
    old.exec(`
      INSERT INTO hero (name, image_path, source) VALUES ('Thane', NULL, 'manual'), ('Edited', 'images/heroes/Edited.png', 'manual'), ('Baden', NULL, 'import'), ('Evie', 'images/heroes/Evie.png', 'import');
      INSERT INTO boss (name, image_path, source) VALUES ('Gloomwing', NULL, 'manual'), ('Croaker', 'images/bosses/Croaker.png', 'manual'), ('Novik', 'images/bosses/Novik.png', 'import');
      ALTER TABLE hero DROP COLUMN hand_made;
      ALTER TABLE boss DROP COLUMN hand_made;
    `);
    old.pragma('user_version = 35');
    old.close();
    const reopened = openDb(path);
    expect(reopened.prepare('SELECT name, hand_made FROM hero ORDER BY name').all()).toEqual([
      { name: 'Baden', hand_made: 0 },
      { name: 'Edited', hand_made: 0 },
      { name: 'Evie', hand_made: 0 },
      { name: 'Thane', hand_made: 1 },
    ]);
    expect(reopened.prepare('SELECT name, hand_made FROM boss ORDER BY name').all()).toEqual([
      { name: 'Croaker', hand_made: 0 },
      { name: 'Gloomwing', hand_made: 1 },
      { name: 'Novik', hand_made: 0 },
    ]);
  });
});
