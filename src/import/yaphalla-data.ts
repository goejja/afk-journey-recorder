import { WEAPON_CAPS, WEAPON_LEVELS } from '../domain/exclusive-weapon.js';
import { evalConst, parseChunk, type Json } from './static-eval.js';

export interface RankRow {
  name: string;
  position: number;
}
export interface ArtifactRow {
  name: string;
  group: string;
}
export interface RankEquipmentCapRow {
  rank: string;
  minLevel: number | null;
  maxLevel: number | null;
}
export interface PhantimalRow {
  name: string;
  faction: string;
  class: string;
  seasons: number[];
}
export interface YaphallaReferenceData {
  ranks: RankRow[];
  equipmentLevels: number[];
  rankEquipmentCaps: RankEquipmentCapRow[];
  artifacts: ArtifactRow[];
  phantimals: PhantimalRow[];
}

const IGNORED_ARTIFACT_GROUPS = new Set(['Honor Duel']);
const PRE_SEASON = 'Pre-Season';
/** The site also lists a Crown, which is only another name for Paragon 4 at weapon level R4, so it is not a rank here. */
const EXPECTED_RANK_COUNT = 15;

function isStringArray(value: Json | undefined): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');
}

/** Reads reference data out of the site's JS chunks by structure, not by minified name. */
export function extractReferenceData(chunkSources: string[]): YaphallaReferenceData {
  const values: Json[] = [];
  for (const source of chunkSources) {
    const chunk = parseChunk(source);
    for (const { node, ancestors } of chunk.nodes) {
      if (node.type !== 'ArrayExpression' && node.type !== 'ObjectExpression') continue;
      const value = evalConst(node, ancestors);
      if (value !== undefined) values.push(value);
    }
  }
  return {
    ranks: extractRanks(values),
    // Yaphalla's steps of five up to +45 do not match the game's Resonance levels, so the weapon rules are our own (AFK Global).
    equipmentLevels: WEAPON_LEVELS,
    rankEquipmentCaps: WEAPON_CAPS,
    artifacts: extractArtifacts(values),
    phantimals: extractPhantimals(values),
  };
}

/**
 * The site builds its rank list in code from a base list of tier names, so it is not
 * a literal. Rebuild it from that base list and check it against the names the site
 * uses elsewhere (the cap table), failing if the structure no longer matches.
 */
function extractRanks(values: Json[]): RankRow[] {
  const base = values.find(
    (v): v is string[] => isStringArray(v) && v.join() === 'Rare,Elite,Epic,Legendary,Mythic',
  );
  if (!base) throw new Error('Rank base list (Rare..Mythic) not found in chunks');
  const supremeAndAbove = [...base, 'Supreme'];
  // The site's leading 'None' only means "no rank selected", so it is not a rank here.
  const names = [
    'Paragon 4',
    'Paragon 3',
    'Paragon 2',
    'Paragon 1',
    ...supremeAndAbove
      .slice(1)
      .reverse()
      .flatMap((tier) => [`${tier}+`, tier]),
    'Rare',
  ];
  if (names.length !== EXPECTED_RANK_COUNT) {
    throw new Error(`Expected ${EXPECTED_RANK_COUNT} ranks, rebuilt ${names.length}`);
  }
  // Position 0 is the lowest rank, so reverse the site's strongest-first order.
  return names.reverse().map((name, position) => ({ name, position }));
}

function extractArtifacts(values: Json[]): ArtifactRow[] {
  // The full table is spread together from smaller literals that also match, so take the widest.
  const byGroup = values
    .filter(
      (v): v is Record<string, string[]> =>
        typeof v === 'object' &&
        v !== null &&
        !Array.isArray(v) &&
        PRE_SEASON in v &&
        Object.values(v).every(isStringArray),
    )
    .sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];
  if (!byGroup) throw new Error('Artifact groups (Pre-Season, Season N) not found in chunks');
  const rows: ArtifactRow[] = [];
  for (const [group, names] of Object.entries(byGroup)) {
    if (IGNORED_ARTIFACT_GROUPS.has(group)) continue;
    for (const name of names) rows.push({ name, group });
  }
  return rows;
}

const MIN_PHANTIMALS = 5;

/**
 * The site maps each season to its phantimals, keyed by faction ("Celestial-Hypogean" covers
 * two factions and lists two heroes). Seasons without such an entry are simply absent.
 */
function extractPhantimals(values: Json[]): PhantimalRow[] {
  const bySeason = values
    .filter((v): v is Record<string, Json> => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
      const keys = Object.keys(v);
      return keys.length > 0 && keys.every((k) => /^Season \d+$/.test(k)) && Object.values(v).every(isFactionMap);
    })
    .sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];
  if (!bySeason) throw new Error('Phantimal lists per season not found in chunks');

  const rows = new Map<string, PhantimalRow>();
  for (const [seasonKey, factions] of Object.entries(bySeason)) {
    const season = Number(seasonKey.replace('Season ', ''));
    for (const [faction, entry] of Object.entries(factions as Record<string, Json>)) {
      for (const hero of Array.isArray(entry) ? entry : [entry]) {
        const { hero: name, heroClass } = hero as { hero: string; heroClass: string };
        const row = rows.get(name) ?? { name, faction, class: heroClass, seasons: [] };
        if (!row.seasons.includes(season)) row.seasons.push(season);
        rows.set(name, row);
      }
    }
  }
  const phantimals = [...rows.values()];
  if (phantimals.length < MIN_PHANTIMALS) {
    throw new Error(`Only ${phantimals.length} phantimals found; expected at least ${MIN_PHANTIMALS}`);
  }
  return phantimals;
}

function isPhantimalHero(value: Json): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value['hero'] === 'string' &&
    typeof value['heroClass'] === 'string'
  );
}

function isFactionMap(value: Json): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((e) => (Array.isArray(e) ? e.every(isPhantimalHero) : isPhantimalHero(e)));
}
