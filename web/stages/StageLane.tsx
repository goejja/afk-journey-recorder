import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { laneId, panelAfter, type Lane } from '../../src/domain/stage-grid.js';
import { isApex } from '../../src/domain/stage.js';

interface Props {
  lane: Lane;
  open: boolean;
  /** The current season, named on a lane that is cleared. */
  season: number;
  selected: number | null;
  flashed: number | null;
  onToggle: () => void;
  onSelect: (number: number) => void;
  /** The panel of the selected box, drawn under that box's row. */
  panel: ReactNode;
}

const BOX_LABEL = { cleared: 'cleared this season', older: 'cleared in an older season', none: 'no record' } as const;

/** How many boxes fit on a row of the grid, read from the browser's layout and kept up to date as the window changes. */
function useColumns(open: boolean) {
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => setColumns(Math.max(1, getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);
  return { grid, columns };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={open ? 'chevron open' : 'chevron'} viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
      <path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** One lane of a phase: a header that opens and closes it, and a grid of one box per stage number. */
export function StageLane({ lane, open, season, selected, flashed, onToggle, onSelect, panel }: Props) {
  const { grid, columns } = useColumns(open);
  const apex = isApex(lane.kind);
  const highest = lane.boxes[lane.boxes.length - 1]!.number;
  const range = `${lane.first}–${lane.last}${highest > lane.last ? `, plus ${lane.last + 1}–${highest}` : ''}`;
  const summary = apex ? `${lane.recorded} recorded` : !open && lane.complete ? `Cleared · Season ${season}` : `${lane.cleared} cleared`;
  const at = selected === null ? -1 : lane.boxes.findIndex((b) => b.number === selected);
  const after = at < 0 ? -1 : panelAfter(at, columns, lane.boxes.length);

  return (
    <section className="stage-lane" aria-label={lane.kind}>
      <button className="stage-lane-head" aria-expanded={open} onClick={onToggle}>
        <Chevron open={open} />
        <strong>
          {lane.kind} · {range}
          {open ? '' : ' · Collapsed'}
        </strong>
        <span className="muted">{summary}</span>
      </button>
      {open && (
        <div className="stage-grid" ref={grid}>
          {lane.boxes.map((b, i) => (
            <Fragment key={b.number}>
              <button
                id={`box-${laneId(lane.kind)}-${b.number}`}
                className={`stage-box ${b.state}${b.number === selected ? ' selected' : ''}${b.number === flashed ? ' flash' : ''}`}
                aria-pressed={b.number === selected}
                aria-label={`${lane.kind} stage ${b.number}, ${BOX_LABEL[b.state]}`}
                onClick={() => onSelect(b.number)}
              >
                {b.number}
              </button>
              {i === after && panel}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
