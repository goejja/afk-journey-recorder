/** Words that file names add around a unit's name, for example "Item Bladestorm Spell (Veil of Memories).png". */
const NOISE = /\b(item|spell|artifact|icon|portrait|image)\b/g;

/** A name reduced to letters and digits, so "Arc Burst", "arc-burst" and "Item Arc Burst Spell (Crown of Ashes)" agree. */
export function normalizeName(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9]/g, '');
}

export interface FileMatches<F> {
  /** One file per unit name. */
  matched: { name: string; file: F }[];
  /** Files whose name matches no unit. */
  unmatched: string[];
  /** Files that match a unit another file also matches; none of them is used, since the right one is unknown. */
  ambiguous: string[];
}

/** Pairs picked image files with unit names by their file names. */
export function matchFiles<F extends { name: string }>(files: F[], names: string[]): FileMatches<F> {
  const byNormalized = new Map(names.map((name) => [normalizeName(name), name]));
  const byUnit = new Map<string, F[]>();
  const unmatched: string[] = [];
  for (const file of files) {
    const unit = byNormalized.get(normalizeName(file.name));
    if (unit) byUnit.set(unit, [...(byUnit.get(unit) ?? []), file]);
    else unmatched.push(file.name);
  }
  const matched: FileMatches<F>['matched'] = [];
  const ambiguous: string[] = [];
  for (const [name, candidates] of byUnit) {
    if (candidates.length === 1) matched.push({ name, file: candidates[0]! });
    else ambiguous.push(...candidates.map((f) => f.name));
  }
  return { matched, unmatched, ambiguous };
}
