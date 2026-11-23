import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bossesContract, type Boss } from '../../shared/contracts/bosses.js';
import { fail, serve } from '../contract.js';
import { describeUsage, refuseUsed, type Usage } from './usage.js';

interface BossRow {
  name: string;
  class: string | null;
  damageType: string | null;
  source: 'import' | 'manual';
  handMadeFlag: 0 | 1;
  attempts: number;
}

/** Routes for Admin > Units > Bosses: list, add, edit (class and damage type) and delete. A boss keeps its name, as a hero does. */
export function bossRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const count = (sql: string, name: string) => db.prepare(sql).pluck().get(name) as number;
  const usageOf = (name: string): Usage[] => [
    { label: 'Dream Hunt records', one: 'Dream Hunt record', count: count('SELECT count(*) FROM dream_hunt_attempt WHERE boss_name = ?', name) },
    { label: 'Titan Reaver fights', one: 'Titan Reaver fight', count: count('SELECT count(*) FROM titan_reaver_fight WHERE boss_name = ?', name) },
    { label: 'Weekly default slots', one: 'Weekly default slot', count: count('SELECT count(*) FROM weekly_default WHERE boss = ?', name) },
    { label: 'Titan Reaver setup slots', one: 'Titan Reaver setup slot', count: count('SELECT count(*) FROM titan_reaver_default WHERE boss = ?', name) },
  ];
  const SELECT = `SELECT b.name, b.class, b.damage_type AS damageType, b.source, b.hand_made AS handMadeFlag,
                         (SELECT count(*) FROM dream_hunt_attempt d WHERE d.boss_name = b.name) AS attempts
                  FROM boss b`;
  const toJson = (row: BossRow): Boss => {
    const usage = usageOf(row.name);
    const { handMadeFlag, ...rest } = row;
    return { ...rest, handMade: handMadeFlag === 1, usedBy: describeUsage(usage), uses: usage.reduce((sum, u) => sum + u.count, 0) };
  };
  const find = (name: string) => db.prepare(`${SELECT} WHERE b.name = ?`).get(name) as BossRow | undefined;

  serve(app, bossesContract.list, () => (db.prepare(`${SELECT} ORDER BY b.name`).all() as BossRow[]).map(toJson));

  serve(app, bossesContract.create, ({ body }) => {
    if (db.prepare('SELECT 1 FROM boss WHERE lower(name) = lower(?)').get(body.name)) return fail(409, `A boss named "${body.name}" already exists`);
    db.prepare("INSERT INTO boss (name, class, damage_type, image_path, source, hand_made) VALUES (?, ?, ?, NULL, 'manual', 1)").run(body.name, body.class, body.damageType);
    return toJson(find(body.name)!);
  });

  serve(app, bossesContract.save, ({ params, body }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown boss');
    // a boss is never renamed: its picture, the import and the records name it
    if (body.class === current.class && body.damageType === current.damageType) return toJson(current);
    // any edit makes it the player's own, so a re-import never overwrites it
    db.prepare("UPDATE boss SET class = ?, damage_type = ?, source = 'manual' WHERE name = ?").run(body.class, body.damageType, current.name);
    return toJson(find(current.name)!);
  });

  serve(app, bossesContract.remove, ({ params }) => {
    if (!find(params.name)) return fail(404, 'Unknown boss');
    const refused = refuseUsed(params.name, usageOf(params.name));
    if (refused) return refused;
    db.prepare('DELETE FROM boss WHERE name = ?').run(params.name);
  });

  return app;
}
