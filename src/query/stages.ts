import type Database from 'better-sqlite3';
import { summarizeCompositions, type DreamHuntRun } from '../domain/dream-hunt.js';
import { listOf, MAX_ROWS, placeholders, seasonsOf, type StatFilters } from './filters.js';

/** Every past attempt on one stage, newest first, with the formations used. */
export function stageHistory(db: Database.Database, key: { season: number; kind: string; number: number; phase?: number }) {
  const stage = db
    .prepare('SELECT id, map_name AS map FROM stage WHERE season = ? AND kind = ? AND number = ? AND phase = ?')
    .get(key.season, key.kind, key.number, key.phase ?? 0) as { id: number; map: string } | undefined;
  if (!stage) return { stage: null, enemies: [], attempts: [] };
  const enemies = db.prepare('SELECT enemy_name AS enemy, hero_name AS hero, count FROM stage_enemy WHERE stage_id = ? ORDER BY rowid').all(stage.id);
  const heroesOf = db.prepare(
    `SELECT fh.hero_name AS name, max(fh.rank) AS rank, max(fh.equipment_level) AS equipment FROM formation f JOIN formation_hero fh ON fh.formation_id = f.id
     WHERE f.attempt_id = ? GROUP BY fh.hero_name ORDER BY min(fh.tile)`,
  );
  const artifactOf = db.prepare('SELECT artifact FROM formation WHERE attempt_id = ?');
  const attempts = (
    db
      .prepare(
        `SELECT a.id, a.outcome, a.note, a.created_at AS at, sa.buff_level AS buffLevel FROM attempt a
         JOIN stage_attempt sa ON sa.attempt_id = a.id WHERE sa.stage_id = ? ORDER BY a.id DESC LIMIT ${MAX_ROWS}`,
      )
      .all(stage.id) as { id: number }[]
  ).map((a) => ({ ...a, heroes: heroesOf.all(a.id), artifact: artifactOf.get(a.id) }));
  return { stage: { ...key, ...stage }, enemies, attempts };
}

/** Compositions for one Dream Hunt boss with clear rate and best/median/worst times. */
export function dreamHuntBest(db: Database.Database, boss: string, filters: { rule?: string; tag?: string } = {}) {
  const params: unknown[] = [boss];
  const clauses = ['d.boss_name = ?'];
  if (filters.rule === 'none') clauses.push('d.boss_rule IS NULL');
  else if (filters.rule && filters.rule !== 'any') (clauses.push('d.boss_rule = ?'), params.push(filters.rule));
  if (filters.tag) (clauses.push('a.id IN (SELECT attempt_id FROM attempt_tag WHERE tag = ?)'), params.push(filters.tag));
  const fights = db
    .prepare(
      `SELECT a.id, a.outcome, d.time_seconds AS timeSeconds, f.artifact FROM attempt a
       JOIN dream_hunt_attempt d ON d.attempt_id = a.id JOIN formation f ON f.attempt_id = a.id WHERE ${clauses.join(' AND ')}`,
    )
    .all(...params) as { id: number; outcome: 'Win' | 'Loss'; timeSeconds: number | null; artifact: string | null }[];
  const heroesOf = db.prepare('SELECT DISTINCT fh.hero_name FROM formation f JOIN formation_hero fh ON fh.formation_id = f.id WHERE f.attempt_id = ?').pluck();
  const runs: DreamHuntRun[] = fights.map((x) => ({
    attemptId: x.id, heroes: heroesOf.all(x.id) as string[], artifact: x.artifact, outcome: x.outcome, timeSeconds: x.timeSeconds,
  }));
  return { boss, fights: runs.length, compositions: summarizeCompositions(runs) };
}

/** Win rate on each stage that has attempts, newest season and highest stage first. */
export function stageStats(db: Database.Database, filters: { kind?: string | string[]; season?: number; playedIn?: StatFilters['playedIn']; tag?: string | string[]; minGames?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  const kinds = listOf(filters.kind);
  if (kinds.length) (where.push(`s.kind IN (${placeholders(kinds)})`), params.push(...kinds));
  if (filters.season !== undefined) (where.push('s.season = ?'), params.push(filters.season));
  const seasons = seasonsOf(filters.playedIn);
  if (seasons.length) (where.push(`a.season IN (${placeholders(seasons.map(String))})`), params.push(...seasons));
  const tags = listOf(filters.tag);
  if (tags.length) (where.push(`a.id IN (SELECT attempt_id FROM attempt_tag WHERE tag IN (${placeholders(tags)}))`), params.push(...tags));
  return db
    .prepare(
      `SELECT s.season, s.phase, s.kind, s.number, count(*) AS games, sum(a.outcome = 'Win') AS wins,
              round(1.0 * sum(a.outcome = 'Win') / count(*), 3) AS winRate, max(a.created_at) AS last
       FROM stage_attempt sa JOIN attempt a ON a.id = sa.attempt_id JOIN stage s ON s.id = sa.stage_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY s.id HAVING count(*) >= ? ORDER BY s.season DESC, s.phase DESC, s.number DESC LIMIT ${MAX_ROWS}`,
    )
    .all(...params, filters.minGames ?? 1);
}
