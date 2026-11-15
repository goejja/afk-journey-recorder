import { z } from 'zod';
import { EFFECTS, RELATIONS } from './placement-kinds.js';

/** What the game gives a standard hero. The Units page offers exactly these. */
export const HERO_TIERS = ['R', 'A', 'S'] as const;
export const HERO_CLASSES = ['Tank', 'Support', 'Marksman', 'Mage', 'Rogue', 'Warrior'] as const;
export const HERO_FACTIONS = ['Lightbearer', 'Wilder', 'Mauler', 'Graveborn', 'Celestial', 'Hypogean', 'Dimensional'] as const;
export const DAMAGE_TYPES = ['Physical', 'Magic'] as const;

/** The PVP Tier hint a player keeps for a hero, and the role Prydwen gives it (ADR 0036). Not the hero's own tier (R, A, S). */
export const PVP_TIERS = ['S+', 'S', 'A+', 'A', 'B', 'C', 'D'] as const;
export const PVP_ROLES = ['Damage dealer', 'Specialist', 'Support', 'Tank'] as const;

/** The most summons one hero can bring. */
export const MAX_SUMMONS = 9;

/** Characters the query CLI and the Formation ID text use to separate names. */
const SEPARATORS = /[,|@]/;

/** A hero, part or phantimal name: trimmed, not empty and free of the separators of those texts. */
export const unitName = (what: string) =>
  z
    .string({ error: `${what} must be text` })
    .trim()
    .min(1, `${what} cannot be empty`)
    .refine((name) => !SEPARATORS.test(name), `${what} cannot contain a comma, a bar or an @`);

const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? null);

/**
 * What a hero is created or changed with. The tier, class, faction and damage type are the game's; `pair` makes the hero stand on two
 * tiles (Elijah & Lailah), `summon` gives it units that are not heroes (Zanie's turrets). It is never both.
 */
export const HeroBodySchema = z
  .object(
    {
      name: unitName('A hero name'),
      tier: optional(z.enum(HERO_TIERS, { error: 'Tier must be R, A or S' })),
      class: optional(z.enum(HERO_CLASSES, { error: `Class must be one of ${HERO_CLASSES.join(', ')}` })),
      faction: optional(z.enum(HERO_FACTIONS, { error: `Faction must be one of ${HERO_FACTIONS.join(', ')}` })),
      damageType: optional(z.enum(DAMAGE_TYPES, { error: 'Damage type must be Physical or Magic' })),
      pair: optional(z.object({ part1: unitName('A part name'), part2: unitName('A part name') }, { error: 'A pair needs two part names' })),
      summon: optional(
        z.object(
          {
            part: unitName('A summon name'),
            count: z.number({ error: 'A summon count must be a whole number' }).int('A summon count must be a whole number').min(1, 'A hero brings at least 1 summon').max(MAX_SUMMONS, `A hero brings at most ${MAX_SUMMONS} summons`),
          },
          { error: 'A summon needs a name and a count' },
        ),
      ),
    },
    { error: 'A hero needs a name' },
  )
  .refine((hero) => !(hero.pair && hero.summon), { message: 'A hero is either a pair or a summoner, not both' })
  .refine((hero) => !hero.pair || hero.pair.part1.toLowerCase() !== hero.pair.part2.toLowerCase(), { message: 'The two parts of a pair need different names' });

export type HeroBody = z.output<typeof HeroBodySchema>;

/** The message for a hero a new row cannot have: the game always gives all four. Null when the row is complete. */
export function missingHeroInfo(hero: Pick<HeroBody, 'tier' | 'class' | 'faction' | 'damageType'>): string | null {
  const missing = [hero.tier ? '' : 'tier', hero.class ? '' : 'class', hero.faction ? '' : 'faction', hero.damageType ? '' : 'damage type'].filter(Boolean);
  return missing.length > 0 ? `A new hero needs its ${missing.join(', ')}` : null;
}

/** What a hero's Tier hint is set to; both null removes the hint. */
export const PvpHintBodySchema = z.object(
  {
    pvpTier: optional(z.enum(PVP_TIERS, { error: `PVP tier must be one of ${PVP_TIERS.join(', ')}` })),
    pvpRole: optional(z.enum(PVP_ROLES, { error: `PVP role must be one of ${PVP_ROLES.join(', ')}` })),
  },
  { error: 'A PVP hint needs a tier and a role, or neither' },
);

export type PvpHintBody = z.output<typeof PvpHintBodySchema>;

/** What a Placement Rule is created or changed with (ADR 0036). The hero is the one the rule is listed under, never changed here. */
export const PlacementRuleBodySchema = z.object(
  {
    relation: z.enum(RELATIONS, { error: `Relation must be one of ${RELATIONS.join(', ')}` }),
    effect: z.enum(EFFECTS, { error: `Effect must be one of ${EFFECTS.join(', ')}` }),
    wantsRole: optional(z.enum(PVP_ROLES, { error: `Role must be one of ${PVP_ROLES.join(', ')}` })),
    note: z.string({ error: 'The note must be text' }).trim().max(500, 'The note is at most 500 characters').default(''),
    enabled: z.boolean({ error: 'Enabled must be true or false' }),
  },
  { error: 'A rule needs a relation, an effect and whether it is on' },
);

export type PlacementRuleBody = z.output<typeof PlacementRuleBodySchema>;
