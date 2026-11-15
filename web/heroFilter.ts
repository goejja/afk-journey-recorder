import type { Hero } from './backend.js';

/** The tiers, strongest first. */
export const TIER_ORDER = ['S', 'A', 'R'];

/** The different non-empty values, sorted: the options of a filter. */
export const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();

export interface HeroFilter {
  search: string;
  faction: string[];
  heroClass: string[];
  /** Left out where the list has no tier filter. */
  tier?: string[];
}

/** Whether a hero passes the filter: its name contains the search text and each chosen faction, class and tier list is empty or names its own. */
export function heroMatches(hero: Hero, filter: HeroFilter): boolean {
  return (
    (!filter.search || hero.name.toLowerCase().includes(filter.search.toLowerCase())) &&
    (filter.faction.length === 0 || filter.faction.includes(hero.faction ?? '')) &&
    (filter.heroClass.length === 0 || filter.heroClass.includes(hero.class ?? '')) &&
    (!filter.tier || filter.tier.length === 0 || filter.tier.includes(hero.tier ?? ''))
  );
}
