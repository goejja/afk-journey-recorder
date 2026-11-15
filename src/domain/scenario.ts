import { z } from 'zod';
import { ARENA_MODES, checkFixedMap, TEAMS_PER_MODE, validateOpponent } from './arena.js';
import { MAX_STANDARD_HEROES } from './formation.js';
import type { HeroStateRules } from './hero-state.js';
import { TILE } from './map.js';
import { checkUnits, heroCount } from './units.js';

export const MAX_ESTIMATE_LENGTH = 8000;

export interface ScenarioContext {
  maps: Map<string, { tags: string[]; cells: number[] }>;
  rosterHeroes: Set<string>;
  knownHeroes: Set<string>;
  ruleNames: Set<string>;
  rules: HeroStateRules;
}

/**
 * What a scenario is saved with: its name, mode and note, and one entry per team. The shape of the
 * teams (the map, the heroes, their tiles) is left to `validateScenario`, whose messages name the team.
 */
export const ScenarioBodySchema = z
  .object(
    {
      name: z.string({ error: 'A scenario needs a name' }).refine((name) => name.trim() !== '', 'A scenario needs a name'),
      mode: z.enum(ARENA_MODES, { error: `The mode must be one of ${ARENA_MODES.join(', ')}` }),
      note: z
        .unknown()
        .optional()
        .transform((note) => (typeof note === 'string' && note.trim() !== '' ? note.trim() : null)),
      slots: z.unknown(),
    },
    { error: 'A scenario needs a name' },
  )
  .superRefine((body, ctx) => {
    const teams = TEAMS_PER_MODE[body.mode];
    if (!Array.isArray(body.slots) || body.slots.length < 1 || body.slots.length > teams) {
      ctx.addIssue({ code: 'custom', path: ['slots'], message: `${body.mode} has ${teams} team${teams === 1 ? '' : 's'}; give 1 to ${teams}` });
    }
  })
  .transform((body) => ({ ...body, name: body.name.trim(), slots: body.slots as unknown[] }));

export type ScenarioBody = z.infer<typeof ScenarioBodySchema>;

/** Returns an error message, or null when the teams of the scenario can be saved. The name, mode and number of teams are already checked. */
export function validateScenario(input: ScenarioBody, ctx: ScenarioContext): string | null {
  const mineUsed = new Set<string>();
  const enemyUsed = new Set<string>();
  for (const [index, raw] of input.slots.entries()) {
    const slot = raw as any; // checked field by field below, with a message that names the team
    const label = `Team ${index + 1}`;
    const map = typeof slot?.mapName === 'string' ? ctx.maps.get(slot.mapName) : undefined;
    if (!map || !map.tags.includes('Arena')) return `${label}: pick an Arena map`;
    const fixedError = checkFixedMap(input.mode, slot.mapName);
    if (fixedError) return `${label}: ${fixedError}`;
    if (slot.rule) {
      if (input.mode !== 'Supreme Arena') return `${label}: only Supreme Arena has a rule`;
      if (!ctx.ruleNames.has(slot.rule)) return `${label}: unknown rule "${slot.rule}"`;
    }

    const mine = slot.mine ?? [];
    if (!Array.isArray(mine) || heroCount(mine) > MAX_STANDARD_HEROES) return `${label}: at most ${MAX_STANDARD_HEROES} of your heroes`;
    const tiles = new Set<number>();
    for (const placed of mine) {
      if (typeof placed?.hero !== 'string' || !ctx.rosterHeroes.has(placed.hero)) return `${label}: ${String(placed?.hero)} is not in your roster`;
      if (!Number.isInteger(placed.tile) || map.cells[placed.tile] !== TILE.PLAYER) return `${label}: ${placed.hero} must stand on a player deployment tile`;
      if (tiles.has(placed.tile)) return `${label}: tile ${placed.tile + 1} is used twice`;
      tiles.add(placed.tile);
    }
    const mineUnitsError = checkUnits(mine);
    if (mineUnitsError) return `${label}: ${mineUnitsError}`;
    for (const hero of new Set(mine.map((p: { hero: string }) => p.hero))) {
      if (mineUsed.has(hero as string)) return `${label}: ${hero} is already on another of your teams`;
      mineUsed.add(hero as string);
    }

    const enemyError = validateOpponent(
      { heroes: slot.enemy },
      {
        cells: map.cells,
        knownHeroes: ctx.knownHeroes,
        artifacts: new Set(),
        phantimalAllowed: false,
        phantimals: new Set(),
        heroFactions: new Map(),
        phantimalFactions: new Map(),
        rules: ctx.rules,
      },
    );
    if (enemyError) return `${label}: ${enemyError}`;
    for (const hero of new Set((slot.enemy as { hero: string }[]).map((p) => p.hero))) {
      if (enemyUsed.has(hero)) return `${label}: ${hero} is already on another enemy team`;
      enemyUsed.add(hero);
    }
  }
  return null;
}

export function validateEstimate(text: unknown): string | null {
  if (typeof text !== 'string') return 'The estimate must be text';
  if (text.length > MAX_ESTIMATE_LENGTH) return `The estimate is at most ${MAX_ESTIMATE_LENGTH} characters`;
  return null;
}
