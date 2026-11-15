import type { Scenario, ScenarioHero, ScenarioInput } from '../shared/api.js';
import { defaultProfileId } from '../db/profiles.js';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import type { HeroStateRules } from '../domain/hero-state.js';
import { isSummon, partOf } from '../domain/units.js';
import { validateScenario, type ScenarioBody, type ScenarioContext } from '../domain/scenario.js';
import { heroNameSet } from './db-helpers.js';
import { scenariosContract } from '../shared/contracts/scenarios.js';
import { fail, serve } from './contract.js';

/** Routes for planning scenarios the formation-suggestion agent can read and answer. */
export function scenarioRoutes(db: Database.Database, loadRules: () => HeroStateRules): Hono {
  const app = new Hono();

  function context(): ScenarioContext {
    const maps = new Map<string, { tags: string[]; cells: number[] }>();
    for (const m of db.prepare('SELECT name, tags, cells FROM map').all() as { name: string; tags: string; cells: string }[]) {
      maps.set(m.name, { tags: JSON.parse(m.tags), cells: JSON.parse(m.cells) });
    }
    return {
      maps,
      rosterHeroes: new Set(db.prepare('SELECT hero_name FROM roster WHERE profile_id = ?').pluck().all(defaultProfileId(db)) as string[]),
      knownHeroes: heroNameSet(db),
      ruleNames: new Set(db.prepare('SELECT name FROM boss_rule').pluck().all() as string[]),
      rules: loadRules(),
    };
  }

  function load(id?: number): Scenario[] {
    const rows = db
      .prepare(
        `SELECT id, name, mode, note, estimate, estimate_at AS estimateAt, created_at AS createdAt, updated_at AS updatedAt
         FROM scenario ${id === undefined ? '' : 'WHERE id = ?'} ORDER BY id DESC`,
      )
      .all(...(id === undefined ? [] : [id])) as Omit<Scenario, 'slots'>[];
    const slots = db.prepare('SELECT position, map_name AS mapName, rule FROM scenario_slot WHERE scenario_id = ? ORDER BY position');
    const heroes = db.prepare(
      `SELECT tile, hero_name AS name, part, rank, equipment_level AS equipmentLevel FROM scenario_hero
       WHERE scenario_id = ? AND position = ? AND side = ? ORDER BY tile`,
    );
    return rows.map((r) => ({
      ...r,
      slots: (slots.all(r.id) as { position: number; mapName: string; rule: string | null }[]).map((s) => ({
        ...s,
        mine: heroes.all(r.id, s.position, 'mine') as ScenarioHero[],
        enemy: heroes.all(r.id, s.position, 'enemy') as ScenarioHero[],
      })),
    }));
  }

  /** Stores the teams of a scenario that `validateScenario` has accepted. */
  function write(id: number, body: ScenarioBody): void {
    db.prepare('DELETE FROM scenario_slot WHERE scenario_id = ?').run(id); // heroes go with their slot
    const insertSlot = db.prepare('INSERT INTO scenario_slot (scenario_id, position, map_name, rule) VALUES (?, ?, ?, ?)');
    const insertHero = db.prepare(
      'INSERT INTO scenario_hero (scenario_id, position, side, tile, hero_name, part, rank, equipment_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const [index, slot] of (body.slots as ScenarioInput['slots']).entries()) {
      const position = index + 1;
      insertSlot.run(id, position, slot.mapName, slot.rule || null);
      for (const h of slot.mine ?? []) insertHero.run(id, position, 'mine', h.tile, h.hero, partOf(h), null, null);
      for (const h of slot.enemy) insertHero.run(id, position, 'enemy', h.tile, h.hero, partOf(h), isSummon(h) ? null : (h.rank ?? null), isSummon(h) ? null : (h.equipmentLevel ?? null));
    }
  }

  serve(app, scenariosContract.list, () => load());

  serve(app, scenariosContract.create, ({ body }) => {
    const error = validateScenario(body, context());
    if (error) return fail(400, error);
    const id = db.transaction(() => {
      const created = Number(db.prepare('INSERT INTO scenario (name, mode, note) VALUES (?, ?, ?)').run(body.name, body.mode, body.note).lastInsertRowid);
      write(created, body);
      return created;
    })();
    return load(id)[0]!;
  });

  serve(app, scenariosContract.save, ({ params, body }) => {
    const id = Number(params.id);
    if (load(id).length === 0) return fail(404, 'Unknown scenario');
    const error = validateScenario(body, context());
    if (error) return fail(400, error);
    db.transaction(() => {
      db.prepare("UPDATE scenario SET name = ?, mode = ?, note = ?, updated_at = datetime('now') WHERE id = ?").run(body.name, body.mode, body.note, id);
      write(id, body);
    })();
    return load(id)[0]!;
  });

  serve(app, scenariosContract.remove, ({ params }) => {
    db.prepare('DELETE FROM scenario WHERE id = ?').run(Number(params.id));
  });

  return app;
}
