/** Where a Placement Rule's effect lands, relative to the hero it belongs to (ADR 0036). The same words are the CHECK values of the `placement_rule` table. */
export const RELATIONS = ['behind', 'mirror', 'rearmost', 'sameRow', 'farthest'] as const;
export type Relation = (typeof RELATIONS)[number];

/** What the effect is, as far as the app knows: it never describes a skill beyond the word. */
export const EFFECTS = ['protects', 'boosts', 'other'] as const;
export type Effect = (typeof EFFECTS)[number];
