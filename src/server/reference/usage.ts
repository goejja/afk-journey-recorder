import { fail } from '../contract.js';

/** What uses an Admin catalog item: how many of something, named in the plural (`label`) and, when it is not just the label without its s, in the singular (`one`). */
export interface Usage {
  label: string;
  count: number;
  one?: string;
}

/** What uses an item, as a sentence part the player can read before deleting it: "3 records, 2 stages". Empty when nothing does. */
export function describeUsage(usage: Usage[]): string {
  return usage
    .filter((u) => u.count > 0)
    .map((u) => `${u.count} ${u.count === 1 ? (u.one ?? u.label.replace(/s$/, '')) : u.label}`)
    .join(', ');
}

/** The refusal of a delete (409) that says what uses the item, or null when nothing does. */
export function refuseUsed(name: string, usage: Usage[]) {
  const used = describeUsage(usage);
  return used ? fail(409, `${name} is used by ${used}, so it cannot be deleted`) : null;
}
