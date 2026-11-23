import type Database from 'better-sqlite3';
import { phaseOf } from '../domain/stage-grid.js';
import type { StageKind } from '../domain/stage.js';
import { currentSeason } from './db-helpers.js';

/** The Season Phase (1 to 3) the current Season is at: Stages and the Titan Reaver form open on it (#284). */
export function currentSeasonPhase(db: Database.Database): number {
  return (db.prepare('SELECT phase FROM season WHERE is_current = 1').pluck().get() as number | undefined) ?? 1;
}

/**
 * The Season Phase a Season starts on when it gets its row (an import or a record may have named it before): the highest Phase of its
 * cleared stages, by the Phase Stages show them under (migration 35 does the same for existing rows), and of its Titan Reaver Battles.
 */
export function phaseFromRecords(db: Database.Database, season: number): number {
  const stages = db.prepare("SELECT kind, phase, number FROM stage s WHERE season = ? AND EXISTS (SELECT 1 FROM stage_attempt sa WHERE sa.stage_id = s.id)").all(season) as { kind: StageKind; phase: number; number: number }[];
  const battles = db.prepare('SELECT MAX(season_phase) FROM titan_reaver_battle WHERE season = ?').pluck().get(season) as number | null;
  return Math.max(1, battles ?? 1, ...stages.map(phaseOf));
}

/** Gives a Season its row if it has none, starting on the Phase its records show. */
export function ensureSeason(db: Database.Database, season: number, current = false): void {
  db.prepare('INSERT OR IGNORE INTO season (number, phase, is_current) VALUES (?, ?, ?)').run(season, phaseFromRecords(db, season), current ? 1 : 0);
}

/** The Titan Reaver setup belongs to the event of one Season Phase, so it is emptied whenever the Season or its Season Phase changes. */
export function emptyTitanReaverSetup(db: Database.Database): void {
  db.prepare('DELETE FROM titan_reaver_default').run();
}

/** Sets the Season Phase of the current Season, by hand or by a record. A change empties the Titan Reaver setup. Call inside a transaction. */
export function setSeasonPhase(db: Database.Database, phase: number): void {
  if (phase === currentSeasonPhase(db)) return;
  const season = currentSeason(db);
  ensureSeason(db, season, true);
  db.prepare('UPDATE season SET phase = ? WHERE number = ?').run(phase, season);
  emptyTitanReaverSetup(db);
}

/**
 * A record of `season` at `phase` was saved: the current Season's Season Phase moves up to it if it is higher, never down. A record of
 * another Season (an older Tournament's, a stage of an earlier Season) says nothing about where the current Season is. Call inside a transaction.
 */
export function raiseSeasonPhase(db: Database.Database, season: number, phase: number): void {
  if (season === currentSeason(db) && phase > currentSeasonPhase(db)) setSeasonPhase(db, phase);
}
