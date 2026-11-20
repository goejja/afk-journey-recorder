import type { ArenaBattle } from '../../shared/api.js';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ARENA_MODES, checkFixedMap, modeAllowsPhantimal, sharedHero, TEAMS_PER_MODE, validateOpponent, validateUnionLevel, type ArenaMode } from '../../domain/arena.js';
import { normalizeTags } from '../../domain/tags.js';
import { checkTournamentRound } from '../../domain/tournament.js';
import { validateFormation } from '../../domain/formation.js';
import { isSummon, partOf } from '../../domain/units.js';
import type { HeroStateRules } from '../../domain/hero-state.js';
import {
  formationContext,
  insertFormation,
  loadFormation,
  fightFormationIdProblem,
  replaceFormation,
  validateSnapshots,
} from './formations.js';
import { battleFormationIdProblem, saveBattleFormationIds, sharedHeroInBattle, teamOf, withWholeBattles } from './battles.js';
import { anyOf, limitParam, listParam } from '../params.js';
import { declareNamedFormationId } from '../../db/formation-ids.js';
import { loadPlayerId, normalizePlayerId, savePlayerId } from '../reference/players.js';
import { hasAnyTag, loadTags, saveTags } from './tags.js';
import { hasId, hasName, heroNames, seasonOfNewRecord } from '../db-helpers.js';
import { arenaContract } from '../../shared/contracts/arena.js';
import { fail, serve } from '../contract.js';

const DEFAULT_LIMIT = 200;

/** Routes for the PvP battles (Arena, Supreme Arena, Super League and Guild Duel), each recorded on its own. */
export function arenaRoutes(db: Database.Database, loadRules: () => HeroStateRules): Hono {
  const app = new Hono();

  function loadBattles(filters: { id?: number; mode?: string[]; tag?: string[]; player?: string; tournament?: number; round?: string; limit?: number }): ArenaBattle[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.id !== undefined) (where.push('a.id = ?'), params.push(filters.id));
    if (filters.mode) {
      const modes = anyOf('r.mode', filters.mode);
      where.push(modes.clause), params.push(...modes.params);
    }
    if (filters.tag) {
      const tags = hasAnyTag(filters.tag);
      where.push(tags.clause), params.push(...tags.params);
    }
    if (filters.player) {
      // A part of a Player ID, or of the name of the Profile that has it, on either side.
      where.push(
        `a.id IN (SELECT ap.attempt_id FROM attempt_player ap LEFT JOIN profile p ON lower(p.player_id) = lower(ap.player_id)
                  WHERE instr(lower(ap.player_id), lower(?)) > 0 OR instr(lower(p.name), lower(?)) > 0)`,
      );
      params.push(filters.player, filters.player);
    }
    if (filters.tournament !== undefined) (where.push('b.tournament_id = ?'), params.push(filters.tournament));
    if (filters.round !== undefined) (where.push('b.round = ?'), params.push(filters.round));
    const rows = db
      .prepare(
        `SELECT a.id, a.outcome, a.note, a.created_at AS createdAt, a.season, a.battle_id AS battleId, a.battle_position AS battlePosition, r.mode, r.map_name AS mapName, r.rule,
                r.opp_artifact, r.opp_assist_hero, r.opp_assist_rank, r.opp_assist_equipment,
                r.opp_phantimal, r.opp_phantimal_tile, r.opp_phantimal_partner_tile, r.opp_formation_id, r.union_level AS unionLevel, r.opp_union_level AS opponentUnionLevel,
                b.formation_id AS battleFormationId, b.opp_formation_id AS battleOpponentFormationId, b.tournament_id AS tournamentId, b.round
         FROM arena_attempt r JOIN attempt a ON a.id = r.attempt_id LEFT JOIN battle b ON b.id = a.battle_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT ?`,
      )
      .all(...params, filters.limit ?? DEFAULT_LIMIT) as any[];
    return rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      createdAt: r.createdAt,
      season: r.season,
      outcome: r.outcome,
      note: r.note,
      mapName: r.mapName,
      rule: r.rule,
      unionLevel: r.unionLevel,
      opponentUnionLevel: r.opponentUnionLevel,
      formation: loadFormation(db, r.id),
      tags: loadTags(db, r.id),
      playerIdA: loadPlayerId(db, r.id, 'A'),
      playerIdB: loadPlayerId(db, r.id, 'B'),
      battleId: r.battleId,
      battlePosition: r.battlePosition,
      battleFormationId: r.battleFormationId,
      battleOpponentFormationId: r.battleOpponentFormationId,
      tournamentId: r.tournamentId,
      round: r.round,
      opponent: {
        heroes: db
          .prepare('SELECT tile, hero_name AS name, part, rank, equipment_level AS equipmentLevel FROM arena_opponent_hero WHERE attempt_id = ? ORDER BY tile')
          .all(r.id) as ArenaBattle['opponent']['heroes'],
        assist: r.opp_assist_hero ? { name: r.opp_assist_hero, rank: r.opp_assist_rank, equipmentLevel: r.opp_assist_equipment } : null,
        phantimal: r.opp_phantimal ? { name: r.opp_phantimal, tile: r.opp_phantimal_tile, ...(r.opp_phantimal_partner_tile != null ? { partnerTile: r.opp_phantimal_partner_tile } : {}) } : null,
        artifact: r.opp_artifact,
        formationId: r.opp_formation_id,
      },
    }));
  }

  /** The Tournament and Round a battle-group body names, checked against the Tournaments saved. */
  function roundOf(mode: ArenaMode, body: any): ReturnType<typeof checkTournamentRound> {
    const named = checkTournamentRound(mode, body);
    if (named && 'error' in named) return named;
    if (named?.tournamentId != null && !hasId(db, 'tournament', named.tournamentId)) return { error: 'Unknown Tournament' };
    return named;
  }

  /** Checks a battle body. */
  function check(body: any, inBattle = false): { error: string; status: 400 } | { cells: number[]; rule: string | null; note: string | null; tags: string[] | undefined; playerIdA: string | null | undefined; playerIdB: string | null | undefined } {
    if (!ARENA_MODES.includes(body?.mode)) return { error: `The mode must be one of ${ARENA_MODES.join(', ')}`, status: 400 };
    if (body.outcome !== 'Win' && body.outcome !== 'Loss') return { error: 'The result must be Win or Loss', status: 400 };
    const map =
      typeof body.mapName === 'string'
        ? (db.prepare('SELECT tags, cells FROM map WHERE name = ?').get(body.mapName) as { tags: string; cells: string } | undefined)
        : undefined;
    if (!map || !(JSON.parse(map.tags) as string[]).includes('Arena')) return { error: 'Pick an Arena map', status: 400 };
    const fixedError = checkFixedMap(body.mode, body.mapName);
    if (fixedError) return { error: fixedError, status: 400 };
    const cells = JSON.parse(map.cells) as number[];

    const rule = body.rule || null;
    if (rule !== null) {
      if (body.mode !== 'Supreme Arena') return { error: 'Only Supreme Arena battles have a rule', status: 400 };
      if (!hasName(db, 'boss_rule', rule)) return { error: `Unknown rule "${rule}"`, status: 400 };
    }

    if (body.mode !== 'Guild Duel' && (body.unionLevel != null || body.opponentUnionLevel != null)) return { error: 'Only Guild Duel battles have a Union Level', status: 400 };
    const unionError = validateUnionLevel(body.unionLevel, 'Your Union Level') ?? validateUnionLevel(body.opponentUnionLevel, 'The opponent’s Union Level');
    if (unionError) return { error: unionError, status: 400 };

    const rules = loadRules();
    // Arena records may be other players' matches, so any hero can be on either side and
    // ranks come only from what was entered, never from your roster.
    const allHeroes = heroNames(db);
    const formation = body.formation ?? {};
    const formationError =
      validateFormation(
        { heroes: formation.heroes, phantimal: formation.phantimal, assistHero: formation.assistHero, artifact: formation.artifact },
        formationContext(db, new Map(), { cells, phantimalAllowed: modeAllowsPhantimal(body.mode), allPhantimals: true, extraHeroes: allHeroes }),
      ) ?? validateSnapshots(formation, rules) ?? fightFormationIdProblem(db, formation, inBattle);
    if (formationError) return { error: formationError, status: 400 };

    const opponentError = validateOpponent(body.opponent ?? {}, {
      cells,
      knownHeroes: new Set(allHeroes),
      phantimalAllowed: modeAllowsPhantimal(body.mode),
      phantimals: new Set(db.prepare('SELECT name FROM phantimal').pluck().all() as string[]),
      heroFactions: new Map((db.prepare('SELECT name, faction FROM hero').all() as { name: string; faction: string | null }[]).map((r) => [r.name, r.faction])),
      phantimalFactions: new Map((db.prepare('SELECT name, faction FROM phantimal').all() as { name: string; faction: string | null }[]).map((r) => [r.name, r.faction])),
      artifacts: new Set(db.prepare('SELECT name FROM artifact').pluck().all() as string[]),
      rules,
    });
    if (opponentError) return { error: opponentError, status: 400 };
    const opponentIdError = fightFormationIdProblem(db, body.opponent ?? {}, inBattle);
    if (opponentIdError) return { error: `Side B: ${opponentIdError}`, status: 400 };

    const tags = normalizeTags(body.tags);
    if ('error' in tags) return { error: tags.error, status: 400 };
    const playerIdA = normalizePlayerId(body.playerIdA);
    if ('error' in playerIdA) return { error: `Side A: ${playerIdA.error}`, status: 400 };
    const playerIdB = normalizePlayerId(body.playerIdB);
    if ('error' in playerIdB) return { error: `Side B: ${playerIdB.error}`, status: 400 };
    return { cells, rule, tags: tags.tags, playerIdA: playerIdA.playerId, playerIdB: playerIdB.playerId, note: typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null };
  }

  /** Writes the mode-specific rows of a battle (they are replaced wholesale when editing). */
  function saveBattleRows(attemptId: number, body: any, rule: string | null, inBattle: boolean): void {
    const opponent = body.opponent;
    db.prepare('DELETE FROM arena_attempt WHERE attempt_id = ?').run(attemptId);
    db.prepare(
      `INSERT INTO arena_attempt (attempt_id, mode, map_name, rule, opp_artifact,
         opp_assist_hero, opp_assist_rank, opp_assist_equipment, opp_phantimal, opp_phantimal_tile, opp_phantimal_partner_tile, union_level, opp_union_level, opp_formation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      attemptId, body.mode, body.mapName, rule,
      opponent.artifact ?? null,
      opponent.assistHero ?? null, opponent.assistHero ? (opponent.assistRank ?? null) : null,
      opponent.assistHero ? (opponent.assistEquipmentLevel ?? null) : null,
      opponent.phantimal?.name ?? null, opponent.phantimal?.tile ?? null, opponent.phantimal?.partnerTile ?? null,
      body.unionLevel ?? null, body.opponentUnionLevel ?? null,
      inBattle ? null : declareNamedFormationId(db, { code: opponent.formationId, teams: [opponent], mapNames: [body.mapName] }),
    );
    const insertHero = db.prepare('INSERT INTO arena_opponent_hero (attempt_id, tile, hero_name, part, rank, equipment_level) VALUES (?, ?, ?, ?, ?, ?)');
    // Both rows of a Pair Hero carry one Hero State, as for Side A.
    const sharedState = new Map<string, { rank: string | null; equipmentLevel: number | null }>();
    for (const h of opponent.heroes) if (!isSummon(h) && !sharedState.has(h.hero)) sharedState.set(h.hero, { rank: h.rank ?? null, equipmentLevel: h.equipmentLevel ?? null });
    for (const h of opponent.heroes) {
      const summon = isSummon(h);
      const state = summon ? null : sharedState.get(h.hero);
      insertHero.run(attemptId, h.tile, h.hero, partOf(h), state?.rank ?? null, state?.equipmentLevel ?? null);
    }
  }

  serve(app, arenaContract.list, (_, c) => {
    const listed = loadBattles({ mode: listParam(c, 'mode'), tag: listParam(c, 'tag'), player: c.req.query('player')?.trim() || undefined, tournament: c.req.query('tournament') ? Number(c.req.query('tournament')) : undefined, round: c.req.query('round') || undefined, limit: limitParam(c) });
    return withWholeBattles(db, listed, (id) => loadBattles({ id })[0]);
  });

  serve(app, arenaContract.get, ({ params }) => {
    const id = Number(params.id);
    return (Number.isInteger(id) ? loadBattles({ id })[0] : undefined) ?? fail(404, `Record ${params.id} no longer exists`);
  });

  /** Checks the teams of a battle body: their numbers, each fight, that no hero is on two teams, the Formation IDs, and the Tournament and Round. */
  function checkGroup(mode: ArenaMode, body: any, fights: any[]):
    | { error: string; status: 400 }
    | { positions: number[]; checks: Extract<ReturnType<typeof check>, { cells: number[] }>[]; round: Exclude<ReturnType<typeof roundOf>, { error: string }> } {
    const positions = fights.map((f, i) => (f?.position === undefined ? i + 1 : f.position));
    if (positions.some((p) => !Number.isInteger(p) || p < 1 || p > TEAMS_PER_MODE[mode]) || new Set(positions).size !== positions.length) {
      return { error: `Team numbers go from 1 to ${TEAMS_PER_MODE[mode]}, each once`, status: 400 };
    }
    const checks: Extract<ReturnType<typeof check>, { cells: number[] }>[] = [];
    for (const [i, fight] of fights.entries()) {
      const checked = check({ ...fight, mode }, true);
      if ('error' in checked) return { error: `Team ${positions[i]}: ${checked.error}`, status: 400 };
      checks.push(checked);
    }
    const shared = sharedHero(fights.map(teamOf));
    if (shared) return { error: `${shared.hero} is on teams ${positions[shared.first]} and ${positions[shared.second]}: a hero plays on one team only`, status: 400 };
    const codeError = battleFormationIdProblem(db, body, fights, positions, true);
    if (codeError) return { error: codeError, status: 400 };
    const round = roundOf(mode, body);
    if (round && 'error' in round) return { error: round.error, status: 400 };
    return { positions, checks, round };
  }

  /** Inserts one checked fight, in a battle when `link` is given. Call inside a transaction. */
  function insertFight(body: any, checked: Extract<ReturnType<typeof check>, { cells: number[] }>, link?: { battleId: number; position: number }): number {
    const attemptId = Number(
      db
        .prepare("INSERT INTO attempt (mode, outcome, note, battle_id, battle_position, season) VALUES ('Arena', ?, ?, ?, ?, ?)")
        .run(body.outcome, checked.note, link?.battleId ?? null, link?.position ?? null, seasonOfNewRecord(db, link?.battleId)).lastInsertRowid,
    );
    saveBattleRows(attemptId, body, checked.rule, link !== undefined);
    insertFormation(db, attemptId, body.formation, new Map(), body.mapName, link !== undefined);
    saveTags(db, attemptId, checked.tags);
    savePlayerId(db, attemptId, 'A', checked.playerIdA);
    savePlayerId(db, attemptId, 'B', checked.playerIdB);
    return attemptId;
  }

  serve(app, arenaContract.create, ({ body: given }) => {
    const body = given as any;
    const checked = check(body);
    if ('error' in checked) return fail(checked.status, checked.error);
    const id = db.transaction(() => insertFight(body, checked))();
    return loadBattles({ id })[0]!;
  });

  // A Battle: the teams of a Supreme Arena, Super League or Guild Duel battle, saved together or not at all.
  serve(app, arenaContract.createGroup, ({ body: given }) => {
    const body = given as any;
    const mode = body?.mode as ArenaMode;
    if (!ARENA_MODES.includes(mode) || TEAMS_PER_MODE[mode] < 2) return fail(400, 'Only Supreme Arena, Super League and Guild Duel battles have several teams');
    const fights = body.fights;
    if (!Array.isArray(fights) || fights.length === 0 || fights.length > TEAMS_PER_MODE[mode]) return fail(400, `A ${mode} battle has 1 to ${TEAMS_PER_MODE[mode]} teams`);
    const group = checkGroup(mode, body, fights);
    if ('error' in group) return fail(group.status, group.error);
    const { positions, checks, round } = group;
    const ids = db.transaction(() => {
      const battleId = Number(db.prepare('INSERT INTO battle (mode, tournament_id, round) VALUES (?, ?, ?)').run(mode, round?.tournamentId ?? null, round?.round ?? null).lastInsertRowid);
      const ids = fights.map((fight, i) => insertFight({ ...fight, mode }, checks[i]!, { battleId, position: positions[i]! }));
      saveBattleFormationIds(db, battleId, body, fights, positions, true);
      return { battleId, ids };
    })();
    return { id: ids.battleId, fights: ids.ids.map((id) => loadBattles({ id })[0]!) };
  });

  /** Rewrites one saved fight from a checked body. Call inside a transaction. */
  function updateFight(id: number, body: any, checked: Extract<ReturnType<typeof check>, { cells: number[] }>): void {
    db.prepare('UPDATE attempt SET outcome = ?, note = ? WHERE id = ?').run(body.outcome, checked.note, id);
    const inBattle = db.prepare('SELECT battle_id IS NOT NULL FROM attempt WHERE id = ?').pluck().get(id) === 1;
    saveBattleRows(id, body, checked.rule, inBattle);
    replaceFormation(db, id, body.formation, new Map(), body.mapName, inBattle);
    saveTags(db, id, checked.tags);
    savePlayerId(db, id, 'A', checked.playerIdA);
    savePlayerId(db, id, 'B', checked.playerIdB);
  }

  // Edits a whole battle: the teams given are the battle's teams now. A number already in the battle is updated in
  // place, a new number is added, and a number left out is removed. All or nothing.
  serve(app, arenaContract.updateGroup, ({ params, body: given }) => {
    const id = Number(params.id);
    const mode = db.prepare('SELECT mode FROM battle WHERE id = ?').pluck().get(id) as ArenaMode | undefined;
    if (!mode || !ARENA_MODES.includes(mode)) return fail(404, 'Unknown battle');
    const body = given as any;
    const fights = body?.fights;
    if (!Array.isArray(fights) || fights.length === 0 || fights.length > TEAMS_PER_MODE[mode]) return fail(400, `A ${mode} battle has 1 to ${TEAMS_PER_MODE[mode]} teams`);
    const group = checkGroup(mode, body, fights);
    if ('error' in group) return fail(group.status, group.error);
    const { positions, checks, round } = group;
    const existing = db.prepare('SELECT id, battle_position AS position FROM attempt WHERE battle_id = ?').all(id) as { id: number; position: number | null }[];
    const saved = db.transaction(() => {
      // A body that does not mention the Tournament and Round leaves them as they are.
      if (round) db.prepare('UPDATE battle SET tournament_id = ?, round = ? WHERE id = ?').run(round.tournamentId, round.round, id);
      const kept = new Set<number>();
      const ids = fights.map((fight, i) => {
        const current = existing.find((e) => e.position === positions[i]);
        if (!current) return insertFight({ ...fight, mode }, checks[i]!, { battleId: id, position: positions[i]! });
        updateFight(current.id, { ...fight, mode }, checks[i]!);
        kept.add(current.id);
        return current.id;
      });
      for (const e of existing) if (!kept.has(e.id)) db.prepare('DELETE FROM attempt WHERE id = ?').run(e.id);
      saveBattleFormationIds(db, id, body, fights, positions, true);
      return ids;
    })();
    return { id, fights: saved.map((attemptId) => loadBattles({ id: attemptId })[0]!) };
  });

  serve(app, arenaContract.update, ({ params, body: given }) => {
    const id = Number(params.id);
    if (loadBattles({ id }).length === 0) return fail(404, 'Unknown battle');
    const body = given as any;
    const checked = check(body, db.prepare('SELECT battle_id IS NOT NULL FROM attempt WHERE id = ?').pluck().get(id) === 1);
    if ('error' in checked) return fail(checked.status, checked.error);
    // Editing a team of a battle keeps the rule that a hero plays on one team only.
    const conflict = sharedHeroInBattle(db, id, body);
    if (conflict) return fail(400, conflict);
    db.transaction(() => updateFight(id, body, checked))();
    return loadBattles({ id })[0]!;
  });

  return app;
}
