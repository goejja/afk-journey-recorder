import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { sharedHero } from '../../domain/arena.js';
import { declareNamedFormationId, formationIdProblem, type PlacedSide } from '../../db/formation-ids.js';
import { hasId } from '../db-helpers.js';
import { battlesContract } from '../../shared/contracts/battles.js';
import { fail, serve } from '../contract.js';

/** A battle whose fights are all gone has nothing left to group. */
export function dropEmptyBattles(db: Database.Database): void {
  db.prepare('DELETE FROM battle WHERE id NOT IN (SELECT battle_id FROM attempt WHERE battle_id IS NOT NULL)').run();
}

/**
 * A list of fights with every fight of the battles it touches. A limit or a filter (boss, mode, tag) can cut a battle,
 * and a battle shown without some of its fights could be edited as a whole by mistake. Newest first, as listed.
 */
export function withWholeBattles<T extends { id: number; battleId: number | null }>(db: Database.Database, listed: T[], load: (id: number) => T | undefined): T[] {
  const battleIds = [...new Set(listed.map((f) => f.battleId).filter((id): id is number => id !== null))];
  if (battleIds.length === 0) return listed;
  const have = new Set(listed.map((f) => f.id));
  const missing = db
    .prepare(`SELECT id FROM attempt WHERE battle_id IN (${battleIds.map(() => '?').join(',')})`)
    .pluck()
    .all(...battleIds) as number[];
  const extra = missing.filter((id) => !have.has(id)).flatMap((id) => load(id) ?? []);
  return extra.length === 0 ? listed : [...listed, ...extra].sort((a, b) => b.id - a.id);
}

/** The items numbered by the positions they hold, null where the battle has no such team. */
const byPosition = <T>(items: T[], positions: number[]): (T | null)[] => {
  const out: (T | undefined)[] = [];
  for (const [i, position] of positions.entries()) out[position - 1] = items[i];
  return Array.from(out, (item) => item ?? null);
};

/** The two sides of a battle body: the Formation ID typed for each and the teams it covers, numbered by position. */
function battleSides(body: any, fights: any[], positions: number[], pvp: boolean) {
  const sides = [{ label: 'Side A', column: 'formation_id', code: body?.formationId as string | null | undefined, teams: byPosition<PlacedSide>(fights.map((f) => f.formation), positions) }];
  if (pvp) sides.push({ label: 'Side B', column: 'opp_formation_id', code: body?.opponentFormationId, teams: byPosition<PlacedSide>(fights.map((f) => f.opponent), positions) });
  return sides.map((s) => ({ ...s, mapNames: fights.map((f) => f.mapName as string | null | undefined) }));
}

/**
 * An error message when a Formation ID a battle body names cannot be used for the teams of its fights (ADR 0007), else
 * null. `pvp` battles have two sides; a Dream Hunt day has one.
 */
export function battleFormationIdProblem(db: Database.Database, body: any, fights: any[], positions: number[], pvp: boolean): string | null {
  for (const side of battleSides(body, fights, positions, pvp)) {
    const problem = formationIdProblem(db, side);
    if (problem) return pvp ? `${side.label}: ${problem}` : problem;
  }
  return null;
}

/** Declares the Formation IDs a battle body names and keeps them on the battle, replacing what it had. Call inside a transaction. */
export function saveBattleFormationIds(db: Database.Database, battleId: number, body: any, fights: any[], positions: number[], pvp: boolean): void {
  for (const side of battleSides(body, fights, positions, pvp)) {
    db.prepare(`UPDATE battle SET ${side.column} = ? WHERE id = ?`).run(declareNamedFormationId(db, side), battleId);
  }
}

/** The Side A heroes of a fight body, for the rule that a hero plays on one team only. */
export const teamOf = (body: any) => ({
  heroes: ((body?.formation?.heroes ?? []) as { hero: string }[]).map((h) => h.hero),
  assist: (body?.formation?.assistHero as string | null | undefined) ?? null,
});

/** An error message when a fight about to be saved on `id` shares a hero with another fight of its battle, else null. */
export function sharedHeroInBattle(db: Database.Database, id: number, body: unknown): string | null {
  const siblings = db
    .prepare(
      `SELECT a.battle_position AS position, f.assist_hero AS assist,
              (SELECT group_concat(fh.hero_name, char(31)) FROM formation_hero fh WHERE fh.formation_id = f.id) AS heroes
       FROM attempt a JOIN formation f ON f.attempt_id = a.id
       WHERE a.battle_id = (SELECT battle_id FROM attempt WHERE id = ?) AND a.id <> ?`,
    )
    .all(id, id) as { position: number; assist: string | null; heroes: string | null }[];
  if (siblings.length === 0) return null;
  const own = db.prepare('SELECT battle_position FROM attempt WHERE id = ?').pluck().get(id) as number | null;
  const shared = sharedHero([...siblings.map((s) => ({ heroes: s.heroes ? s.heroes.split('\u001f') : [], assist: s.assist })), teamOf(body)]);
  return shared && shared.second === siblings.length ? `${shared.hero} is on teams ${siblings[shared.first]!.position} and ${own}: a hero plays on one team only` : null;
}

/** Routes for the battles themselves, whatever their mode. */
export function battleRoutes(db: Database.Database): Hono {
  const app = new Hono();

  // Removes a battle; its fights stay as fights on their own, unless `fights=delete` asks for them to go too.
  serve(app, battlesContract.remove, ({ params }, c) => {
    const id = Number(params.id);
    if (!hasId(db, 'battle', id)) return fail(404, 'Unknown battle');
    db.transaction(() => {
      if (c.req.query('fights') === 'delete') db.prepare('DELETE FROM attempt WHERE battle_id = ?').run(id);
      db.prepare('DELETE FROM battle WHERE id = ?').run(id);
    })();
  });

  return app;
}
