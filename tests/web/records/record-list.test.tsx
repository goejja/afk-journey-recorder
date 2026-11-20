// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGroupedList, type Groupable } from '../../../web/records/GroupedList.js';
import { RecordListView } from '../../../web/records/RecordListView.js';
import { PAGE, useRecordList } from '../../../web/records/useRecordList.js';

afterEach(cleanup);

describe('useRecordList', () => {
  it('asks for a page of fights, and for one more page each time the list is told to show more', async () => {
    const load = vi.fn((limit: number) => Promise.resolve(Array.from({ length: 2 }, (_, i) => ({ id: i, limit }))));
    const { result } = renderHook(() => useRecordList({ load, deps: [], formOpen: false }));
    await waitFor(() => expect(result.current.loaded.data).toHaveLength(2));
    expect(load).toHaveBeenLastCalledWith(PAGE);
    act(() => result.current.showMore());
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(PAGE * 2));
  });

  it('asks again when a filter changes', async () => {
    const load = vi.fn(() => Promise.resolve([]));
    const { rerender } = renderHook(({ boss }) => useRecordList({ load, deps: [boss], formOpen: false }), { initialProps: { boss: 'a' } });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    rerender({ boss: 'b' });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('drops the notice when a form opens, and keeps it after the form closes', async () => {
    const { result, rerender } = renderHook(({ open }) => useRecordList({ load: () => Promise.resolve([]), deps: [], formOpen: open }), { initialProps: { open: true } });
    act(() => result.current.setNotice('Saved. The roster could not be updated.'));
    rerender({ open: false });
    expect(result.current.notice).toBe('Saved. The roster could not be updated.');
    rerender({ open: true });
    expect(result.current.notice).toBeNull();
  });

  it('shows the error of an action, and an answer of the list clears it', async () => {
    const { result } = renderHook(() => useRecordList({ load: () => Promise.resolve([{ id: 1 }]), deps: [], formOpen: false }));
    await waitFor(() => expect(result.current.loaded.data).toBeDefined());
    await act(async () => void (await result.current.run(() => Promise.reject(new Error('A record uses it')))));
    expect(result.current.error).toBe('A record uses it');
    await act(async () => result.current.loaded.reload());
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('shows why the list could not be read', async () => {
    const { result } = renderHook(() => useRecordList({ load: () => Promise.reject(new Error('Server down')), deps: [], formOpen: false }));
    await waitFor(() => expect(result.current.error).toBe('Server down'));
  });
});

interface Fight extends Groupable {
  id: number;
}

function View({ fights, answered = true, ...rest }: { fights: Fight[]; answered?: boolean; error?: string | null; notice?: string | null; older?: boolean; onOlder?: () => void }) {
  const list = useGroupedList(fights);
  const loaded = { data: answered ? fights : undefined, error: null, loading: false, reload: async () => undefined, setData: () => {} };
  return (
    <RecordListView
      list={list}
      loaded={loaded}
      error={rest.error ?? null}
      notice={rest.notice ?? null}
      label="Boss fights"
      battle="day"
      fight="fight"
      renderItem={(item) => <li key={item.kind === 'fight' ? item.fight.id : item.id}>{item.kind === 'fight' ? `Fight ${item.fight.id}` : 'Day'}</li>}
      older={rest.older ?? false}
      olderLabel="Show older fights"
      onOlder={rest.onOlder ?? (() => {})}
      empty={fights.length === 0}
      filtered={false}
      none="No boss fights recorded yet."
      noMatch="No boss fights match these filters."
    />
  );
}

const fight = (id: number): Fight => ({ id, battleId: null, battlePosition: null, createdAt: '2026-11-16 10:00:00' });

describe('RecordListView', () => {
  it('draws the cards under the label, and nothing about an empty list', () => {
    render(<View fights={[fight(1), fight(2)]} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Fight 1', 'Fight 2']);
    expect(screen.queryByText('No boss fights recorded yet.')).toBeNull();
  });

  it('says what an empty list says, and Loading… before the first answer', () => {
    const { rerender } = render(<View fights={[]} />);
    expect(screen.getByText('No boss fights recorded yet.')).toBeTruthy();
    rerender(<View fights={[]} answered={false} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows the error and the notice as alerts, and the older button only when there are older fights', () => {
    const onOlder = vi.fn();
    const { rerender } = render(<View fights={[fight(1)]} error="Could not delete" notice="Saved. The roster could not be updated." />);
    // the notice is drawn as an error too: it says what a Save left undone
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Could not delete', 'Saved. The roster could not be updated.']);
    expect(screen.queryByRole('button', { name: 'Show older fights' })).toBeNull();
    rerender(<View fights={[fight(1)]} older onOlder={onOlder} />);
    screen.getByRole('button', { name: 'Show older fights' }).click();
    expect(onOlder).toHaveBeenCalledTimes(1);
  });
});
