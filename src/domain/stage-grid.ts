import { isApex, STAGE_KINDS, type StageKind } from './stage.js';

/** The phases of a season, one tab of the Stages grid each. */
export const GRID_PHASES = [1, 2, 3] as const;

/**
 * How many boxes of a lane each phase holds. The Apex split is confirmed in the game and may become 334 and 666: change it here.
 * Normal and Phantisomal numbers run on across the phases; Apex numbers restart in every phase.
 */
const LANE_SIZE: Record<StageKind, number> = { Normal: 300, Phantisomal: 600, 'Apex Normal': 333, 'Apex Phantisomal': 667 };

/** A stage the grid has a record for: the aggregate of the stage rows of one kind, phase (0 for the standard kinds) and number across seasons. */
export interface GridBox {
  kind: StageKind;
  phase: number;
  number: number;
  /** `cleared`: a stage of the current season has an attempt; `older`: only an earlier season's has. */
  state: 'cleared' | 'older';
  newestSeason: number;
}
export type BoxState = GridBox['state'] | 'none';

interface LaneBox {
  number: number;
  state: BoxState;
  newestSeason: number | null;
}

export interface Lane {
  kind: StageKind;
  phase: number;
  /** The numbers the lane normally holds; the lane runs past `last` when a record is beyond it. */
  first: number;
  last: number;
  boxes: LaneBox[];
  /** Cleared this season. */
  cleared: number;
  /** With a record of any season. */
  recorded: number;
  /** The last box of the normal range is cleared this season. */
  complete: boolean;
}

export const laneId = (kind: StageKind) => kind.toLowerCase().replace(/ /g, '-');
export const kindOfLaneId = (id: string) => STAGE_KINDS.find((k) => laneId(k) === id);

/** The phase a standard stage number belongs to; a number beyond the last phase's range stays in the last. */
export function standardPhase(kind: StageKind, number: number): number {
  return Math.min(GRID_PHASES.length, Math.max(1, Math.ceil(number / LANE_SIZE[kind])));
}

/** The phase tab a box shows under: its own for Apex, the one its number falls in for the standard kinds. */
export const phaseOf = (box: Pick<GridBox, 'kind' | 'phase' | 'number'>) => (isApex(box.kind) ? box.phase : standardPhase(box.kind, box.number));

/** The numbers a lane normally holds in a phase. */
export function laneRange(kind: StageKind, phase: number): { first: number; last: number } {
  const size = LANE_SIZE[kind];
  return isApex(kind) ? { first: 1, last: size } : { first: (phase - 1) * size + 1, last: phase * size };
}

export function buildLane(kind: StageKind, phase: number, boxes: GridBox[]): Lane {
  const { first, last } = laneRange(kind, phase);
  const mine = new Map(boxes.filter((b) => b.kind === kind && phaseOf(b) === phase).map((b) => [b.number, b]));
  const highest = Math.max(last, ...mine.keys());
  const lane: LaneBox[] = [];
  for (let number = first; number <= highest; number++) {
    const box = mine.get(number);
    lane.push({ number, state: box?.state ?? 'none', newestSeason: box?.newestSeason ?? null });
  }
  return {
    kind,
    phase,
    first,
    last,
    boxes: lane,
    cleared: lane.filter((b) => b.state === 'cleared').length,
    recorded: lane.filter((b) => b.state !== 'none').length,
    complete: lane.find((b) => b.number === last)?.state === 'cleared',
  };
}

/** The phase the page opens on: the highest with a record of the current season, else the first. */
export const defaultPhase = (boxes: GridBox[]): number => Math.max(1, ...boxes.filter((b) => b.state === 'cleared').map(phaseOf));

/**
 * Whether a lane is open when the page opens. A standard lane is open until its last box is cleared this season. An Apex lane is
 * closed until it has a record of the current season of its own, or both standard lanes of its phase are complete.
 */
export function openByDefault(lane: Lane, standard: { normal: Lane; phantisomal: Lane }): boolean {
  if (!isApex(lane.kind)) return !lane.complete;
  return lane.cleared > 0 || (standard.normal.complete && standard.phantisomal.complete);
}

/** The lane key of a lane of a phase, as the page address keeps it. */
export const laneKey = (phase: number, kind: StageKind) => `${phase}:${laneId(kind)}`;

/** Where the panel of a clicked box goes in a grid `columns` wide: after the last box of the clicked box's row. */
export function panelAfter(index: number, columns: number, total: number): number {
  return Math.min(total, (Math.floor(index / Math.max(1, columns)) + 1) * Math.max(1, columns)) - 1;
}
