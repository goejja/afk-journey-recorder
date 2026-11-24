// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatsTable, type Column } from '../../../web/stats/StatsTable.js';

afterEach(cleanup);

interface Row {
  name: string;
  games: number;
  wins: number;
}
const rows: Row[] = [{ name: 'Evie', games: 10, wins: 7 }];
const key = (r: Row) => r.name;

describe('StatsTable', () => {
  it('draws its rows again only when what it was given changes', () => {
    const drawn = vi.fn((r: Row) => r.name);
    const columns: Column<Row>[] = [{ key: 'name', header: 'Name', value: (r) => r.name, render: drawn }];
    const { rerender } = render(<StatsTable rows={rows} columns={columns} rowKey={key} />);
    expect(screen.getByText('Evie')).toBeTruthy();
    const first = drawn.mock.calls.length;

    rerender(<StatsTable rows={rows} columns={columns} rowKey={key} />); // the page rendered for another reason
    expect(drawn).toHaveBeenCalledTimes(first);

    rerender(<StatsTable rows={[...rows]} columns={columns} rowKey={key} />); // new rows arrived
    expect(drawn.mock.calls.length).toBeGreaterThan(first);
  });
});
