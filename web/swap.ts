/**
 * The drafts with the chosen parts of two teams exchanged (their formations, or their opponents' formations): everything else about a team
 * stays with its slot, including the map, rule or boss and the result. `refit` then puts each team on its own slot's map again, since the
 * exchanged units stood on the other team's map.
 */
export function swapParts<D, K extends keyof D>(drafts: D[], a: number, b: number, parts: K[], refit: (draft: D) => D): D[] {
  if (a === b || !drafts[a] || !drafts[b]) return drafts;
  const take = (from: D, into: D): D => {
    const next = { ...into };
    for (const part of parts) next[part] = from[part];
    return refit(next);
  };
  return drafts.map((d, i) => (i === a ? take(drafts[b]!, d) : i === b ? take(drafts[a]!, d) : d));
}
