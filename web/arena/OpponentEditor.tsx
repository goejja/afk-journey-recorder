import type { ArenaFight, Hero, OpponentInput } from '../backend.js';
import { isSummon } from '../../src/domain/units.js';
import { addHeroUnits, type PlacedRow } from '../units.js';

export interface OpponentState {
  placed: (PlacedRow & { rank: string; equipment: string })[];
  assist: { hero: string; rank: string; equipment: string };
  phantimal: { tile: number; name: string; partnerTile?: number | null } | null;
  /** The Phantimal the player chose; it stands only while the team meets its Faction Requirement (ADR 0029). */
  phantimalChoice?: string;
  artifact: string;
  formationId: string;
}

export const emptyOpponent = (): OpponentState => ({
  placed: [],
  assist: { hero: '', rank: '', equipment: '' },
  phantimal: null,
  phantimalChoice: '',
  artifact: '',
  formationId: '',
});

/** The editor state for an opponent already saved, so a record can be edited. */
export const opponentFromRecord = (o: ArenaFight['opponent']): OpponentState => ({
  placed: o.heroes.map((h) => ({ tile: h.tile, hero: h.name, ...(h.part ? { part: h.part } : {}), rank: h.rank ?? '', equipment: h.equipmentLevel === null ? '' : String(h.equipmentLevel) })),
  assist: o.assist
    ? { hero: o.assist.name, rank: o.assist.rank ?? '', equipment: o.assist.equipmentLevel === null ? '' : String(o.assist.equipmentLevel) }
    : { hero: '', rank: '', equipment: '' },
  phantimal: o.phantimal ?? null,
  phantimalChoice: o.phantimal?.name ?? '',
  artifact: o.artifact ?? '',
  formationId: o.formationId ?? '',
});

export const toOpponentPayload = (s: OpponentState): OpponentInput => ({
  heroes: s.placed.map((p) => ({ tile: p.tile, hero: p.hero, ...(p.part ? { part: p.part } : {}), rank: p.rank || null, equipmentLevel: p.equipment === '' ? null : Number(p.equipment) })),
  assistHero: s.assist.hero || null,
  assistRank: s.assist.hero ? s.assist.rank || null : null,
  assistEquipmentLevel: s.assist.hero && s.assist.equipment !== '' ? Number(s.assist.equipment) : null,
  phantimal: s.phantimal,
  artifact: s.artifact || null,
  formationId: s.formationId || null,
});

/** The same for Side B: its placed heroes take the roster's rank and equipment (see withRosterStates). */
export function withRosterOpponent(value: OpponentState, heroes: Hero[], overwrite: boolean): OpponentState {
  let changed = false;
  const placed = value.placed.map((p) => {
    const roster = isSummon(p) ? undefined : heroes.find((h) => h.name === p.hero && h.owned && h.rank);
    if (!roster || (!overwrite && (p.rank !== '' || p.equipment !== ''))) return p;
    const equipment = roster.equipmentLevel === null ? '' : String(roster.equipmentLevel);
    if (p.rank === roster.rank && p.equipment === equipment) return p;
    changed = true;
    return { ...p, rank: roster.rank!, equipment };
  });
  return changed ? { ...value, placed } : value;
}

/**
 * Adds every Unit of a hero to Side B at once, as placeWholeHero does for Side A (ADR 0028). The parts of a pair share the
 * rank and equipment the first one gets.
 */
export function placeWholeOpponent(value: OpponentState, hero: string, tile: number, cells: number[], zone: number, occupied: (tile: number) => boolean): { value: OpponentState; message: string | null } {
  const result = addHeroUnits(value.placed, hero, tile, cells, zone, occupied, (row, siblings) => ({ ...row, rank: siblings[0]?.rank ?? '', equipment: siblings[0]?.equipment ?? '' }));
  if (result.message || result.placed === value.placed) return { value, message: result.message };
  return {
    value: { ...value, placed: result.placed, assist: value.assist.hero === hero ? { hero: '', rank: '', equipment: '' } : value.assist },
    message: null,
  };
}
