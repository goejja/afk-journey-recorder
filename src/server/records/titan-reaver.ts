import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { normalizeTags } from '../../domain/tags.js';
import { validateFormation } from '../../domain/formation.js';
import type { HeroStateRules } from '../../domain/hero-state.js';
import { isSummon, partOf } from '../../domain/units.js';
import { battleTotal, sharedByTeams, TITAN_MAP, validateTitanReaverBattle, type TitanPhase } from '../../domain/titan-reaver.js';
import { declareNamedFormationId, formationIdProblem } from '../../db/formation-ids.js';
import type { FormationJson, TitanReaverBattle, TitanReaverBattleInput } from '../../shared/api.js';
import { titanReaverBattlesContract } from '../../shared/contracts/titan-reaver.js';
import { fail, serve } from '../contract.js';
import { currentSeason, hasName, mapCells } from '../db-helpers.js';
import { raiseSeasonPhase } from '../season-phase.js';
import { limitParam, listParam } from '../params.js';
import { formationContext, loadRoster, validateSnapshots, type FormationPayload, type RosterEntry } from './formations.js';

const DEFAULT_LIMIT = 200;
const noState: RosterEntry = { hero_name: '', rank: null, equipment_level: null };
const hasState = (item: { rank?: unknown; equipmentLevel?: unknown }) => item.rank !== undefined || item.equipmentLevel !== undefined;

export interface TitanReaverFilters {
  id?: number;
  season?: number;
  seasonPhase?: number;
  titanPhase?: string;
  tag?: string[];
  limit?: number;
}

const tagsOf = (db: Database.Database, id: number): string[] => db.prepare('SELECT tag FROM titan_reaver_tag WHERE battle_id = ? ORDER BY tag').pluck().all(id) as string[];

function loadFormation(db: Database.Database, battleId: number, position: number, fight: { artifact: string | null; phantimal_name: string | null; phantimal_tile: number | null; phantimal_partner_tile: number | null }): FormationJson {
  return {
    artifact: fight.artifact,
    heroes: db
      .prepare('SELECT tile, hero_name AS name, part, rank, equipment_level AS equipmentLevel FROM titan_reaver_hero WHERE battle_id = ? AND position = ? ORDER BY tile')
      .all(battleId, position) as FormationJson['heroes'],
    phantimal: fight.phantimal_name ? { name: fight.phantimal_name, tile: fight.phantimal_tile!, ...(fight.phantimal_partner_tile != null ? { partnerTile: fight.phantimal_partner_tile } : {}) } : null,
    assist: null,
    formationId: null,
  };
}

/** The recorded Titan Reaver Battles that match the filters, newest first, each with its two fights and tags. */
export function loadTitanReaverBattles(db: Database.Database, filters: TitanReaverFilters): TitanReaverBattle[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.id !== undefined) (where.push('b.id = ?'), params.push(filters.id));
  if (filters.season !== undefined) (where.push('b.season = ?'), params.push(filters.season));
  if (filters.seasonPhase !== undefined) (where.push('b.season_phase = ?'), params.push(filters.seasonPhase));
  if (filters.titanPhase) (where.push('b.titan_phase = ?'), params.push(filters.titanPhase));
  if (filters.tag) (where.push(`b.id IN (SELECT battle_id FROM titan_reaver_tag WHERE tag IN (${filters.tag.map(() => '?').join(', ')}))`), params.push(...filters.tag));
  const rows = db
    .prepare(
      `SELECT b.id, b.created_at AS createdAt, b.season, b.season_phase AS seasonPhase, b.titan_phase AS titanPhase, b.level, b.note, b.formation_id AS formationId
       FROM titan_reaver_battle b ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.id DESC LIMIT ?`,
    )
    .all(...params, filters.limit ?? DEFAULT_LIMIT) as Omit<TitanReaverBattle, 'tags' | 'fights' | 'total'>[];
  return rows.map((row) => {
    const fights = (
      db.prepare('SELECT position, boss_name AS boss, damage, artifact, phantimal_name, phantimal_tile, phantimal_partner_tile FROM titan_reaver_fight WHERE battle_id = ? ORDER BY position').all(row.id) as any[]
    ).map((f) => ({ position: f.position as 1 | 2, boss: f.boss as string, damage: f.damage as number, formation: loadFormation(db, row.id, f.position, f) }));
    return { ...row, titanPhase: row.titanPhase as TitanPhase, note: row.note ?? null, tags: tagsOf(db, row.id), fights, total: battleTotal(fights) };
  });
}

/** Routes for the Titan Reaver records: a Battle of two fights is saved, edited and deleted whole. */
export function titanReaverBattleRoutes(db: Database.Database, loadRules: () => HeroStateRules): Hono {
  const app = new Hono();

  /** Checks a Battle body. `editing` is the id of the Battle being replaced, whose season and heroes stay allowed. */
  function check(body: any, editing?: number): { error: string; status: 400 | 404 } | { note: string | null; tags: string[] | undefined; season: number } {
    const problem = validateTitanReaverBattle({ seasonPhase: body?.seasonPhase, titanPhase: body?.titanPhase, level: body?.level, fights: body?.fights });
    if (problem) return { error: problem, status: 400 };
    const fights = body.fights as TitanReaverBattleInput['fights'];
    for (const [i, fight] of fights.entries()) if (!hasName(db, 'boss', fight.boss)) return { error: `Fight ${i + 1}: unknown boss "${fight.boss}"`, status: 404 };
    const cells = mapCells(db, TITAN_MAP);
    if (!cells) return { error: `The ${TITAN_MAP} map is missing: add it in Admin > Maps`, status: 400 };

    const season = editing === undefined ? currentSeason(db) : (db.prepare('SELECT season FROM titan_reaver_battle WHERE id = ?').pluck().get(editing) as number);
    const keptHeroes = editing === undefined ? [] : (db.prepare('SELECT DISTINCT hero_name FROM titan_reaver_hero WHERE battle_id = ?').pluck().all(editing) as string[]);
    const roster = loadRoster(db);
    for (const [i, fight] of fights.entries()) {
      const formation = (fight.formation ?? {}) as FormationPayload & { assistHero?: string | null };
      if (formation.assistHero) return { error: `Fight ${i + 1}: Titan Reaver has no assist hero`, status: 400 };
      const error =
        validateFormation(
          { heroes: formation.heroes, phantimal: formation.phantimal, assistHero: null, artifact: formation.artifact },
          formationContext(db, roster, { cells, phantimalAllowed: true, season, extraHeroes: keptHeroes }),
        ) ?? validateSnapshots(formation, loadRules());
      if (error) return { error: `Fight ${i + 1}: ${error}`, status: 400 };
    }
    const shared = sharedByTeams(fights.map((f) => ({ heroes: (f.formation?.heroes ?? []).map((h) => h.hero), artifact: f.formation?.artifact ?? null })));
    if (shared) return { error: `${shared.name} is in both fights: the two teams of a Battle share no hero or Artifact (${shared.kind})`, status: 400 };

    const codeError = formationIdProblem(db, { code: body.formationId, teams: fights.map((f) => f.formation), mapNames: fights.map(() => TITAN_MAP) });
    if (codeError) return { error: codeError, status: 400 };
    const tags = normalizeTags(body.tags);
    if ('error' in tags) return { error: tags.error, status: 400 };
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
    return { note, tags: tags.tags, season };
  }

  /** Writes the fights of a Battle (and their heroes) from a checked body. Call inside a transaction. */
  function writeFights(battleId: number, fights: TitanReaverBattleInput['fights'], roster: Map<string, RosterEntry>): void {
    const insertFight = db.prepare('INSERT INTO titan_reaver_fight (battle_id, position, boss_name, damage, artifact, phantimal_name, phantimal_tile, phantimal_partner_tile) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertHero = db.prepare('INSERT INTO titan_reaver_hero (battle_id, position, tile, hero_name, part, rank, equipment_level) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [i, fight] of fights.entries()) {
      const position = i + 1;
      const formation = fight.formation;
      insertFight.run(battleId, position, fight.boss, fight.damage, formation.artifact ?? null, formation.phantimal?.name ?? null, formation.phantimal?.tile ?? null, formation.phantimal?.partnerTile ?? null);
      // As in a Dream Hunt fight: rank and equipment are the payload's, else the roster's now (ADR 0001), and a Pair Hero's parts share one state.
      const sharedState = new Map<string, { rank: string | null; equipment_level: number | null }>();
      for (const placed of formation.heroes) {
        if (isSummon(placed)) continue;
        const state = hasState(placed) ? { rank: placed.rank ?? null, equipment_level: placed.equipmentLevel ?? null } : (roster.get(placed.hero) ?? noState);
        if (!sharedState.has(placed.hero)) sharedState.set(placed.hero, state);
      }
      for (const placed of formation.heroes) {
        const state = isSummon(placed) ? noState : (sharedState.get(placed.hero) ?? noState);
        insertHero.run(battleId, position, placed.tile, placed.hero, partOf(placed), state.rank, state.equipment_level);
      }
    }
  }

  function writeTags(battleId: number, tags: string[] | undefined): void {
    if (tags === undefined) return;
    db.prepare('DELETE FROM titan_reaver_tag WHERE battle_id = ?').run(battleId);
    const insert = db.prepare('INSERT INTO titan_reaver_tag (battle_id, tag) VALUES (?, ?)');
    for (const tag of tags) insert.run(battleId, tag);
  }

  serve(app, titanReaverBattlesContract.create, ({ body: given }) => {
    const body = given as any;
    const checked = check(body);
    if ('error' in checked) return fail(checked.status, checked.error);
    const id = db.transaction(() => {
      const battleId = Number(
        db
          .prepare('INSERT INTO titan_reaver_battle (season, season_phase, titan_phase, level, note, formation_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(checked.season, body.seasonPhase, body.titanPhase, body.level, checked.note, declareNamedFormationId(db, { code: body.formationId, teams: body.fights.map((f: any) => f.formation), mapNames: body.fights.map(() => TITAN_MAP) })).lastInsertRowid,
      );
      writeFights(battleId, body.fights, loadRoster(db));
      writeTags(battleId, checked.tags);
      raiseSeasonPhase(db, checked.season, body.seasonPhase);
      return battleId;
    })();
    return loadTitanReaverBattles(db, { id })[0]!;
  });

  serve(app, titanReaverBattlesContract.update, ({ params, body: given }) => {
    const id = Number(params.id);
    if (!db.prepare('SELECT 1 FROM titan_reaver_battle WHERE id = ?').get(id)) return fail(404, `Record ${params.id} no longer exists`);
    const body = given as any;
    const checked = check(body, id);
    if ('error' in checked) return fail(checked.status, checked.error);
    db.transaction(() => {
      db.prepare('UPDATE titan_reaver_battle SET season_phase = ?, titan_phase = ?, level = ?, note = ?, formation_id = ? WHERE id = ?').run(
        body.seasonPhase,
        body.titanPhase,
        body.level,
        checked.note,
        declareNamedFormationId(db, { code: body.formationId, teams: body.fights.map((f: any) => f.formation), mapNames: body.fights.map(() => TITAN_MAP) }),
        id,
      );
      db.prepare('DELETE FROM titan_reaver_fight WHERE battle_id = ?').run(id);
      writeFights(id, body.fights, loadRoster(db));
      writeTags(id, checked.tags);
      raiseSeasonPhase(db, checked.season, body.seasonPhase);
    })();
    return loadTitanReaverBattles(db, { id })[0]!;
  });

  serve(app, titanReaverBattlesContract.list, (_, c) => {
    const seasonPhase = Number(c.req.query('seasonPhase'));
    const season = Number(c.req.query('season'));
    return loadTitanReaverBattles(db, {
      season: Number.isInteger(season) && season >= 1 ? season : undefined,
      seasonPhase: Number.isInteger(seasonPhase) && seasonPhase >= 1 ? seasonPhase : undefined,
      titanPhase: c.req.query('titanPhase') || undefined,
      tag: listParam(c, 'tag'),
      limit: limitParam(c),
    });
  });

  serve(app, titanReaverBattlesContract.get, ({ params }) => loadTitanReaverBattles(db, { id: Number(params.id) })[0] ?? fail(404, `Record ${params.id} no longer exists`));

  serve(app, titanReaverBattlesContract.remove, ({ params }) => {
    const removed = db.prepare('DELETE FROM titan_reaver_battle WHERE id = ?').run(Number(params.id)).changes;
    if (removed === 0) return fail(404, `Record ${params.id} no longer exists`);
  });

  return app;
}
