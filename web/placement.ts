import type { DragEvent } from 'react';
import { firstFreeTile, missingPhantimalPart, phantimalAt, withPartnerOn, withPhantimalPart, type PlacedPhantimal } from './units.js';
import { moveQuestion, type Borrow } from './arena/borrow.js';
import type { useConfirm } from './ui/Dialog.js';

/**
 * Puts a phantimal part on a tile. A pair's second part goes on the next free tile of the zone, to be moved from there if it
 * should stand elsewhere. `next` is the part still to be placed (a pair stands together), or null.
 */
export function placePhantimalPart(
  cells: number[],
  zone: number,
  current: PlacedPhantimal | null,
  name: string,
  index: number,
  occupied: (tile: number) => boolean,
): { phantimal: PlacedPhantimal; next: string | null } {
  const first = withPhantimalPart(current, name, index);
  const phantimal = withPartnerOn(first, firstFreeTile(cells, zone, (t) => t === index || occupied(t) || phantimalAt(first, t) !== undefined));
  return { phantimal, next: missingPhantimalPart(phantimal) };
}

/**
 * Whether a drag may end on a tile. An icon from the picker goes on a free tile; a placed unit goes on a free tile of its own
 * side, or swaps places with a unit of its own side. `zone` is the side the tile belongs to and `sideOfTile` the side of the unit on it.
 */
export function canDropOnTile<S>(drag: { zone: S | null; moving: number | null; movingSide: S | null; sideOfTile: S | null; dragging: boolean; occupied: boolean }): boolean {
  const { zone, moving, movingSide, sideOfTile, dragging, occupied } = drag;
  if (zone === null) return false;
  if (moving !== null) return zone === movingSide && (sideOfTile === null || sideOfTile === movingSide);
  return dragging && !occupied;
}

/**
 * Asks whether to take a hero from the team that holds it, and lets it go when the answer is yes. The caller places the hero
 * from the state it has after the question, not from the state it had when the player clicked.
 */
export async function confirmBorrowedMove(confirm: ReturnType<typeof useConfirm>['confirm'], borrow: Borrow, hero: string, holder: string): Promise<boolean> {
  const yes = await confirm({ title: `Move this ${borrow.noun}?`, message: moveQuestion(hero, holder, borrow.noun), confirmLabel: 'Move' });
  if (yes) borrow.releaseHero(hero);
  return yes;
}

/** The drag handlers of a chip that carries a name onto the map; `report` hears the name while it is dragged and null at the end. */
export const dragProps = (name: string, report: ((name: string | null) => void) | undefined) => ({
  draggable: Boolean(report),
  onDragStart: (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', name); // Firefox starts no drag without data
    e.dataTransfer.effectAllowed = 'copy';
    report?.(name);
  },
  onDragEnd: () => report?.(null),
});
