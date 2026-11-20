import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { isRound } from '../../domain/tournament.js';
import { roundDeploymentProblem, TEAMS_IN_ROUND, type RoundDeployment, type RoundTeam } from '../../domain/round-deployment.js';
import { roundDeploymentsContract } from '../../shared/contracts/round-deployments.js';
import { hasId, hasName } from '../db-helpers.js';
import { fail, serve } from '../contract.js';

/** Routes for the Round Deployments (ADR 0020): what each Profile fields in one Round of a Tournament. */
export function roundDeploymentRoutes(db: Database.Database): Hono {
  const app = new Hono();

  /** The Tournament and Round of the URL, or an error. */
  function scope(params: { tournament: string; round: string }): { tournament: number; round: string } | { error: string; status: 400 | 404 } {
    const tournament = Number(params.tournament);
    const round = params.round;
    if (!isRound(round)) return { error: 'Unknown Round', status: 400 };
    if (!hasId(db, 'tournament', tournament)) return { error: 'Unknown Tournament', status: 404 };
    return { tournament, round };
  }

  const load = (tournament: number, round: string, profileId: number): RoundDeployment => {
    const teams: RoundDeployment = Array(TEAMS_IN_ROUND).fill(null);
    const rows = db
      .prepare('SELECT team, content FROM round_deployment WHERE tournament_id = ? AND round = ? AND profile_id = ?')
      .all(tournament, round, profileId) as { team: number; content: string }[];
    for (const row of rows) teams[row.team - 1] = JSON.parse(row.content) as RoundTeam;
    return teams;
  };

  /** The reason a list of teams cannot be stored, or null. */
  const checkTeams = (given: unknown): string | null => {
    if (!Array.isArray(given)) return `The teams must be a list of ${TEAMS_IN_ROUND} teams`;
    const teams = given as RoundDeployment;
    const malformed = teams.some((t) => t !== null && (typeof t !== 'object' || !Array.isArray(t.heroes) || t.heroes.some((h) => h === null || typeof h !== 'object') || (t.seenAs !== undefined && !Array.isArray(t.seenAs))));
    if (malformed) return 'Each team is null or has a list of heroes';
    return roundDeploymentProblem(teams, {
      heroFactions: new Map((db.prepare('SELECT name, faction FROM hero').all() as { name: string; faction: string | null }[]).map((r) => [r.name, r.faction])),
      phantimalFactions: new Map((db.prepare('SELECT name, faction FROM phantimal').all() as { name: string; faction: string | null }[]).map((r) => [r.name, r.faction])),
    }) ?? unknownName(teams);
  };

  /** Replaces the teams of one Profile in the Round: what was given are its teams now. */
  const write = (tournament: number, round: string, profileId: number, teams: RoundDeployment): void => {
    db.prepare('DELETE FROM round_deployment WHERE tournament_id = ? AND round = ? AND profile_id = ?').run(tournament, round, profileId);
    const insert = db.prepare('INSERT INTO round_deployment (tournament_id, round, profile_id, team, content) VALUES (?, ?, ?, ?, ?)');
    for (const [index, team] of teams.entries()) if (team && (team.heroes.length > 0 || team.phantimal)) insert.run(tournament, round, profileId, index + 1, JSON.stringify(team));
  };

  serve(app, roundDeploymentsContract.list, ({ params }) => {
    const found = scope(params);
    if ('error' in found) return fail(found.status, found.error);
    const profiles = db
      .prepare(
        `SELECT DISTINCT p.id, p.name, p.player_id AS playerId FROM round_deployment d JOIN profile p ON p.id = d.profile_id
         WHERE d.tournament_id = ? AND d.round = ? ORDER BY p.name COLLATE NOCASE`,
      )
      .all(found.tournament, found.round) as { id: number; name: string; playerId: string | null }[];
    return profiles.map((p) => ({ profileId: p.id, name: p.name, playerId: p.playerId, teams: load(found.tournament, found.round, p.id) }));
  });

  serve(app, roundDeploymentsContract.save, ({ params, body }) => {
    const found = scope(params);
    if ('error' in found) return fail(found.status, found.error);
    const profileId = Number(params.profile);
    if (!hasId(db, 'profile', profileId)) return fail(404, 'Unknown Profile');
    const problem = checkTeams(body.teams);
    if (problem) return fail(400, problem);
    write(found.tournament, found.round, profileId, body.teams as RoundDeployment); // checked just above
    return { profileId, teams: load(found.tournament, found.round, profileId) };
  });

  serve(app, roundDeploymentsContract.saveAll, ({ params, body }) => {
    const found = scope(params);
    if ('error' in found) return fail(found.status, found.error);
    const entries = body.entries; // each entry is checked below
    const seen = new Set<number>();
    for (const entry of entries) {
      if (!Number.isInteger(entry?.profileId) || !hasId(db, 'profile', entry.profileId)) return fail(404, 'Unknown Profile');
      if (seen.has(entry.profileId)) return fail(400, 'A Profile can be confirmed only once per request');
      seen.add(entry.profileId);
      const problem = checkTeams(entry.teams);
      if (problem) return fail(400, problem);
    }
    db.transaction(() => {
      for (const entry of entries) write(found.tournament, found.round, entry.profileId, entry.teams);
    })();
    return { entries: entries.map((entry) => ({ profileId: entry.profileId, teams: load(found.tournament, found.round, entry.profileId) })) };
  });

  serve(app, roundDeploymentsContract.remove, ({ params }) => {
    const found = scope(params);
    if ('error' in found) return fail(found.status, found.error);
    db.prepare('DELETE FROM round_deployment WHERE tournament_id = ? AND round = ? AND profile_id = ?').run(found.tournament, found.round, Number(params.profile));
  });

  serve(app, roundDeploymentsContract.move, ({ params, body }) => {
    const found = scope(params);
    if ('error' in found) return fail(found.status, found.error);
    const from = Number(params.profile);
    const to = Number(body.to);
    if (!hasId(db, 'profile', from)) return fail(404, 'Unknown Profile');
    if (!Number.isInteger(to) || !hasId(db, 'profile', to)) return fail(404, 'Unknown Profile to move to');
    if (from === to) return fail(400, 'Choose another Profile to move the Deployment to');
    db.transaction(() => {
      // the target's Deployments are replaced: a move is a repair, and the source is the one believed
      db.prepare('DELETE FROM round_deployment WHERE tournament_id = ? AND round = ? AND profile_id = ?').run(found.tournament, found.round, to);
      db.prepare('UPDATE round_deployment SET profile_id = ? WHERE tournament_id = ? AND round = ? AND profile_id = ?').run(to, found.tournament, found.round, from);
    })();
    return { profileId: to, teams: load(found.tournament, found.round, to) };
  });

  /** The first hero, artifact or phantimal in the teams that the library does not know, as a message. */
  function unknownName(teams: RoundDeployment): string | null {
    for (const [index, team] of teams.entries()) {
      if (!team) continue;
      const label = `Team ${index + 1}`;
      for (const h of team.heroes) {
        if (typeof h.hero !== 'string' || !hasName(db, 'hero', h.hero)) return `${label}: unknown hero ${String(h.hero)}`;
        if (h.rank !== null && typeof h.rank !== 'string') return `${label}: the rank of ${h.hero} must be text`;
        if (h.equipmentLevel !== null && (!Number.isInteger(h.equipmentLevel) || h.equipmentLevel < 0)) return `${label}: the equipment level of ${h.hero} must be a whole number from 0`;
      }
      if (team.artifact !== null && !hasName(db, 'artifact', team.artifact)) return `${label}: unknown artifact ${team.artifact}`;
      if (team.phantimal && !hasName(db, 'phantimal', team.phantimal.name)) return `${label}: unknown phantimal ${team.phantimal.name}`;
    }
    return null;
  }

  return app;
}
