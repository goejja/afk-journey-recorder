import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { isSmallSample } from '../../src/domain/stats.js';
import { Portrait } from '../Portrait.js';
import { percent, toggled } from '../format.js';
import { DisclosureMark } from '../ui/Icon.js';

export function WinBar({ wins, games }: { wins: number; games: number }) {
  const rate = games === 0 ? 0 : wins / games;
  return (
    <span className="winbar" role="img" aria-label={`${percent(rate)} of ${games}`}>
      <span className="winbar-fill" style={{ width: percent(rate) }} />
    </span>
  );
}

export interface Column<Row> {
  key: string;
  header: string;
  value: (row: Row) => number | string;
  render?: (row: Row) => ReactNode;
}

/** A table whose columns sort on a click; rows with a small sample are dimmed and flagged. */
export function StatsTable<Row extends { games: number; wins: number }>({ rows, columns, rowKey, detail, label }: {
  /** Names the table for screen readers, when a page holds several. */
  label?: string;
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  /** Rows that open on a click of their first cell, closed at first: the label of the opened region and what it holds. */
  detail?: { label: (row: Row) => string; render: (row: Row) => ReactNode };
}) {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen((old) => toggled(old, key));
  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort?.key);
    if (!column || !sort) return rows;
    return [...rows].sort((a, b) => {
      const x = column.value(a);
      const y = column.value(b);
      const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.descending ? -order : order;
    });
  }, [rows, columns, sort]);

  if (rows.length === 0) return <p className="muted">Nothing to show with these filters.</p>;
  return (
    <table className="data-table" aria-label={label}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} aria-sort={sort?.key === c.key ? (sort.descending ? 'descending' : 'ascending') : undefined}>
              <button className="link" onClick={() => setSort({ key: c.key, descending: sort?.key === c.key ? !sort.descending : true })}>
                {c.header}
              </button>
            </th>
          ))}
          <th>Win rate</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => {
          const key = rowKey(row);
          const opened = detail !== undefined && open.has(key);
          return (
            <Fragment key={key}>
              <tr className={isSmallSample(row.games) ? 'low' : undefined}>
                {columns.map((c, i) => {
                  const cell = c.render ? c.render(row) : c.value(row);
                  return (
                    <td key={c.key}>
                      {detail && i === 0 ? (
                        <button className="link" aria-expanded={opened} onClick={() => toggle(key)}>
                          <DisclosureMark open={opened} /> {cell}
                        </button>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
                <td>
                  <WinBar wins={row.wins} games={row.games} />
                  {isSmallSample(row.games) && <span className="badge few"> few games</span>}
                </td>
              </tr>
              {opened && (
                <tr>
                  <td colSpan={columns.length + 1}>
                    <div role="region" aria-label={detail.label(row)}>
                      {detail.render(row)}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export const heroCell = (name: string) => (
  <span className="unit-inline">
    <Portrait kind="hero" name={name} size={24} /> {name}
  </span>
);

export const rateColumns = <Row extends { games: number; wins: number; winRate: number }>(): Column<Row>[] => [
  { key: 'games', header: 'Games', value: (r) => r.games },
  { key: 'wins', header: 'Wins', value: (r) => r.wins },
  { key: 'winRate', header: 'Rate', value: (r) => r.winRate, render: (r) => percent(r.winRate) },
];
