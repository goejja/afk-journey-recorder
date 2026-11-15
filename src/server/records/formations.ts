import type { FormationJson } from '../../shared/api.js';
import { defaultProfileId } from '../../db/profiles.js';
import type Database from 'better-sqlite3';
import type { FormationContext } from '../../domain/formation.js';
import { validateHeroState, type HeroStateRules } from '../../domain/hero-state.js';
import { isSummon, partOf } from '../../domain/units.js';
import { declareNamedFormationId, formationIdProblem } from '../../db/formation-ids.js';

export interface RosterEntry {
  hero_name: string;
  rank: string | null;
  equipment_level: number | null;
}

/**
 * A hero's rank and equipment are normally copied from the roster. When a payload carries them
 * (editing a saved record keeps what was stored), they are used as given.
 */
export interface FormationPayload {
  heroes: { tile: number; hero: string; part?: string | null; rank?: string | null; equipmentLevel?: number | null }[];
  phantimal?: { tile: number; name: string; partnerTile?: number | null } | null;
  assistHero?: string | null;
  assistRank?: string | null;
  assistEquipmentLevel?: number | null;
  artifact?: string | null;
  /** The Formation ID the player gave this formation, as typed; the library keeps its Deployment and the map. */
  formationId?: string | null;
}

/**
 * Why the Formation ID a fight names cannot be used, or null. A fight in a battle names none (the battle does, ADR 0007),
 * so what the payload carries is ignored then.
 */
export const fightFormationIdProblem = (db: Database.Database, formation: FormationPayload, inBattle: boolean): string | null =>
  inBattle ? null : formationIdProblem(db, { code: formation.formationId, teams: [formation] });

/** The heroes of a profile (the default one unless told otherwise), with their rank and equipment. */
export function loadRoster(db: Database.Database, profileId: number = defaultProfileId(db)): Map<string, RosterEntry> {
  const rows = db.prepare('SELECT hero_name, rank, equipment_level FROM roster WHERE profile_id = ?').all(profileId) as RosterEntry[];
  return new Map(rows.map((r) => [r.hero_name, r]));
}

/** Everything validateFormation needs to know about the player's data. */
export function formationContext(
  db: Database.Database,
  roster: Map<string, RosterEntry>,
  options: { cells: number[]; phantimalAllowed: boolean; season?: number; allPhantimals?: boolean; extraHeroes?: Iterable<string> },
): FormationContext {
  const artifacts = new Set(db.prepare('SELECT name FROM artifact').pluck().all() as string[]);
  const seasonPhantimals = new Set(
    options.allPhantimals
      ? (db.prepare('SELECT name FROM phantimal').pluck().all() as string[])
      : options.season === undefined
      ? []
      : (db.prepare('SELECT phantimal_name FROM phantimal_season WHERE season = ?').pluck().all(options.season) as string[]),
  );
  return {
    cells: options.cells,
    phantimalAllowed: options.phantimalAllowed,
    ownedHeroes: new Set([...roster.keys(), ...(options.extraHeroes ?? [])]),
    artifacts,
    seasonPhantimals,
    heroFactions: new Map((db.prepare('SELECT name, faction FROM hero').all() as { name: string; faction: string | null }[]).map((r) => [r.name, r.faction])),
    phantimalFactions: new Map((db.prepare('SELECT name, faction FROM phantimal').all() as { name: string; faction: string | null }[]).map((r) => [r.name, r.faction])),
  };
}

const hasState = (item: { rank?: unknown; equipmentLevel?: unknown }) => item.rank !== undefined || item.equipmentLevel !== undefined;

/** Returns an error message when a rank or equipment level carried by the payload is not allowed. */
export function validateSnapshots(formation: FormationPayload, rules: HeroStateRules): string | null {
  for (const h of formation.heroes ?? []) {
    if (!hasState(h) || isSummon(h)) continue;
    const error = validateHeroState({ rank: h.rank ?? null, equipmentLevel: h.equipmentLevel ?? null }, rules);
    if (error) return `${h.hero}: ${error}`;
  }
  if (formation.assistHero && (formation.assistRank !== undefined || formation.assistEquipmentLevel !== undefined)) {
    const error = validateHeroState({ rank: formation.assistRank ?? null, equipmentLevel: formation.assistEquipmentLevel ?? null }, rules);
    if (error) return `${formation.assistHero}: ${error}`;
  }
  return null;
}

const noState: RosterEntry = { hero_name: '', rank: null, equipment_level: null };

/**
 * Saves the formation of an attempt. Rank and equipment come from the payload or else the roster now (ADR 0001). A Formation
 * ID in the payload is declared in the library first, with the map the formation was used on, unless the fight is part of a
 * battle (`inBattle`), where the battle holds the code.
 */
export function insertFormation(
  db: Database.Database,
  attemptId: number,
  formation: FormationPayload,
  roster: Map<string, RosterEntry>,
  mapName?: string | null,
  inBattle = false,
): void {
  const formationIdCode = inBattle ? null : declareNamedFormationId(db, { code: formation.formationId, teams: [formation], mapNames: [mapName] });
  const assistState = !formation.assistHero
    ? noState
    : formation.assistRank !== undefined || formation.assistEquipmentLevel !== undefined
      ? { ...noState, rank: formation.assistRank ?? null, equipment_level: formation.assistEquipmentLevel ?? null }
      : (roster.get(formation.assistHero) ?? noState);
  const formationId = Number(
    db
      .prepare(
        `INSERT INTO formation (attempt_id, artifact, phantimal_name, phantimal_tile, phantimal_partner_tile,
           assist_hero, assist_rank, assist_equipment_level, formation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attemptId,
        formation.artifact ?? null,
        formation.phantimal?.name ?? null,
        formation.phantimal?.tile ?? null,
        formation.phantimal?.partnerTile ?? null,
        formation.assistHero ?? null,
        assistState.rank,
        assistState.equipment_level,
        formationIdCode,
      ).lastInsertRowid,
  );
  const insertHero = db.prepare(
    'INSERT INTO formation_hero (formation_id, tile, hero_name, part, rank, equipment_level) VALUES (?, ?, ?, ?, ?, ?)',
  );
  // A Pair Hero stands on two tiles as one hero, so both of its rows carry the one Hero State (ADR 0028): the first
  // row that gives a state decides it, and the other part follows rather than being validated apart.
  const sharedState = new Map<string, { rank: string | null; equipment_level: number | null }>();
  for (const placed of formation.heroes) {
    if (isSummon(placed)) continue;
    const state = hasState(placed)
      ? { rank: placed.rank ?? null, equipment_level: placed.equipmentLevel ?? null }
      : (roster.get(placed.hero) ?? noState);
    if (!sharedState.has(placed.hero)) sharedState.set(placed.hero, state);
  }
  for (const placed of formation.heroes) {
    const state = isSummon(placed) ? noState : (sharedState.get(placed.hero) ?? noState); // a summon has no rank or equipment
    insertHero.run(formationId, placed.tile, placed.hero, partOf(placed), state.rank, state.equipment_level);
  }
}

/** Replaces the formation of an existing attempt. */
export function replaceFormation(
  db: Database.Database,
  attemptId: number,
  formation: FormationPayload,
  roster: Map<string, RosterEntry>,
  mapName?: string | null,
  inBattle = false,
): void {
  db.prepare('DELETE FROM formation WHERE attempt_id = ?').run(attemptId);
  insertFormation(db, attemptId, formation, roster, mapName, inBattle);
}

/** Every hero a saved attempt used, so editing it can keep heroes that have left the roster. */
export function formationHeroNames(db: Database.Database, attemptId: number): string[] {
  const f = loadFormation(db, attemptId);
  return [...new Set(f.heroes.map((h) => h.name)), ...(f.assist ? [f.assist.name] : [])];
}

export type { FormationJson };

export function loadFormation(db: Database.Database, attemptId: number): FormationJson {
  const f = db.prepare('SELECT * FROM formation WHERE attempt_id = ?').get(attemptId) as {
    id: number;
    artifact: string | null;
    phantimal_name: string | null;
    phantimal_tile: number;
    phantimal_partner_tile: number | null;
    assist_hero: string | null;
    assist_rank: string | null;
    assist_equipment_level: number | null;
    formation_id: string | null;
  };
  return {
    artifact: f.artifact,
    heroes: db
      .prepare('SELECT tile, hero_name AS name, part, rank, equipment_level AS equipmentLevel FROM formation_hero WHERE formation_id = ? ORDER BY tile')
      .all(f.id) as FormationJson['heroes'],
    phantimal: f.phantimal_name ? { name: f.phantimal_name, tile: f.phantimal_tile, ...(f.phantimal_partner_tile != null ? { partnerTile: f.phantimal_partner_tile } : {}) } : null,
    assist: f.assist_hero ? { name: f.assist_hero, rank: f.assist_rank, equipmentLevel: f.assist_equipment_level } : null,
    formationId: f.formation_id,
  };
}
