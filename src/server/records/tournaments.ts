import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ROUNDS, type Round } from '../../domain/tournament.js';
import { tournamentsContract, type Tournament } from '../../shared/contracts/tournaments.js';
import { fail, serve } from '../contract.js';

/** Routes for the Tournaments of Super League (ADR 0020): the latest first, which is where a new import starts. */
export function tournamentRoutes(db: Database.Database): Hono {
  const app = new Hono();

  const list = (): Tournament[] => {
    const rows = db
      .prepare(
        `SELECT t.id, t.season, t.number, t.start_date AS startDate, (SELECT count(*) FROM battle WHERE tournament_id = t.id) AS battles
         FROM tournament t ORDER BY t.season DESC, t.number DESC`,
      )
      .all() as Omit<Tournament, 'rounds'>[];
    const used = db.prepare('SELECT DISTINCT round FROM battle WHERE tournament_id = ? AND round IS NOT NULL').pluck();
    return rows.map((r) => {
      const rounds = used.all(r.id) as Round[];
      return { ...r, rounds: ROUNDS.filter((round) => rounds.includes(round)) };
    });
  };

  serve(app, tournamentsContract.list, list);

  serve(app, tournamentsContract.create, ({ body }) => {
    if (db.prepare('SELECT 1 FROM tournament WHERE season = ? AND number = ?').get(body.season, body.number)) {
      return fail(409, `Season ${body.season} already has a Tournament ${body.number}`);
    }
    db.prepare('INSERT INTO tournament (season, number, start_date) VALUES (?, ?, ?)').run(body.season, body.number, body.startDate);
    return list();
  });

  return app;
}
