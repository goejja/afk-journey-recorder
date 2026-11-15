import type Database from 'better-sqlite3';
import { modeAllowsPhantimal } from '../domain/arena.js';
import { allowsPhantimal, type StageKind } from '../domain/stage.js';
import { checkFactionRequirement } from '../domain/units.js';

/** A stored record whose Phantimal the game could not have put on the field: a mode that never has one, or a Faction Requirement its
 * heroes do not meet. Usually a misread in a Battle import (ADR 0029). */
export interface FactionMismatch {
  attemptId: number;
  /** Which side of the record it is. */
  side: 'A' | 'B';
  mode: string;
  mapName: string | null;
  /** The Phantimal the record names. */
  phantimal: string;
  /** Why it could not have stood there, in one line. */
  problem: string;
}

/** The modes that never hold a Phantimal: everything the Arena list leaves out, and Dream Hunt (ADR 0029). */
const modeTakesOne = (mode: string, kind: StageKind | null): boolean =>
  mode === 'Stage' ? kind !== null && allowsPhantimal(kind) : mode !== 'Dream Hunt' && modeAllowsPhantimal(mode);

/**
 * The records that name a Phantimal the game could not have put on the field. Read only: a stored record is history and is never
 * rewritten, but a mismatch usually means the reader misread the Phantimal or a hero, and is worth a look (ADR 0029).
 */
export function factionMismatches(db: Database.Database): FactionMismatch[] {
  const heroFactions = new Map((db.prepare('SELECT name, faction FROM hero').all() as { name: string; faction: string | null }[]).map((r) => [r.name, r.faction]));
  const phantimalFactions = new Map((db.prepare('SELECT name, faction FROM phantimal').all() as { name: string; faction: string | null }[]).map((r) => [r.name, r.faction]));
  const sides = db
    .prepare(
      `SELECT s.attempt_id AS attemptId, 'A' AS side, s.mode, s.map_name AS mapName, f.phantimal_name AS phantimal, st.kind AS kind
       FROM v_side s JOIN formation f ON f.attempt_id = s.attempt_id
       LEFT JOIN stage_attempt sa ON sa.attempt_id = s.attempt_id
       LEFT JOIN stage st ON st.id = sa.stage_id
       WHERE s.side = 'A' AND f.phantimal_name IS NOT NULL
       UNION ALL
       SELECT a.id, 'B', r.mode, r.map_name, r.opp_phantimal, NULL
       FROM arena_attempt r JOIN attempt a ON a.id = r.attempt_id
       WHERE r.opp_phantimal IS NOT NULL`,
    )
    .all() as { attemptId: number; side: 'A' | 'B'; mode: string; mapName: string | null; phantimal: string; kind: StageKind | null }[];
  // The heroes of each side, one row per hero: a Pair counts once and a Summon never (v_side_hero).
  const heroesOf = db.prepare('SELECT hero FROM v_side_hero WHERE attempt_id = ? AND side = ?');
  const found: FactionMismatch[] = [];
  for (const side of sides) {
    const place = { attemptId: side.attemptId, side: side.side, mode: side.mode, mapName: side.mapName, phantimal: side.phantimal };
    if (!modeTakesOne(side.mode, side.kind)) {
      found.push({ ...place, problem: `${side.mode === 'Stage' ? `${side.kind} stage` : side.mode} never holds a Phantimal` });
      continue;
    }
    const heroes = (heroesOf.all(side.attemptId, side.side) as { hero: string }[]).map((h) => ({ hero: h.hero }));
    const problem = checkFactionRequirement(heroes, side.phantimal, phantimalFactions.get(side.phantimal), heroFactions);
    if (problem) found.push({ ...place, problem });
  }
  return found.sort((a, b) => b.attemptId - a.attemptId || a.side.localeCompare(b.side));
}