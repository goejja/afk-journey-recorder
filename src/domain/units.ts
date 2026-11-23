/**
 * Units a map tile can hold besides a plain hero. A placed unit is its owning hero plus an optional
 * unit label: the hero's rank, equipment, roster entry and "one team only" rule all stay on the hero.
 */

/** What the player declares about the units of heroes and phantimals (Admin > Units), kept in `hero_pair`, `hero_summon` and `phantimal_part`. */
export interface UnitRules {
  /** Heroes that stand on two tiles, one per part. Both parts are always placed together and share rank and equipment. */
  pairs: Record<string, readonly [string, string]>;
  /**
   * Units a hero brings that are not heroes: no rank, no equipment, no hero slot. A hero on the map always has all
   * `count` of them, each on a free deployment tile like any other unit.
   */
  summons: Record<string, { part: string; count: number }>;
  /**
   * Phantimals that stand on two tiles, one per part. The key is the name a record keeps and the value its second part,
   * which is not a phantimal of its own. A phantimal tile is stored for the key and a second one (`partnerTile`) for the part.
   */
  phantimalParts: Record<string, string>;
}

/** What a database knows before the player changes anything; what `hero_pair`, `hero_summon` and `phantimal_part` are seeded with. */
export const DEFAULT_UNIT_RULES: UnitRules = {
  pairs: { 'Elijah & Lailah': ['Elijah', 'Lailah'] },
  summons: { Zanie: { part: 'Laser Turret', count: 2 }, Phraesto: { part: 'Phraesto clone', count: 1 } },
  phantimalParts: { 'Wedge of Matter': 'Wedge of Power' },
};

/*
 * The rules are read all over the pure code (layouts, placement, checks, the web app), so they are held here, once, and read through
 * the exports below. `applyUnitRules` replaces their contents in place: the server does it when it opens a database and after an
 * edit, the web app when it starts and after an edit. A process works on one database at a time, the last one opened.
 */

/** Heroes that stand on two tiles. */
export const PAIR_HEROES: Record<string, readonly [string, string]> = {};

/** Summons of each hero. */
export const SUMMONS: Record<string, { part: string; count: number }> = {};

/** Phantimals that stand on two tiles, by the name a record keeps, to their second part. */
export const PAIR_PHANTIMALS: Record<string, string> = {};

/** The second parts, which the picker offers only under the phantimal they belong to. */
export const PARTNER_PHANTIMALS: ReadonlySet<string> = new Set<string>();

/** Each unit name (a pair's part or a summon) mapped to the hero it belongs to. */
export const UNIT_OWNERS: Record<string, string> = {};

const replace = <T>(target: Record<string, T>, source: Record<string, T>) => {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
};

/** Makes these the rules the pure code works with. */
export function applyUnitRules(rules: UnitRules): void {
  replace(PAIR_HEROES, rules.pairs);
  replace(SUMMONS, rules.summons);
  replace(PAIR_PHANTIMALS, rules.phantimalParts);
  const partners = PARTNER_PHANTIMALS as Set<string>;
  partners.clear();
  for (const part of Object.values(rules.phantimalParts)) partners.add(part);
  replace(UNIT_OWNERS, {
    ...Object.fromEntries(Object.entries(rules.pairs).flatMap(([hero, parts]) => parts.map((part) => [part, hero] as const))),
    ...Object.fromEntries(Object.entries(rules.summons).map(([hero, { part }]) => [part, hero] as const)),
  });
}

applyUnitRules(DEFAULT_UNIT_RULES);

/** How many heroes of its faction a Phantimal needs on the field before it appears (ADR 0029). */
const FACTION_HEROES = 3;

/** The factions a Phantimal's requirement accepts: its own, or both of a `Celestial-Hypogean` tag. */
const factionsOf = (faction: string | null | undefined): string[] =>
  (faction ?? '')
    .split('-')
    .map((f) => f.trim())
    .filter(Boolean);

/**
 * Returns an error message when the Phantimal's Faction Requirement is not met, else null. A Pair Hero counts once, a
 * Summon never (its row names its owner), an Assist hero never (it is not placed), and an unknown faction is not checked.
 */
export function checkFactionRequirement(
  placed: { hero: string }[],
  phantimalName: string,
  phantimalFaction: string | null | undefined,
  heroFactions: Map<string, string | null>,
): string | null {
  const wanted = factionsOf(phantimalFaction);
  if (wanted.length === 0) return null;
  const matching = [...new Set(placed.map((p) => p.hero))].filter((hero) => wanted.includes(heroFactions.get(hero) ?? ''));
  if (matching.length >= FACTION_HEROES) return null;
  return `${phantimalName} needs ${FACTION_HEROES} ${wanted.join(' or ')} heroes; this team has ${matching.length}`;
}

/**
 * Returns an error message when a phantimal's second tile does not fit its name, else null. A pair needs its second
 * tile; any other phantimal has none. A partner part on its own (an older record) stays valid, as a single phantimal.
 */
export function checkPhantimalPartner(phantimal: { name: string; partnerTile?: number | null }, place: (tile: number, label: string) => string | null): string | null {
  const partner = PAIR_PHANTIMALS[phantimal.name];
  const tile = phantimal.partnerTile ?? null;
  if (!partner) return tile === null ? null : `${phantimal.name} has no second part`;
  if (tile === null) return `${phantimal.name} stands as ${phantimal.name} and ${partner}; place both`;
  return place(tile, partner);
}

/** The Units a hero puts on the map, in placement order: a Pair Hero's parts, else the hero itself and its Summons. */
export function unitsOf(hero: string): string[] {
  const pair = PAIR_HEROES[hero];
  if (pair) return [...pair];
  const summon = SUMMONS[hero];
  return ['', ...(summon ? Array.from({ length: summon.count }, () => summon.part) : [])];
}

/** The unit of a placed row: '' or missing for a hero standing alone; a part name for a pair; the summon's name for a summon. */
export const partOf = (p: { part?: string | null }): string => p.part ?? '';

export const isSummon = (p: { hero: string; part?: string | null }): boolean => SUMMONS[p.hero]?.part === partOf(p) && partOf(p) !== '';

/** How many heroes a placement holds: a pair counts once and summons count for nothing. */
export const heroCount = (placed: { hero: string }[]): number => new Set(placed.map((p) => p?.hero)).size;

/** Returns an error message when the units placed for one side do not fit the rules above, else null. */
export function checkUnits(placed: { hero: string; part?: string | null }[]): string | null {
  const unitsByHero = new Map<string, string[]>();
  for (const p of placed) unitsByHero.set(p.hero, [...(unitsByHero.get(p.hero) ?? []), partOf(p)]);
  for (const [hero, units] of unitsByHero) {
    const summon = SUMMONS[hero];
    const own = units.filter((u) => u !== summon?.part);
    const pair = PAIR_HEROES[hero];
    if (pair) {
      if (own.length !== 2 || !pair.every((part) => own.includes(part))) return `${hero} stands as ${pair.join(' and ')}; place both`;
    } else if (own.length === 0) {
      return `${summon!.part} needs ${hero} on the map`;
    } else if (own.length > 1) {
      return `${hero} is placed twice`;
    } else if (own[0] !== '') {
      return `${hero} has no ${own[0]}`;
    }
    if (summon) {
      const placedSummons = units.length - own.length;
      if (placedSummons > summon.count) return `${hero} has at most ${summon.count} ${summon.part}`;
      if (placedSummons < summon.count) return `${hero} brings ${summon.count} ${summon.part}; place ${summon.count === 1 ? 'it' : 'all'}`;
    }
  }
  return null;
}
