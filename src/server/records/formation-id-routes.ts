import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { addFormationId, deleteFormationId, findFormationIds, listFormationIds } from '../../db/formation-ids.js';
import { deploymentFrom, deploymentProblem, isFormationId, layoutFrom, normalizeFormationId, phantimalOf, type Deployment, type LayoutUnit, type PlacedFormation } from '../../domain/layout.js';
import { checkFactionRequirement } from '../../domain/units.js';
import { formationIdsContract } from '../../shared/contracts/formation-ids.js';
import { fail, serve } from '../contract.js';

const CODE_MESSAGE = 'A Formation ID is 8 characters: digits or capital letters';

/** The library: list it, find the codes of some placed teams, add a code by hand, delete one. */
export function formationIdRoutes(db: Database.Database): Hono {
  const app = new Hono();
  serve(app, formationIdsContract.list, () => listFormationIds(db));
  // The body never fails: what is not a list of teams looks up nothing.
  serve(app, formationIdsContract.find, ({ body }) => findFormationIds(db, deploymentFrom(body.teams?.map((t) => (t as object | null) ?? null) ?? [])));
  serve(app, formationIdsContract.create, ({ body }) => {
    const code = normalizeFormationId(body.code ?? '');
    const teams = body.deployment?.teams as unknown;
    if (!isFormationId(code)) return fail(400, CODE_MESSAGE);
    if (!Array.isArray(teams) || teams.length === 0 || teams.length > 5 || teams.some((t) => t !== null && !Array.isArray((t as { units?: unknown })?.units))) return fail(400, 'Place at least one unit');
    // A team is a list of Units; a Phantimal still sent in its own field is folded in as one, as Layout keeps it (ADR 0028).
    const teamOf = (t: { units?: unknown; phantimal?: PlacedFormation['phantimal']; artifact?: unknown } | null) => {
      if (t === null) return null;
      const units = t.units as LayoutUnit[];
      return { units: t.phantimal ? [...units, ...layoutFrom({ phantimal: t.phantimal }).units] : units, artifact: typeof t.artifact === 'string' && t.artifact !== '' ? t.artifact : null };
    };
    const stored: Deployment = { teams: (teams as Parameters<typeof teamOf>[0][]).map(teamOf) };
    const problem = deploymentProblem(stored);
    if (problem) return fail(400, problem);
    // A code stands for a deployment the game can actually field, so its Phantimal must meet its Faction Requirement too.
    const heroFactions = new Map((db.prepare('SELECT name, faction FROM hero').all() as { name: string; faction: string | null }[]).map((r) => [r.name, r.faction]));
    const phantimalFactions = new Map((db.prepare('SELECT name, faction FROM phantimal').all() as { name: string; faction: string | null }[]).map((r) => [r.name, r.faction]));
    for (const [k, team] of stored.teams.entries()) {
      const phantimal = team ? phantimalOf(team) : null;
      if (!team || !phantimal) continue;
      const factionProblem = checkFactionRequirement(team.units.filter((u) => u.kind === 'hero'), phantimal.name, phantimalFactions.get(phantimal.name), heroFactions);
      if (factionProblem) return fail(400, stored.teams.length > 1 ? `Team ${k + 1}: ${factionProblem}` : factionProblem);
    }
    if (db.prepare('SELECT 1 FROM formation_id WHERE code = ?').get(code)) return fail(409, `${code} is already stored`);
    addFormationId(db, code, stored);
    return listFormationIds(db).find((e) => e.code === code)!;
  });
  serve(app, formationIdsContract.remove, ({ params }) => (deleteFormationId(db, params.code) === 0 ? fail(404, 'Unknown Formation ID') : undefined));
  return app;
}
