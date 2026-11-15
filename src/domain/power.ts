/**
 * The upgrade gap of two sides: how far apart their ranks and equipment were, and what that is worth in the Win Score.
 * A side's power is the mean over its heroes of the place of the rank on the ladder plus a step for the equipment level.
 */

/** The slope (logit per unit of gap) is never above this: a small mode can separate perfectly and would give an infinite one. */
export const GAP_SLOPE_CAP = 1;
/** A slope is fitted from at least this many battles with a known gap, else it is taken as 0 (no adjustment). */
export const MIN_GAP_BATTLES = 30;

/** Power of one hero's equipment: +5 is a step; the Resonance levels after +25 count one each. */
export const equipmentStep = (level: number | null) => (level === null ? 0 : level <= 25 ? level / 5 : 5 + (level - 25));

/** Mean power per hero of a side; null when a hero's rank is unknown or the side has no heroes. */
export function sidePower(heroes: { rank: string | null; equipment: number | null }[], rankPosition: ReadonlyMap<string, number>): number | null {
  if (heroes.length === 0) return null;
  let total = 0;
  for (const hero of heroes) {
    const position = hero.rank === null ? undefined : rankPosition.get(hero.rank);
    if (position === undefined) return null;
    total += position + equipmentStep(hero.equipment);
  }
  return total / heroes.length;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * How much more (or less) than a plain result a past battle says about the gap that is asked about: the chance to win at the asked gap
 * minus the chance at the gap the battle was fought at. A win when behind has a positive shift and a loss when ahead a negative one.
 */
export const gapShift = (slope: number, battleGap: number, askedGap: number) => sigmoid(slope * askedGap) - sigmoid(slope * battleGap);

/**
 * The slope of the chance to win, in logit per unit of gap, fitted on battles with a known gap (the gap of the side that won or lost).
 * Both orientations of a battle are used, so there is no intercept: equal sides win half the time. A tiny ridge keeps a perfect
 * separation finite. Clamped to 0..GAP_SLOPE_CAP, and 0 under MIN_GAP_BATTLES battles.
 */
export function fitGapSlope(battles: { gap: number; won: boolean }[]): number {
  if (battles.length < MIN_GAP_BATTLES) return 0;
  const ridge = 1e-3;
  let slope = 0;
  for (let i = 0; i < 50; i++) {
    let gradient = -ridge * slope;
    let curvature = ridge;
    for (const { gap, won } of battles) {
      const p = sigmoid(slope * gap);
      // The mirrored orientation (gap -g, result flipped) adds the same gradient and curvature, so count each battle twice.
      gradient += 2 * ((won ? 1 : 0) - p) * gap;
      curvature += 2 * p * (1 - p) * gap * gap;
    }
    const next = Math.min(GAP_SLOPE_CAP, Math.max(0, slope + gradient / curvature));
    if (Math.abs(next - slope) < 1e-9) return next;
    slope = next;
  }
  return slope;
}
