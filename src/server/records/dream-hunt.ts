import type { DreamHuntAttempt } from '../../shared/api.js';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { normalizeTags } from '../../domain/tags.js';
import { sharedHero } from '../../domain/arena.js';
import { DREAM_HUNT_FIGHTS, summarizeCompositions, validateDreamHuntResult, type DreamHuntRun } from '../../domain/dream-hunt.js';
import { validateFormation } from '../../domain/formation.js';
import { layoutFrom } from '../../domain/layout.js';
import type { HeroStateRules } from '../../domain/hero-state.js';
import { battleFormationIdProblem, saveBattleFormationIds, sharedHeroInBattle, teamOf, withWholeBattles } from './battles.js';
import { anyOf, limitParam, listParam } from '../params.js';
import { hasAnyTag, loadTags, saveTags } from './tags.js';
import { fightFormationIdProblem, formationContext, formationHeroNames, insertFormation, loadFormation, loadRoster, replaceFormation, validateSnapshots } from './formations.js';
import { hasName, mapCells, seasonOfNewRecord } from '../db-helpers.js';
import { dreamHuntContract, type Boss, type BossRule } from '../../shared/contracts/dream-hunt.js';
import { fail, serve } from '../contract.js';

const DEFAULT_LIMIT = 200;


export interface DreamHuntFilters {
  id?: number;
  boss?: string[];
  rule?: string; // 'none' for fights without a boss rule, or a rule name
  tag?: string[];
  since?: string; // YYYY-MM-DD: only fights recorded on or after this day
  limit?: number;
}

/** The recorded Dream Hunt fights that match the filters, newest first, each with its formation and tags. */
export function loadDreamHuntAttempts(db: Database.Database, filters: DreamHuntFilters): DreamHuntAttempt[] {
  const where = ["a.mode = 'Dream Hunt'"];
  const params: unknown[] = [];
  if (filters.id !== undefined) (where.push('a.id = ?'), params.push(filters.id));
  if (filters.boss) {
    const bosses = anyOf('d.boss_name', filters.boss);
    where.push(bosses.clause), params.push(...bosses.params);
  }
  if (filters.tag) {
    const tags = hasAnyTag(filters.tag);
    where.push(tags.clause), params.push(...tags.params);
  }
  if (filters.since) (where.push('a.created_at >= ?'), params.push(filters.since));
  if (filters.rule === 'none') where.push('d.boss_rule IS NULL');
  else if (filters.rule) (where.push('d.boss_rule = ?'), params.push(filters.rule));
  const rows = db
    .prepare(
      `SELECT a.id, a.outcome, a.note, a.created_at AS createdAt, a.season, a.battle_id AS battleId, a.battle_position AS battlePosition,
              d.boss_name AS boss, d.map_name AS mapName, d.time_seconds AS timeSeconds, d.boss_rule AS bossRule,
              b.formation_id AS battleFormationId
       FROM attempt a JOIN dream_hunt_attempt d ON d.attempt_id = a.id LEFT JOIN battle b ON b.id = a.battle_id
       WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ?`,
    )
    .all(...params, filters.limit ?? DEFAULT_LIMIT) as any[];
  return rows.map((r) => ({ ...r, formation: loadFormation(db, r.id), tags: loadTags(db, r.id) }));
}

/** Routes for Dream Hunt: boss fights, the editable boss-rule list, and per-boss team comparison. */
export function dreamHuntRoutes(db: Database.Database, loadRules: () => HeroStateRules): Hono {
  const app = new Hono();

  const bossExists = (name: string) => hasName(db, 'boss', name);
  const ruleExists = (name: string) => hasName(db, 'boss_rule', name);
  const cellsOf = (name: string) => mapCells(db, name);

  // ---- bosses and boss rules ----------------------------------------------------------------

  serve(app, dreamHuntContract.bosses, () =>
    db
      .prepare(
        `SELECT b.name, b.class, b.damage_type AS damageType,
                (SELECT count(*) FROM dream_hunt_attempt d WHERE d.boss_name = b.name) AS attempts
         FROM boss b ORDER BY b.name`,
      )
      .all() as Boss[],
  );

  serve(app, dreamHuntContract.rules, () => db.prepare('SELECT name, description FROM boss_rule ORDER BY name').all() as BossRule[]);

  const ruleInput = (body: any): { name: string; description: string } | string => {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return 'A boss rule needs a name';
    if (body.description !== undefined && typeof body.description !== 'string') return 'The description must be text';
    return { name, description: (body.description ?? '').trim() };
  };

  serve(app, dreamHuntContract.createRule, ({ body }) => {
    const input = ruleInput(body);
    if (typeof input === 'string') return fail(400, input);
    if (ruleExists(input.name)) return fail(409, `A boss rule named "${input.name}" already exists`);
    db.prepare('INSERT INTO boss_rule (name, description) VALUES (?, ?)').run(input.name, input.description);
    return input;
  });

  serve(app, dreamHuntContract.saveRule, ({ params, body }) => {
    const current = params.name;
    if (!ruleExists(current)) return fail(404, 'Unknown boss rule');
    const input = ruleInput(body);
    if (typeof input === 'string') return fail(400, input);
    if (input.name !== current && ruleExists(input.name)) return fail(409, `A boss rule named "${input.name}" already exists`);
    db.prepare('UPDATE boss_rule SET name = ?, description = ? WHERE name = ?').run(input.name, input.description, current);
    return input;
  });

  serve(app, dreamHuntContract.removeRule, ({ params }) => {
    const name = params.name;
    const used = db
      .prepare('SELECT (SELECT count(*) FROM dream_hunt_attempt WHERE boss_rule = ?) + (SELECT count(*) FROM arena_attempt WHERE rule = ?)')
      .pluck()
      .get(name, name) as number;
    if (used > 0) return fail(409, `"${name}" is used by ${used} attempt${used === 1 ? '' : 's'}, so it cannot be deleted`);
    db.prepare('DELETE FROM boss_rule WHERE name = ?').run(name);
  });

  // ---- attempts -----------------------------------------------------------------------------

  /** Checks a fight body. `editing` is the id (or ids) of the fights being replaced, whose heroes stay allowed. */
  function check(body: any, editing?: number | number[], inBattle = false): { error: string; status: 400 | 404 } | { bossRule: string | null; timeSeconds: number | null; note: string | null; tags: string[] | undefined } {
    if (typeof body?.boss !== 'string' || !bossExists(body.boss)) return { error: 'Unknown boss', status: 404 as const };
    const cells = typeof body.mapName === 'string' ? cellsOf(body.mapName) : null;
    if (!cells) return { error: 'Pick a map for the formation', status: 400 as const };
    const bossRule = body.bossRule || null;
    if (bossRule !== null && !ruleExists(bossRule)) return { error: `Unknown rule "${bossRule}"`, status: 400 as const };
    const timeSeconds = body.timeSeconds ?? null;
    const resultError = validateDreamHuntResult({ outcome: body.outcome, timeSeconds });
    if (resultError) return { error: resultError, status: 400 as const };

    const formation = body.formation ?? {};
    const formationError =
      validateFormation(
        {
          heroes: formation.heroes,
          phantimal: formation.phantimal,
          assistHero: formation.assistHero,
          artifact: formation.artifact,
        },
        formationContext(db, loadRoster(db), {
          cells,
          phantimalAllowed: false,
          extraHeroes: editing === undefined ? [] : [editing].flat().flatMap((id) => formationHeroNames(db, id)),
        }),
      ) ?? validateSnapshots(formation, loadRules()) ?? fightFormationIdProblem(db, formation, inBattle);
    if (formationError) return { error: formationError, status: 400 as const };
    const tags = normalizeTags(body.tags);
    if ('error' in tags) return { error: tags.error, status: 400 as const };
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
    return { bossRule: bossRule as string | null, timeSeconds: timeSeconds as number | null, note, tags: tags.tags };
  }

  /** Inserts one checked fight, in a battle when `link` is given. Call inside a transaction. */
  function insertFight(body: any, checked: Exclude<ReturnType<typeof check>, { error: string }>, link?: { battleId: number; position: number }): number {
    const attemptId = Number(
      db
        .prepare("INSERT INTO attempt (mode, outcome, note, battle_id, battle_position, season) VALUES ('Dream Hunt', ?, ?, ?, ?, ?)")
        .run(body.outcome, checked.note, link?.battleId ?? null, link?.position ?? null, seasonOfNewRecord(db, link?.battleId)).lastInsertRowid,
    );
    db.prepare('INSERT INTO dream_hunt_attempt (attempt_id, boss_name, map_name, time_seconds, boss_rule) VALUES (?, ?, ?, ?, ?)').run(
      attemptId,
      body.boss,
      body.mapName,
      checked.timeSeconds,
      checked.bossRule,
    );
    insertFormation(db, attemptId, body.formation, loadRoster(db), body.mapName, link !== undefined);
    saveTags(db, attemptId, checked.tags);
    return attemptId;
  }

  serve(app, dreamHuntContract.create, ({ body: given }) => {
    const body = given as any;
    const checked = check(body);
    if ('error' in checked) return fail(checked.status, checked.error);
    const id = db.transaction(() => insertFight(body, checked))();
    return loadAttempts({ id })[0]!;
  });

  // A day of Dream Hunt: its fights saved together as one battle, or not at all.
  serve(app, dreamHuntContract.createDay, ({ body: given }) => {
    const body = given as any;
    const fights = body?.fights;
    if (!Array.isArray(fights) || fights.length === 0 || fights.length > DREAM_HUNT_FIGHTS) return fail(400, `A day of Dream Hunt has 1 to ${DREAM_HUNT_FIGHTS} fights`);
    const positions = fights.map((f, i) => (f?.position === undefined ? i + 1 : f.position));
    if (positions.some((p) => !Number.isInteger(p) || p < 1 || p > DREAM_HUNT_FIGHTS) || new Set(positions).size !== positions.length) {
      return fail(400, `Fight numbers go from 1 to ${DREAM_HUNT_FIGHTS}, each once`);
    }
    const checks: Exclude<ReturnType<typeof check>, { error: string }>[] = [];
    for (const [i, fight] of fights.entries()) {
      const checked = check(fight, undefined, true);
      if ('error' in checked) return fail(checked.status, `Fight ${positions[i]}: ${checked.error}`);
      checks.push(checked);
    }
    const shared = sharedHero(fights.map(teamOf));
    if (shared) return fail(400, `${shared.hero} is in fights ${positions[shared.first]} and ${positions[shared.second]}: a hero plays in one fight only`);
    const codeError = battleFormationIdProblem(db, body, fights, positions, false);
    if (codeError) return fail(400, codeError);
    const saved = db.transaction(() => {
      const battleId = Number(db.prepare("INSERT INTO battle (mode) VALUES ('Dream Hunt')").run().lastInsertRowid);
      const ids = fights.map((fight, i) => insertFight(fight, checks[i]!, { battleId, position: positions[i] }));
      saveBattleFormationIds(db, battleId, body, fights, positions, false);
      return { battleId, ids };
    })();
    return { id: saved.battleId, fights: saved.ids.map((id) => loadAttempts({ id })[0]!) };
  });

  /** Rewrites one saved fight from a checked body. Call inside a transaction. */
  function updateFight(id: number, body: any, checked: Exclude<ReturnType<typeof check>, { error: string }>): void {
    db.prepare('UPDATE attempt SET outcome = ?, note = ? WHERE id = ?').run(body.outcome, checked.note, id);
    db.prepare('UPDATE dream_hunt_attempt SET boss_name = ?, map_name = ?, time_seconds = ?, boss_rule = ? WHERE attempt_id = ?').run(
      body.boss,
      body.mapName,
      checked.timeSeconds,
      checked.bossRule,
      id,
    );
    const inBattle = db.prepare('SELECT battle_id IS NOT NULL FROM attempt WHERE id = ?').pluck().get(id) === 1;
    replaceFormation(db, id, body.formation, loadRoster(db), body.mapName, inBattle);
    saveTags(db, id, checked.tags);
  }

  // Edits a whole day: the fights given are the day's fights now. A number already on the day is updated in
  // place, a new number is added, and a number left out is removed. All or nothing.
  serve(app, dreamHuntContract.updateDay, ({ params, body: given }) => {
    const id = Number(params.id);
    if (!db.prepare("SELECT 1 FROM battle WHERE id = ? AND mode = 'Dream Hunt'").get(id)) return fail(404, 'Unknown day');
    const body = given as any;
    const fights = body?.fights;
    if (!Array.isArray(fights) || fights.length === 0 || fights.length > DREAM_HUNT_FIGHTS) return fail(400, `A day of Dream Hunt has 1 to ${DREAM_HUNT_FIGHTS} fights`);
    const positions = fights.map((f, i) => (f?.position === undefined ? i + 1 : f.position));
    if (positions.some((p) => !Number.isInteger(p) || p < 1 || p > DREAM_HUNT_FIGHTS) || new Set(positions).size !== positions.length) {
      return fail(400, `Fight numbers go from 1 to ${DREAM_HUNT_FIGHTS}, each once`);
    }
    const existing = db.prepare('SELECT id, battle_position AS position FROM attempt WHERE battle_id = ?').all(id) as { id: number; position: number | null }[];
    const checks: Exclude<ReturnType<typeof check>, { error: string }>[] = [];
    for (const [i, fight] of fights.entries()) {
      const checked = check(fight, existing.map((e) => e.id), true);
      if ('error' in checked) return fail(checked.status, `Fight ${positions[i]}: ${checked.error}`);
      checks.push(checked);
    }
    const shared = sharedHero(fights.map(teamOf));
    if (shared) return fail(400, `${shared.hero} is in fights ${positions[shared.first]} and ${positions[shared.second]}: a hero plays in one fight only`);
    const codeError = battleFormationIdProblem(db, body, fights, positions, false);
    if (codeError) return fail(400, codeError);
    const saved = db.transaction(() => {
      const kept = new Set<number>();
      const ids = fights.map((fight, i) => {
        const current = existing.find((e) => e.position === positions[i]);
        if (!current) return insertFight(fight, checks[i]!, { battleId: id, position: positions[i] });
        updateFight(current.id, fight, checks[i]!);
        kept.add(current.id);
        return current.id;
      });
      for (const e of existing) if (!kept.has(e.id)) db.prepare('DELETE FROM attempt WHERE id = ?').run(e.id);
      saveBattleFormationIds(db, id, body, fights, positions, false);
      return ids;
    })();
    return { id, fights: saved.map((attemptId) => loadAttempts({ id: attemptId })[0]!) };
  });

  serve(app, dreamHuntContract.update, ({ params, body: given }) => {
    const id = Number(params.id);
    if (loadAttempts({ id }).length === 0) return fail(404, 'Unknown fight');
    const body = given as any;
    const checked = check(body, id, db.prepare('SELECT battle_id IS NOT NULL FROM attempt WHERE id = ?').pluck().get(id) === 1);
    if ('error' in checked) return fail(checked.status, checked.error);
    const conflict = sharedHeroInBattle(db, id, body);
    if (conflict) return fail(400, conflict.replace('teams', 'fights').replace('on one team only', 'in one fight only'));
    db.transaction(() => updateFight(id, body, checked))();
    return loadAttempts({ id })[0]!;
  });

  const loadAttempts = (filters: DreamHuntFilters) => loadDreamHuntAttempts(db, filters);

  serve(app, dreamHuntContract.attempts, (_, c) => {
    const listed = loadAttempts({ boss: listParam(c, 'boss'), rule: c.req.query('rule') || undefined, tag: listParam(c, 'tag'), limit: limitParam(c) });
    return withWholeBattles(db, listed, (id) => loadAttempts({ id })[0]);
  });

  serve(app, dreamHuntContract.attempt, ({ params }) => loadAttempts({ id: Number(params.id) })[0] ?? fail(404, 'Unknown fight'));

  // ---- comparing teams ----------------------------------------------------------------------

  const toRuns = (attempts: DreamHuntAttempt[]): DreamHuntRun[] =>
    attempts.map((a) => ({
      attemptId: a.id,
      heroes: a.formation.heroes.map((h) => h.name),
      artifact: a.formation.artifact,
      outcome: a.outcome,
      timeSeconds: a.timeSeconds,
      mapName: a.mapName,
      layout: layoutFrom({ heroes: a.formation.heroes.map((h) => ({ tile: h.tile, hero: h.name, part: h.part })), phantimal: a.formation.phantimal }),
    }));

  // Times vary from fight to fight, so fights are grouped by composition (same heroes and artifact)
  // and each group reports best, median, mean and worst time plus its clear rate.
  serve(app, dreamHuntContract.leaderboard, (_, c) => {
    const boss = c.req.query('boss');
    if (!boss || !bossExists(boss)) return fail(400, 'Pick a boss');
    const rule = c.req.query('rule');
    const since = c.req.query('since');
    const attempts = loadAttempts({ boss: [boss], rule: rule && rule !== 'any' ? rule : undefined, tag: listParam(c, 'tag'), since: since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : undefined, limit: 100000 });
    const runs = toRuns(attempts);
    const byId = new Map(attempts.map((a) => [a.id, a]));
    return {
      boss,
      rule: rule ?? 'any',
      attempts: attempts.length,
      compositions: summarizeCompositions(runs).map((s) => ({ ...s, latest: byId.get(s.latestAttemptId)!.formation })),
    };
  });

  // The Finder: the compositions that hold every hero asked for, whatever the boss, grouped by boss because times only compare within one.
  serve(app, dreamHuntContract.finder, (_, c) => {
    const heroes = [...new Set(listParam(c, 'hero') ?? [])];
    if (heroes.length === 0) return fail(400, 'Pick at least one hero');
    const rule = c.req.query('rule');
    const attempts = loadAttempts({ rule: rule && rule !== 'any' ? rule : undefined, tag: listParam(c, 'tag'), limit: 100000 }).filter((a) => {
      const placed = new Set(a.formation.heroes.map((h) => h.name));
      return heroes.every((hero) => placed.has(hero));
    });
    const byBoss = new Map<string, DreamHuntAttempt[]>();
    for (const a of attempts) byBoss.set(a.boss, [...(byBoss.get(a.boss) ?? []), a]);
    return {
      heroes,
      rule: rule ?? 'any',
      attempts: attempts.length,
      bosses: [...byBoss.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([boss, fights]) => {
          const byId = new Map(fights.map((a) => [a.id, a]));
          return { boss, attempts: fights.length, compositions: summarizeCompositions(toRuns(fights)).map((s) => ({ ...s, latest: byId.get(s.latestAttemptId)!.formation })) };
        }),
    };
  });

  return app;
}
