import { TILE } from '../src/domain/map.js';
import type { FormationState } from './FormationEditor.js';
import type { OpponentState } from './arena/OpponentEditor.js';
import { firstFreeTile } from './units.js';

type Unit = { tile: number };

/**
 * Carries both teams over to another map. A unit that stands on a deployment tile of its own side stays where it
 * is; any other goes to the lowest free tile of its side, and is dropped only when that side has no tile left.
 * Everything else a team holds (ranks, equipment, artifact, phantimal, assist) is untouched.
 */
export function keepOnMap(cells: number[], formation: FormationState, opponent: OpponentState): { formation: FormationState; opponent: OpponentState } {
  const taken = new Set<number>();
  // A phantimal pair's second part is a unit of its own: it can be left without a tile while the first part stays.
  const partnerOf = (p: { partnerTile?: number | null } | null) => (p && p.partnerTile != null ? { tile: p.partnerTile } : null);
  const partners = { player: partnerOf(formation.phantimal), enemy: partnerOf(opponent.phantimal) };
  const sides = [
    { zone: TILE.PLAYER, units: [...formation.placed, ...(formation.phantimal ? [formation.phantimal] : []), ...(partners.player ? [partners.player] : [])] as Unit[] },
    { zone: TILE.ENEMY, units: [...opponent.placed, ...(opponent.phantimal ? [opponent.phantimal] : []), ...(partners.enemy ? [partners.enemy] : [])] as Unit[] },
  ];
  // Units already in place first, so that a relocated unit never takes a tile another unit keeps.
  for (const { zone, units } of sides) for (const u of units) if (cells[u.tile] === zone) taken.add(u.tile);
  const moved = new Map<Unit, number | null>();
  for (const { zone, units } of sides) {
    for (const u of units) {
      if (cells[u.tile] === zone) continue;
      const tile = firstFreeTile(cells, zone, (t) => taken.has(t));
      if (tile !== null) taken.add(tile);
      moved.set(u, tile);
    }
  }
  const carry = <T extends Unit>(u: T): T | null => {
    if (!moved.has(u)) return u;
    const tile = moved.get(u)!;
    return tile === null ? null : { ...u, tile };
  };
  const carryAll = <T extends Unit>(units: T[]) => units.map(carry).filter((u): u is T => u !== null);
  const carryPhantimal = <T extends { tile: number; partnerTile?: number | null }>(p: T | null, partner: Unit | null): T | null => {
    const main = p ? carry(p) : null;
    if (!main) return null;
    return partner ? { ...main, partnerTile: carry(partner)?.tile ?? null } : main;
  };
  return {
    formation: { ...formation, placed: carryAll(formation.placed), phantimal: carryPhantimal(formation.phantimal, partners.player) },
    opponent: { ...opponent, placed: carryAll(opponent.placed), phantimal: carryPhantimal(opponent.phantimal, partners.enemy) },
  };
}
