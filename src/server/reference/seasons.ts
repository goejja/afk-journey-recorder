import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { seasonsContract } from '../../shared/contracts/seasons.js';
import { fail, serve } from '../contract.js';

/**
 * Routes for the list of seasons and the current one, edited in Admin > General. A season that stages or
 * phantimals already name is always listed, even when nobody added it (an import may have).
 */
export function seasonRoutes(db: Database.Database): Hono {
  const app = new Hono();

  const list = () =>
    (
      db
        .prepare(
          `SELECT n.number, COALESCE(s.is_current, 0) AS current,
                  (SELECT count(*) FROM stage WHERE season = n.number) AS stages,
                  (SELECT count(*) FROM phantimal_season WHERE season = n.number) AS phantimals
           FROM (SELECT number FROM season UNION SELECT season FROM stage UNION SELECT season FROM phantimal_season) n
           LEFT JOIN season s ON s.number = n.number ORDER BY n.number DESC`,
        )
        .all() as { number: number; current: number; stages: number; phantimals: number }[]
    ).map((s) => ({ number: s.number, current: s.current === 1, stages: s.stages, phantimals: s.phantimals }));

  serve(app, seasonsContract.list, () => list());

  serve(app, seasonsContract.add, ({ body }) => {
    if (list().some((s) => s.number === body.number)) return fail(409, `Season ${body.number} is already in the list`);
    db.prepare('INSERT INTO season (number) VALUES (?)').run(body.number);
    return list();
  });

  serve(app, seasonsContract.setCurrent, ({ body }) => {
    if (!list().some((s) => s.number === body.number)) return fail(404, 'Unknown season');
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO season (number) VALUES (?)').run(body.number);
      db.prepare('UPDATE season SET is_current = 0 WHERE is_current = 1').run();
      db.prepare('UPDATE season SET is_current = 1 WHERE number = ?').run(body.number);
    })();
    return list();
  });

  // A season in use by stages or phantimals, or the current one, cannot be removed.
  serve(app, seasonsContract.remove, ({ params }) => {
    const found = list().find((s) => s.number === Number(params.number));
    if (!found) return fail(404, 'Unknown season');
    if (found.current) return fail(409, 'Make another season the current one first');
    if (found.stages + found.phantimals > 0) return fail(409, `Season ${found.number} is used by ${found.stages} stages and ${found.phantimals} phantimals`);
    db.prepare('DELETE FROM season WHERE number = ?').run(found.number);
    return list();
  });

  return app;
}
