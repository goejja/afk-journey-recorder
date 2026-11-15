import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { validateFormation } from '../../domain/formation.js';
import type { HeroStateRules } from '../../domain/hero-state.js';
import { normalizeTags } from '../../domain/tags.js';
import { allowsPhantimal, isApex, validateStageEnemies, validateStageKey, type StageKind } from '../../domain/stage.js';
import { dropEmptyBattles } from './battles.js';
import { anyOf, limitParam, listParam } from '../params.js';
import { hasAnyTag, loadTags, saveTags } from './tags.js';
import { fightFormationIdProblem, formationContext, formationHeroNames, insertFormation, loadFormation, loadRoster, replaceFormation, validateSnapshots } from './formations.js';
import { heroNameSet, mapCells } from '../db-helpers.js';
import { inTransaction } from '../transaction.js';
import type { Enemy } from '../../shared/contracts/stages.js';
import { stagesContract } from '../../shared/contracts/stages.js';
import { created, fail, serve } from '../contract.js';

interface StageRow {
  id: number;
  season: number;
  phase: number;
  kind: StageKind;
  number: number;
  map_name: string;
}

const OUTCOMES = ['Win', 'Loss'];
/** The most stages one range of auto-battle clears may span. */
const MOST_STAGES_IN_RANGE = 50;
const DEFAULT_ATTEMPT_LIMIT = 200;

/** Routes for stages, their Stage Enemies, attempts and the lists the attempt form needs. */
export function stageRoutes(db: Database.Database, loadRules: () => HeroStateRules): Hono {
  const app = new Hono();

  const findStage = (id: number) => db.prepare('SELECT * FROM stage WHERE id = ?').get(id) as StageRow | undefined;
  const cellsOf = (name: string) => mapCells(db, name);
  const attemptCount = (stageId: number) =>
    db.prepare('SELECT count(*) FROM stage_attempt WHERE stage_id = ?').pluck().get(stageId) as number;
  const stageKey = (row: StageRow) => ({
    id: row.id,
    season: row.season,
    phase: row.phase,
    kind: row.kind,
    number: row.number,
    mapName: row.map_name,
  });
  const stageJson = (row: StageRow) => ({
    ...stageKey(row),
    attemptCount: attemptCount(row.id),
    enemies: db
      .prepare('SELECT enemy_name AS enemy, hero_name AS hero, count FROM stage_enemy WHERE stage_id = ? ORDER BY rowid')
      .all(row.id) as { enemy: string | null; hero: string | null; count: number }[],
  });

  // ---- reference lists for the attempt form -------------------------------------------------

  serve(app, stagesContract.enemies, () =>
    (db
      .prepare(
        `SELECT name, category, class, damage_type AS damageType, image_path AS imagePath,
                (SELECT count(*) FROM stage_enemy WHERE enemy_name = enemy.name) AS uses
         FROM enemy ORDER BY name`,
      )
      .all() as Enemy[]),
  );

  // ---- stages -------------------------------------------------------------------------------

  serve(app, stagesContract.list, (_, c) => {
    const filters: string[] = [];
    const params: unknown[] = [];
    for (const [query, column] of [['season', 'season'], ['phase', 'phase'], ['kind', 'kind'], ['number', 'number']]) {
      const value = c.req.query(query!);
      if (value !== undefined && value !== '') {
        filters.push(`${column} = ?`);
        params.push(query === 'kind' ? value : Number(value));
      }
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM stage ${where} ORDER BY season DESC, kind, phase, number DESC`)
      .all(...params) as StageRow[];
    return rows.map((row) => ({ ...stageKey(row), attemptCount: attemptCount(row.id) }));
  });

  serve(app, stagesContract.get, ({ params }) => {
    const row = findStage(Number(params.id));
    return row ? stageJson(row) : fail(404, 'Unknown stage');
  });

  // Finds the stage with this identity, or creates it on the given map.
  serve(app, stagesContract.findOrCreate, ({ body: given }) => {
    const body = given as any; // the body is whatever was sent, checked below
    const key = { season: body?.season, phase: body?.phase ?? 0, kind: body?.kind, number: body?.number };
    const error = validateStageKey(key);
    if (error) return fail(400, error);

    const existing = db
      .prepare('SELECT * FROM stage WHERE season = ? AND phase = ? AND kind = ? AND number = ?')
      .get(key.season, key.phase, key.kind, key.number) as StageRow | undefined;
    if (existing) return stageJson(existing);

    if (typeof body?.mapName !== 'string' || !cellsOf(body.mapName)) return fail(400, 'Pick a map for the new stage');
    const id = db
      .prepare('INSERT INTO stage (season, phase, kind, number, map_name) VALUES (?, ?, ?, ?, ?)')
      .run(key.season, key.phase, key.kind, key.number, body.mapName).lastInsertRowid;
    return created(stageJson(findStage(Number(id))!));
  });

  // Saves the stage's map and Stage Enemies (replacing the previous ones).
  serve(app, stagesContract.save, ({ params, body: given }) => {
    const stage = findStage(Number(params.id));
    if (!stage) return fail(404, 'Unknown stage');
    const body = given as any;
    const mapName = typeof body?.mapName === 'string' ? body.mapName : stage.map_name;
    const cells = cellsOf(mapName);
    if (!cells) return fail(400, `Unknown map "${mapName}"`);
    if (mapName !== stage.map_name && attemptCount(stage.id) > 0) {
      return fail(409, 'This stage already has attempts, so its map cannot change');
    }
    const known = new Set(db.prepare('SELECT name FROM enemy').pluck().all() as string[]);
    const knownHeroes = heroNameSet(db);
    const error = validateStageEnemies(body?.enemies ?? [], known, knownHeroes);
    if (error) return fail(400, error);

    db.transaction(() => {
      db.prepare('UPDATE stage SET map_name = ? WHERE id = ?').run(mapName, stage.id);
      db.prepare('DELETE FROM stage_enemy WHERE stage_id = ?').run(stage.id);
      const insert = db.prepare('INSERT INTO stage_enemy (stage_id, enemy_name, hero_name, count) VALUES (?, ?, ?, ?)');
      for (const e of body?.enemies ?? []) insert.run(stage.id, e.enemy ?? null, e.hero ?? null, e.count);
    })();
    return stageJson(findStage(stage.id)!);
  });

  // The stages `from` to `to` of one kind were recorded as another kind of the same family (Normal and Phantisomal, or the two
  // Apex kinds): their attempts move with them. A stage that does not exist is skipped. When the right kind already has the
  // stage, the attempts move onto it, which needs the same map and no enemies on the stage that goes away.
  serve(app, stagesContract.changeKind, ({ body: given }) => {
    const body = given as any;
    const key = (kind: unknown, number: unknown) => ({ season: body?.season, phase: body?.phase ?? 0, kind, number });
    const keyError = validateStageKey(key(body?.kind, body?.from)) ?? validateStageKey(key(body?.kind, body?.to)) ?? validateStageKey(key(body?.newKind, body?.from));
    if (keyError) return fail(400, keyError);
    const { kind, newKind, from, to } = body as { kind: StageKind; newKind: StageKind; from: number; to: number };
    if (kind === newKind) return fail(400, 'Pick another kind');
    if (isApex(kind) !== isApex(newKind)) return fail(400, 'A stage can change between Normal and Phantisomal, or between the two Apex kinds, not between those families');
    if (to < from) return fail(400, 'The range must end at or after its first stage');
    if (to - from + 1 > MOST_STAGES_IN_RANGE) return fail(400, `A range spans at most ${MOST_STAGES_IN_RANGE} stages`);

    const done = inTransaction<{ stages: number; attempts: number }, string>(db, (stop) => {
      const result = { stages: 0, attempts: 0 };
      const find = db.prepare('SELECT * FROM stage WHERE season = ? AND phase = ? AND kind = ? AND number = ?');
      for (let number = from; number <= to; number++) {
        const old = find.get(body.season, body.phase ?? 0, kind, number) as StageRow | undefined;
        if (!old) continue;
        const moved = attemptCount(old.id);
        if (!allowsPhantimal(newKind) && moved > 0) {
          const withPhantimal = db
            .prepare('SELECT count(*) FROM stage_attempt sa JOIN formation f ON f.attempt_id = sa.attempt_id WHERE sa.stage_id = ? AND f.phantimal_name IS NOT NULL')
            .pluck()
            .get(old.id) as number;
          if (withPhantimal > 0) stop(`Stage ${number}: an attempt has a phantimal, which a ${newKind} stage does not take`);
        }
        const target = find.get(body.season, body.phase ?? 0, newKind, number) as StageRow | undefined;
        if (!target) {
          db.prepare('UPDATE stage SET kind = ? WHERE id = ?').run(newKind, old.id);
        } else {
          if (target.map_name !== old.map_name) stop(`Stage ${number}: the ${newKind} stage is on map "${target.map_name}", not "${old.map_name}"`);
          if (db.prepare('SELECT count(*) FROM stage_enemy WHERE stage_id = ?').pluck().get(old.id) !== 0) stop(`Stage ${number}: the ${kind} stage has enemies, which would be lost`);
          db.prepare('UPDATE stage_attempt SET stage_id = ? WHERE stage_id = ?').run(target.id, old.id);
          db.prepare('DELETE FROM stage WHERE id = ?').run(old.id);
        }
        result.stages++;
        result.attempts += moved;
      }
      return result;
    });
    return 'problem' in done ? fail(409, done.problem) : done;
  });

  // ---- attempts -----------------------------------------------------------------------------

  /** Checks an attempt body. `editing` is the id of the attempt being replaced, whose heroes stay allowed. */
  function check(body: any, editing?: number): { error: string; status: 400 | 404 } | { stage: StageRow; buffLevel: number | null; note: string | null; tags: string[] | undefined } {
    const stage = findStage(Number(body?.stageId));
    if (!stage) return { error: 'Unknown stage', status: 404 as const };
    if (!OUTCOMES.includes(body?.outcome)) return { error: 'The outcome must be Win or Loss', status: 400 as const };
    const apex = isApex(stage.kind);
    const buffLevel = apex ? (body.buffLevel ?? 0) : null;
    if (apex && (!Number.isInteger(buffLevel) || buffLevel < 0)) {
      return { error: 'The buff level must be a whole number from 0', status: 400 as const };
    }
    const formation = body.formation ?? {};
    const error =
      validateFormation(
        {
          heroes: formation.heroes,
          phantimal: formation.phantimal,
          assistHero: formation.assistHero,
          artifact: formation.artifact,
        },
        formationContext(db, loadRoster(db), {
          cells: cellsOf(stage.map_name)!,
          phantimalAllowed: allowsPhantimal(stage.kind),
          season: stage.season,
          extraHeroes: editing === undefined ? [] : formationHeroNames(db, editing),
        }),
      ) ?? validateSnapshots(formation, loadRules()) ?? fightFormationIdProblem(db, formation, false);
    if (error) return { error, status: 400 as const };
    const tags = normalizeTags(body.tags);
    if ('error' in tags) return { error: tags.error, status: 400 as const };
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
    return { stage, buffLevel: buffLevel as number | null, note, tags: tags.tags };
  }

  /** Inserts one checked attempt. Call inside a transaction. */
  function insertAttempt(body: any, checked: Exclude<ReturnType<typeof check>, { error: string }>): number {
    const attemptId = Number(db.prepare("INSERT INTO attempt (mode, outcome, note) VALUES ('Stage', ?, ?)").run(body.outcome, checked.note).lastInsertRowid);
    db.prepare('INSERT INTO stage_attempt (attempt_id, stage_id, buff_level) VALUES (?, ?, ?)').run(attemptId, checked.stage.id, checked.buffLevel);
    insertFormation(db, attemptId, body.formation, loadRoster(db), checked.stage.map_name);
    saveTags(db, attemptId, checked.tags);
    return attemptId;
  }

  serve(app, stagesContract.createAttempt, ({ body: given }) => {
    const body = given as any;
    const checked = check(body);
    if ('error' in checked) return fail(checked.status, checked.error);
    const id = db.transaction(() => insertAttempt(body, checked))();
    return loadAttempts({ id })[0]!;
  });

  // The same formation cleared the stages `from` to `to` in auto-battle: one attempt per stage, saved together or not at all.
  // Every stage is a win, except the last when `lastLost`. A stage that is not stored yet is created on `mapName` with no
  // enemies; one that is keeps its own map and enemies, and the formation must fit that map.
  serve(app, stagesContract.createRange, ({ body: given }) => {
    const body = given as any;
    const key = (number: unknown) => ({ season: body?.season, phase: body?.phase ?? 0, kind: body?.kind, number });
    const keyError = validateStageKey(key(body?.from)) ?? validateStageKey(key(body?.to));
    if (keyError) return fail(400, keyError);
    const { from, to } = body as { from: number; to: number };
    if (to < from) return fail(400, 'The range must end at or after its first stage');
    if (to - from + 1 > MOST_STAGES_IN_RANGE) return fail(400, `A range spans at most ${MOST_STAGES_IN_RANGE} stages`);
    if (typeof body.mapName !== 'string' || !cellsOf(body.mapName)) return fail(400, 'Pick a map for the stages that are new');

    const done = inTransaction<number[], { message: string; status: 400 | 404 }>(db, (stop) => {
      const saved: number[] = [];
      for (let number = from; number <= to; number++) {
        const k = key(number);
        const existing = db.prepare('SELECT * FROM stage WHERE season = ? AND phase = ? AND kind = ? AND number = ?').get(k.season, k.phase, k.kind, number) as StageRow | undefined;
        const stageId = existing?.id ?? Number(db.prepare('INSERT INTO stage (season, phase, kind, number, map_name) VALUES (?, ?, ?, ?, ?)').run(k.season, k.phase, k.kind, number, body.mapName).lastInsertRowid);
        const attempt = { stageId, outcome: body.lastLost && number === to ? 'Loss' : 'Win', buffLevel: body.buffLevel, note: body.note, tags: body.tags, formation: body.formation };
        const checked = check(attempt);
        if ('error' in checked) return stop({ message: `Stage ${number}: ${checked.error}`, status: checked.status === 404 ? 404 : 400 }); // rolls back, stages created included
        saved.push(insertAttempt(attempt, checked));
      }
      return saved;
    });
    if ('problem' in done) return fail(done.problem.status, done.problem.message);
    return { attempts: done.map((id) => loadAttempts({ id })[0]!) };
  });

  serve(app, stagesContract.updateAttempt, ({ params, body: given }) => {
    const id = Number(params.id);
    if (loadAttempts({ id }).length === 0) return fail(404, 'Unknown attempt');
    const body = given as any;
    const checked = check(body, id);
    if ('error' in checked) return fail(checked.status, checked.error);
    db.transaction(() => {
      db.prepare('UPDATE attempt SET outcome = ?, note = ? WHERE id = ?').run(body.outcome, checked.note, id);
      db.prepare('UPDATE stage_attempt SET stage_id = ?, buff_level = ? WHERE attempt_id = ?').run(checked.stage.id, checked.buffLevel, id);
      replaceFormation(db, id, body.formation, loadRoster(db), checked.stage.map_name);
      saveTags(db, id, checked.tags);
    })();
    return loadAttempts({ id })[0]!;
  });

  interface AttemptFilters {
    id?: number;
    stageId?: number;
    season?: number;
    phase?: number;
    kind?: string[];
    outcome?: string[];
    tag?: string[];
    limit?: number;
  }

  function loadAttempts(filters: AttemptFilters) {
    const where: string[] = ["a.mode = 'Stage'"];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      if (value !== undefined && !Number.isNaN(value)) {
        where.push(clause);
        params.push(value);
      }
    };
    add('a.id = ?', filters.id);
    add('s.id = ?', filters.stageId);
    add('s.season = ?', filters.season);
    add('s.phase = ?', filters.phase);
    for (const [column, values] of [['s.kind', filters.kind], ['a.outcome', filters.outcome]] as const) {
      if (!values) continue;
      const chosen = anyOf(column, values);
      where.push(chosen.clause), params.push(...chosen.params);
    }
    if (filters.tag) {
      const tags = hasAnyTag(filters.tag);
      where.push(tags.clause), params.push(...tags.params);
    }

    const rows = db
      .prepare(
        `SELECT a.id, a.outcome, a.note, a.created_at AS createdAt, sa.buff_level AS buffLevel,
                s.id AS stageId, s.season, s.phase, s.kind, s.number, s.map_name AS mapName
         FROM attempt a
         JOIN stage_attempt sa ON sa.attempt_id = a.id
         JOIN stage s ON s.id = sa.stage_id
         WHERE ${where.join(' AND ')}
         ORDER BY a.id DESC LIMIT ?`,
      )
      .all(...params, filters.limit ?? DEFAULT_ATTEMPT_LIMIT) as any[];

    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      outcome: r.outcome,
      note: r.note,
      buffLevel: r.buffLevel,
      stage: { id: r.stageId, season: r.season, phase: r.phase, kind: r.kind, number: r.number, mapName: r.mapName },
      formation: loadFormation(db, r.id),
      tags: loadTags(db, r.id),
    }));
  }

  serve(app, stagesContract.attempts, (_, c) => {
    const num = (key: string) => (c.req.query(key) ? Number(c.req.query(key)) : undefined);
    return (
      loadAttempts({
        stageId: num('stageId'),
        season: num('season'),
        phase: num('phase'),
        kind: listParam(c, 'kind'),
        outcome: listParam(c, 'outcome'),
        tag: listParam(c, 'tag'),
        limit: limitParam(c),
      })
    );
  });

  serve(app, stagesContract.removeAttempt, ({ params }) => {
    db.transaction(() => {
      db.prepare('DELETE FROM attempt WHERE id = ?').run(Number(params.id));
      dropEmptyBattles(db);
    })();
  });

  return app;
}
