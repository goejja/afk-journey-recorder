import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { phantimalsContract, type Phantimal } from '../../shared/contracts/phantimals.js';
import { loadUnitRules } from '../../db/unit-rules.js';
import { fail, serve } from '../contract.js';
import { deploymentsNaming, takenNames, unitNameProblem } from './unit-names.js';

interface PhantimalRow {
  name: string;
  faction: string | null;
  class: string | null;
  source: 'import' | 'manual';
}

/** Routes for Admin > Units > Phantimals: list, create, edit (season tags and the second part) and delete. */
export function phantimalRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const find = (name: string) => db.prepare('SELECT * FROM phantimal WHERE name = ?').get(name) as PhantimalRow | undefined;
  const seasonsOf = (name: string) =>
    db.prepare('SELECT season FROM phantimal_season WHERE phantimal_name = ? ORDER BY season').pluck().all(name) as number[];
  const partOf = (name: string) => (db.prepare('SELECT part FROM phantimal_part WHERE phantimal = ?').pluck().get(name) as string | undefined) ?? null;
  const toJson = (row: PhantimalRow): Phantimal => ({
    name: row.name,
    part: partOf(row.name),
    faction: row.faction,
    class: row.class,
    seasons: seasonsOf(row.name),
    source: row.source,
  });

  function writeSeasons(name: string, seasons: number[]) {
    db.prepare('DELETE FROM phantimal_season WHERE phantimal_name = ?').run(name);
    const insert = db.prepare('INSERT OR IGNORE INTO phantimal_season (phantimal_name, season) VALUES (?, ?)');
    for (const season of seasons) insert.run(name, season);
  }

  /** What puts a phantimal on a team, which fixes how it stands: saved records, Formation IDs and Round Deployments naming it or its part. */
  function usage(name: string) {
    const part = partOf(name);
    const records = (db.prepare('SELECT (SELECT count(*) FROM formation WHERE phantimal_name = ?) + (SELECT count(*) FROM arena_attempt WHERE opp_phantimal = ?)').pluck().get(name, name) as number);
    const deployments = deploymentsNaming(db, 'hero', name) + (part ? deploymentsNaming(db, 'part', part) : 0);
    return { records, deployments, placements: records + deployments };
  }

  serve(app, phantimalsContract.usage, ({ params }) => (find(params.name) ? usage(params.name) : fail(404, 'Unknown phantimal')));

  serve(app, phantimalsContract.list, () => (db.prepare('SELECT * FROM phantimal ORDER BY name').all() as PhantimalRow[]).map(toJson));

  serve(app, phantimalsContract.create, ({ body: input }) => {
    const name = input.name;
    if (find(name)) return fail(409, `A phantimal named "${name}" already exists`);
    const taken = takenNames(db);
    if (taken.parts.has(name.toLowerCase())) return fail(409, `"${name}" is already the name of another unit`);
    const problem = input.part ? unitNameProblem({ ...taken, phantimals: new Set([...taken.phantimals, name.toLowerCase()]) }, input.part) : null;
    if (problem) return fail(409, problem);
    db.transaction(() => {
      db.prepare("INSERT INTO phantimal (name, faction, class, source) VALUES (?, ?, ?, 'manual')").run(name, input.faction, input.class);
      writeSeasons(name, input.seasons);
      if (input.part) db.prepare('INSERT INTO phantimal_part (phantimal, part) VALUES (?, ?)').run(name, input.part);
    })();
    loadUnitRules(db);
    return toJson(find(name)!);
  });

  serve(app, phantimalsContract.save, ({ params, body: input }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown phantimal');
    const name = input.name;
    if (name !== current.name && find(name)) return fail(409, `A phantimal named "${name}" already exists`);
    const seasons = [...new Set(input.seasons)].sort((a, b) => a - b);
    const part = input.part === undefined ? partOf(current.name) : input.part;
    const partChanged = part !== partOf(current.name);
    if (name !== current.name && takenNames(db).parts.has(name.toLowerCase())) return fail(409, `"${name}" is already the name of another unit`);
    if (partChanged) {
      const u = usage(current.name);
      if (u.placements > 0) return fail(409, `${current.name} is placed in ${u.records} records and ${u.deployments} Formation IDs and Round Deployments, so its second part cannot change`);
      const problem = part ? unitNameProblem(takenNames(db, { phantimal: current.name }), part) : null;
      if (problem) return fail(409, problem);
    }
    const unchanged =
      !partChanged &&
      name === current.name &&
      input.faction === current.faction &&
      input.class === current.class &&
      seasons.join() === seasonsOf(current.name).join();
    if (unchanged) return toJson(current);
    // Any edit makes it the player's own, so a re-import never overwrites it.
    db.transaction(() => {
      db.prepare("UPDATE phantimal SET name = ?, faction = ?, class = ?, source = 'manual' WHERE name = ?").run(
        name,
        input.faction,
        input.class,
        current.name,
      );
      writeSeasons(name, seasons);
      db.prepare('DELETE FROM phantimal_part WHERE phantimal = ?').run(current.name);
      if (part) db.prepare('INSERT INTO phantimal_part (phantimal, part) VALUES (?, ?)').run(name, part);
    })();
    loadUnitRules(db);
    return toJson(find(name)!);
  });

  serve(app, phantimalsContract.remove, ({ params }) => {
    db.transaction(() => {
      db.prepare('DELETE FROM phantimal WHERE name = ?').run(params.name);
      db.prepare('DELETE FROM phantimal_part WHERE phantimal = ?').run(params.name);
    })();
    loadUnitRules(db);
  });

  return app;
}
