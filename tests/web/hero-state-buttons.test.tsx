// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeroStateButtons } from '../../web/ui/HeroStateButtons.js';

const rules = {
  ranks: ['Rare', 'Elite', 'Epic', 'Mythic+', 'Supreme'],
  equipmentLevels: [0, 5, 10, 15],
  caps: [
    { rank: 'Mythic+', minLevel: null, maxLevel: 10 },
    { rank: 'Supreme', minLevel: null, maxLevel: 15 },
  ],
};
afterEach(cleanup);

const show = (rank: string | null, level: number | null, unknown?: string) => {
  const onChange = vi.fn();
  render(<HeroStateButtons name="Fay" tier="S" rank={rank} level={level} rules={rules} unknown={unknown} onChange={onChange} />);
  return onChange;
};

describe('HeroStateButtons', () => {
  it('shows the rank and the equipment as two buttons, and no equipment button for a rank without equipment', () => {
    show('Mythic+', 10);
    expect(screen.getByRole('button', { name: 'Rank of Fay: Mythic+' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Equipment of Fay: +10' })).toBeTruthy();
    cleanup();
    show('Epic', null);
    expect(screen.queryByRole('button', { name: /^Equipment of Fay/ })).toBeNull();
  });

  it('opens the list of one value at a time, closes it on a second click, and closes it on a pick', async () => {
    const user = userEvent.setup();
    const onChange = show('Mythic+', 10);
    await user.click(screen.getByRole('button', { name: /^Rank of Fay/ }));
    expect(screen.getByRole('group', { name: 'Rank of Fay' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Equipment of Fay/ }));
    expect(screen.queryByRole('group', { name: 'Rank of Fay' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Equipment of Fay' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Equipment of Fay/ }));
    expect(screen.queryByRole('group', { name: 'Equipment of Fay' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Equipment of Fay/ }));
    await user.click(within(screen.getByRole('group', { name: 'Equipment of Fay' })).getByRole('button', { name: /^\+5/ }));
    expect(onChange).toHaveBeenCalledWith('Mythic+', 5);
    expect(screen.queryByRole('group', { name: 'Equipment of Fay' })).toBeNull();
  });

  it('moves the equipment into what a new rank allows', async () => {
    const user = userEvent.setup();
    const onChange = show('Supreme', 15);
    await user.click(screen.getByRole('button', { name: /^Rank of Fay/ }));
    await user.click(within(screen.getByRole('group', { name: 'Rank of Fay' })).getByRole('button', { name: 'Mythic+' }));
    expect(onChange).toHaveBeenCalledWith('Mythic+', 10);
    await user.click(screen.getByRole('button', { name: /^Rank of Fay/ }));
    await user.click(within(screen.getByRole('group', { name: 'Rank of Fay' })).getByRole('button', { name: 'Epic' }));
    expect(onChange).toHaveBeenLastCalledWith('Epic', null);
  });

  it('writes the unknown rank, and offers it, only when it is given', async () => {
    const user = userEvent.setup();
    const onChange = show(null, null, 'Rank unknown');
    expect(screen.getByRole('button', { name: 'Rank of Fay: not set' }).textContent).toBe('Rank unknown');
    await user.click(screen.getByRole('button', { name: /^Rank of Fay/ }));
    await user.click(within(screen.getByRole('group', { name: 'Rank of Fay' })).getByRole('button', { name: 'Epic' }));
    expect(onChange).toHaveBeenCalledWith('Epic', null);
    cleanup();
    show(null, null);
    expect(screen.getByRole('button', { name: 'Rank of Fay: not set' }).textContent).toBe('Not set');
  });
});
