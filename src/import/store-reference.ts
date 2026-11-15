import type Database from 'better-sqlite3';
import { upsertImported } from './upsert.js';
import type { YaphallaReferenceData } from './yaphalla-data.js';

/**
 * Upserts imported reference data. Rows the player added or edited by hand
 * (source = 'manual') are never overwritten.
 */
export function storeReferenceData(db: Database.Database, data: YaphallaReferenceData): void {
  const upsertRank = upsertImported(db, 'rank', ['name', 'name'], [['position', 'position']]);
  const upsertEquipment = db.prepare(
    `INSERT INTO equipment_level (level, source) VALUES (?, 'import') ON CONFLICT (level) DO NOTHING`,
  );
  const upsertCap = upsertImported(db, 'rank_equipment_cap', ['rank', 'rank'], [['min_level', 'minLevel'], ['max_level', 'maxLevel']]);
  const upsertArtifact = upsertImported(db, 'artifact', ['name', 'name'], [['grp', 'group']]);

  const upsertPhantimal = upsertImported(db, 'phantimal', ['name', 'name'], [['faction', 'faction'], ['class', 'class']]);
  const isImported = db.prepare("SELECT 1 FROM phantimal WHERE name = ? AND source = 'import'");
  const isPart = db.prepare('SELECT 1 FROM phantimal_part WHERE part = ?');
  const tagSeason = db.prepare('INSERT OR IGNORE INTO phantimal_season (phantimal_name, season) VALUES (?, ?)');

  db.transaction(() => {
    // Positions are unique; clear import-owned ones first so a reordered list cannot collide.
    db.prepare("UPDATE rank SET position = -1 - position WHERE source = 'import'").run();
    for (const rank of data.ranks) upsertRank.run(rank);
    for (const level of data.equipmentLevels) upsertEquipment.run(level);
    for (const cap of data.rankEquipmentCaps) upsertCap.run(cap);
    for (const artifact of data.artifacts) upsertArtifact.run(artifact);
    for (const phantimal of data.phantimals) {
      if (isPart.get(phantimal.name)) continue; // the second part of a phantimal is not a phantimal
      upsertPhantimal.run(phantimal);
      // Season tags of phantimals the player took over by hand are theirs to manage.
      if (isImported.get(phantimal.name)) for (const season of phantimal.seasons) tagSeason.run(phantimal.name, season);
    }
  })();
}
