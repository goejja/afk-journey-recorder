/** The mean difference of two feature grids of the same length, 0 to 1 when the features are colour channels scaled to 0 to 1. */
export const meanDifference = (a: Float32Array, b: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
};

export interface Nearest {
  label: string;
  /** The distance to the closest example with that label. */
  distance: number;
  /** How much farther the closest example of any other label is, as a share of its distance (1 when there is no other label). */
  margin: number;
  /** How many examples carry the label. */
  support: number;
}

/**
 * The label of the example closest to `features`: each label is as close as its closest example, and the margin says how clearly it
 * beats the runner-up. The readers decide from these numbers whether to trust the answer. Null without examples.
 */
export function nearestLabel<E extends { features: Float32Array }>(features: Float32Array, examples: E[], labelOf: (example: E) => string, distance: (a: Float32Array, b: Float32Array) => number): Nearest | null {
  const best = new Map<string, { distance: number; count: number }>();
  for (const example of examples) {
    const d = distance(features, example.features);
    const label = labelOf(example);
    const entry = best.get(label);
    if (!entry) best.set(label, { distance: d, count: 1 });
    else {
      entry.count++;
      entry.distance = Math.min(entry.distance, d);
    }
  }
  const ranked = [...best.entries()].sort((a, b) => a[1].distance - b[1].distance);
  const first = ranked[0];
  if (!first) return null;
  const second = ranked[1];
  const margin = second ? (second[1].distance - first[1].distance) / Math.max(second[1].distance, 1e-6) : 1;
  return { label: first[0], distance: first[1].distance, margin, support: first[1].count };
}

/**
 * The same distance, read from a table filled once for these feature sets: reading each of many examples from all the others compares
 * every pair, and the review does it again for each removal it tries. Features that are not in `all` are measured as before.
 */
export function distanceTable(all: Float32Array[], distance: (a: Float32Array, b: Float32Array) => number): (a: Float32Array, b: Float32Array) => number {
  const index = new Map(all.map((features, i) => [features, i] as const));
  const table = new Float32Array(all.length * all.length);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) table[i * all.length + j] = table[j * all.length + i] = distance(all[i]!, all[j]!);
  return (a, b) => {
    const i = index.get(a);
    const j = index.get(b);
    return i === undefined || j === undefined ? distance(a, b) : table[i * all.length + j]!;
  };
}
