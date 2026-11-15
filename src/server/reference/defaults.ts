import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { DEFAULT_MODES, DEFAULT_SLOTS, emptySlot, validateDefaults, type DefaultMode, type DefaultSlot } from '../../domain/defaults.js';
import { defaultsContract, type WeeklySetups } from '../../shared/contracts/defaults.js';
import { hasName } from '../db-helpers.js';
import { fail, serve } from '../contract.js';

/** Routes for the weekly default in Admin > Weekly default, which new Supreme Arena, Super League, Guild Duel and Dream Hunt records start from. */
export function defaultsRoutes(db: Database.Database): Hono {
  const app = new Hono();

  const view = (): WeeklySetups =>
    Object.fromEntries(
      DEFAULT_MODES.map((mode) => {
        const rows = db.prepare('SELECT position, boss, map_name AS mapName, rule, updated_at AS updatedAt FROM weekly_default WHERE mode = ? ORDER BY position').all(mode) as (DefaultSlot & { position: number; updatedAt: string })[];
        const slots = Array.from({ length: DEFAULT_SLOTS[mode] }, (_, i) => {
          const row = rows.find((r) => r.position === i + 1);
          return row ? { boss: row.boss, mapName: row.mapName, rule: row.rule } : emptySlot();
        });
        return [mode, { slots, updatedAt: rows.map((r) => r.updatedAt).sort().at(-1) ?? null }];
      }),
    ) as WeeklySetups;

  serve(app, defaultsContract.list, () => view());

  // Replaces the whole setup of a mode; a team with nothing set is simply not stored.
  serve(app, defaultsContract.save, ({ params, body }) => {
    const mode = params.mode as DefaultMode;
    const problem = validateDefaults(mode, body.slots);
    if (problem) return fail(400, problem);
    const slots = body.slots as DefaultSlot[];
    const mapTag = mode === 'Dream Hunt' ? 'Stage' : 'Arena';
    for (const [i, slot] of slots.entries()) {
      if (slot.boss && !hasName(db, 'boss', slot.boss)) return fail(400, `Team ${i + 1}: unknown boss "${slot.boss}"`);
      if (slot.rule && !hasName(db, 'boss_rule', slot.rule)) return fail(400, `Team ${i + 1}: unknown rule "${slot.rule}"`);
      if (slot.mapName) {
        const tags = db.prepare('SELECT tags FROM map WHERE name = ?').pluck().get(slot.mapName) as string | undefined;
        if (tags === undefined || !(JSON.parse(tags) as string[]).includes(mapTag)) return fail(400, `Team ${i + 1}: "${slot.mapName}" is not a ${mapTag} map`);
      }
    }
    db.transaction(() => {
      db.prepare('DELETE FROM weekly_default WHERE mode = ?').run(mode);
      const insert = db.prepare('INSERT INTO weekly_default (mode, position, boss, map_name, rule) VALUES (?, ?, ?, ?, ?)');
      for (const [i, slot] of slots.entries()) {
        if (slot.boss || slot.mapName || slot.rule) insert.run(mode, i + 1, slot.boss || null, slot.mapName || null, slot.rule || null);
      }
    })();
    return view();
  });

  serve(app, defaultsContract.clear, ({ params }) => {
    if (!DEFAULT_MODES.includes(params.mode as DefaultMode)) return fail(404, 'Unknown mode');
    db.prepare('DELETE FROM weekly_default WHERE mode = ?').run(params.mode);
    return view();
  });

  return app;
}
