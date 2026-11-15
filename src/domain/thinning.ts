import { z } from 'zod';

/** Where a learnt picture came from (ADR 0027): `roster` is the one the player confirmed in a Roster import. */
export type ThinningSource = 'roster' | 'battle' | 'offline' | null;

/** A learnt picture as Thinning sees it: its group (the Rank, Hero or name it teaches) and what decides which of two alike stays. */
export interface ThinningPicture {
  id: number;
  group: string;
  source: ThinningSource;
  /** The others would read this picture as another Rank or Hero: it is never the one that stays. */
  flagged: boolean;
}

/** A group is never thinned below this many pictures: the rank reader names a rank only after it has seen it three times. */
export const THINNING_FLOOR = 3;

export interface ThinningOptions<T extends ThinningPicture> {
  /** Pictures closer than this are the same look seen again. */
  threshold: number;
  /** A group is never thinned below this many pictures. */
  floor: number;
  distance: (a: T, b: T) => number;
}

/** What Thinning proposes for one group: the pictures that stay and the ones that add nothing to them. */
export interface ThinningGroupPlan<T extends ThinningPicture> {
  group: string;
  keep: T[];
  remove: T[];
}

/** The groups in which near-identical pictures can be removed; a group with nothing to remove is left out. */
export function planThinning<T extends ThinningPicture>(pictures: T[], options: ThinningOptions<T>): ThinningGroupPlan<T>[] {
  const groups = new Map<string, T[]>();
  for (const p of pictures) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  const plans: ThinningGroupPlan<T>[] = [];
  for (const [group, members] of groups) {
    const keep: T[] = [];
    const remove: T[] = [];
    // how typical a picture is: the smaller its total distance to the others of its group, the more it stands for them
    const spread = new Map(members.map((p) => [p, members.reduce((sum, other) => sum + options.distance(p, other), 0)]));
    // the picture that stays is the first considered: never a flagged one, then one the player confirmed in a Roster import, then the most typical (the sort is stable)
    const preferred = [...members].sort(
      (a, b) => Number(a.flagged) - Number(b.flagged) || Number(b.source === 'roster') - Number(a.source === 'roster') || spread.get(a)! - spread.get(b)!,
    );
    for (const p of preferred) (keep.some((k) => options.distance(k, p) < options.threshold) ? remove : keep).push(p);
    // the floor stops the thinning: the pictures taken back are those that add the most, the furthest from every picture that stays
    const nearestKept = (p: T) => Math.min(...keep.map((k) => options.distance(k, p)));
    while (keep.length < options.floor && remove.length > 0) {
      const [back] = remove.map((p) => ({ p, gap: nearestKept(p) })).sort((a, b) => b.gap - a.gap);
      remove.splice(remove.indexOf(back!.p), 1);
      keep.push(back!.p);
    }
    if (remove.length > 0) plans.push({ group, keep, remove });
  }
  return plans;
}

const APPLY_MESSAGE = 'Give the kind of picture (rank) and the ids of the pictures to remove, at least one';

/** The pictures the player ticked to remove: the kind of picture and their ids. */
export const ThinningApplySchema = z.object(
  {
    kind: z.literal('rank', { error: APPLY_MESSAGE }),
    ids: z.array(z.number({ error: APPLY_MESSAGE }).int(APPLY_MESSAGE), { error: APPLY_MESSAGE }).min(1, APPLY_MESSAGE),
  },
  { error: APPLY_MESSAGE },
);

/** How alike two pictures of a kind must be (the reader's feature distance) for Thinning to treat them as one look; the player can change it in Admin. */
export interface ThinningSettings {
  rank: number;
}

export const DEFAULT_THINNING_SETTINGS: ThinningSettings = { rank: 0.05 };
