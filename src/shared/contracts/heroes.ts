import { z } from 'zod';
import { DAMAGE_TYPES, HERO_CLASSES, HERO_FACTIONS, HERO_TIERS, HeroAttributesBodySchema, HeroBodySchema, PlacementRuleBodySchema, PvpHintBodySchema, PVP_ROLES, PVP_TIERS } from '../../domain/hero-admin.js';
import { EFFECTS, RELATIONS } from '../../domain/placement-kinds.js';
import type { TierCheck } from '../api.js';
import { endpoint } from '../contract.js';

/** A standard hero as Admin > Units edits it. */
export const HeroAdmin = z.object({
  name: z.string(),
  tier: z.enum(HERO_TIERS).nullable(),
  class: z.enum(HERO_CLASSES).nullable(),
  faction: z.enum(HERO_FACTIONS).nullable(),
  damageType: z.enum(DAMAGE_TYPES).nullable(),
  source: z.enum(['import', 'manual']),
  /** Set when the hero stands on two tiles. */
  pair: z.object({ part1: z.string(), part2: z.string() }).nullable(),
  /** Set when the hero brings units that are not heroes. */
  summon: z.object({ part: z.string(), count: z.number() }).nullable(),
  /** The PVP Tier hint (ADR 0036): not the hero's tier. All three are null for a hero without a hint. */
  pvpTier: z.enum(PVP_TIERS).nullable(),
  pvpRole: z.enum(PVP_ROLES).nullable(),
  /** The day the hint was set, and by whom: Prydwen's list (`prydwen`) or the player (`manual`). */
  pvpSetOn: z.string().nullable(),
  pvpSource: z.enum(['prydwen', 'manual']).nullable(),
  /** Range, energy and mechanic tags (ADR 0037): null for a hero that has none. */
  attributes: z
    .object({
      range: z.number().nullable(),
      energy: z.array(z.number()),
      mechanics: z.array(z.string()),
      releasedInSeason: z.number().nullable(),
      /** The day they were copied or last edited, and from where: an outside source (`external`) or the player (`manual`). */
      setOn: z.string(),
      source: z.enum(['external', 'manual']),
    })
    .nullable(),
});
export type HeroAdmin = z.infer<typeof HeroAdmin>;

/** A Placement Rule as Admin > Units edits it (ADR 0036): where a hero's skill puts its effect. */
export const PlacementRule = z.object({
  id: z.number(),
  hero: z.string(),
  relation: z.enum(RELATIONS),
  effect: z.enum(EFFECTS),
  wantsRole: z.enum(PVP_ROLES).nullable(),
  note: z.string(),
  /** The player. */
  source: z.enum(['manual']),
  enabled: z.boolean(),
});
export type PlacementRule = z.infer<typeof PlacementRule>;

/** What uses a hero. `onBoard` (records, scenarios and Formation IDs that place it) fixes the units it brings. */
export const HeroUsage = z.object({
  roster: z.number(),
  records: z.number(),
  assists: z.number(),
  scenarios: z.number(),
  deployments: z.number(),
  stageEnemies: z.number(),
  pictures: z.number(),
  onBoard: z.number(),
});
export type HeroUsage = z.infer<typeof HeroUsage>;

export type HeroAdminBody = z.input<typeof HeroBodySchema>;
export type PvpHintBody = z.input<typeof PvpHintBodySchema>;
export type HeroAttributesBody = z.input<typeof HeroAttributesBodySchema>;
export type PlacementRuleBody = z.input<typeof PlacementRuleBodySchema>;

export const heroesContract = {
  list: endpoint({ method: 'GET', path: '/api/admin/heroes', response: z.array(HeroAdmin) }),
  usage: endpoint({ method: 'GET', path: '/api/admin/heroes/:name/usage', response: HeroUsage }),
  create: endpoint({ method: 'POST', path: '/api/admin/heroes', body: HeroBodySchema, response: HeroAdmin, status: 201 }),
  save: endpoint({ method: 'PUT', path: '/api/admin/heroes/:name', body: HeroBodySchema, response: HeroAdmin }),
  savePvpHint: endpoint({ method: 'PUT', path: '/api/admin/heroes/:name/pvp-hint', body: PvpHintBodySchema, response: HeroAdmin }),
  saveAttributes: endpoint({ method: 'PUT', path: '/api/admin/heroes/:name/attributes', body: HeroAttributesBodySchema, response: HeroAdmin }),
  remove: endpoint({ method: 'DELETE', path: '/api/admin/heroes/:name', response: z.undefined(), status: 204 }),
  /** The default profile's own records against each Prydwen tier hint (ADR 0036): a pointer, never a change to the tier. */
  tierCheck: endpoint({ method: 'GET', path: '/api/admin/tier-check', response: z.array(z.custom<TierCheck>()) }),
  placementRules: endpoint({ method: 'GET', path: '/api/admin/placement-rules', response: z.array(PlacementRule) }),
  createPlacementRule: endpoint({ method: 'POST', path: '/api/admin/heroes/:name/placement-rules', body: PlacementRuleBodySchema, response: PlacementRule, status: 201 }),
  savePlacementRule: endpoint({ method: 'PUT', path: '/api/admin/placement-rules/:id', body: PlacementRuleBodySchema, response: PlacementRule }),
  removePlacementRule: endpoint({ method: 'DELETE', path: '/api/admin/placement-rules/:id', response: z.undefined(), status: 204 }),
};
