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
  const view = render(<HeroStateButtons name="Fay" tier="S" rank={rank} level={level} rules={rules} unknown={unknown} onChange={onChange} />);
  return { onChange, view };
};
const button = () => screen.getByRole('button', { name: /^Rank and equipment of Fay/ });

describe('HeroStateButtons', () => {
  it('shows the rank with the equipment under it in one button, and no equipment line for a rank without equipment', () => {
    show('Mythic+', 10);
    expect(button().getAttribute('aria-label')).toBe('Rank and equipment of Fay: Mythic+, +10');
    expect(button().textContent).toContain('+10');
    cleanup();
    show('Mythic+', null);
    expect(button().getAttribute('aria-label')).toBe('Rank and equipment of Fay: Mythic+, no equipment');
    expect(button().textContent).toContain('No equipment');
    cleanup();
    show('Epic', null);
    expect(button().getAttribute('aria-label')).toBe('Rank and equipment of Fay: Epic');
    expect(button().textContent).not.toContain('equipment');
  });

  it('opens both lists in one popover, which stays open after a pick and closes on a second click', async () => {
    const user = userEvent.setup();
    const { onChange } = show('Mythic+', 10);
    await user.click(button());
    expect(screen.getByRole('group', { name: 'Rank and equipment of Fay' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Rank of Fay' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Equipment of Fay' })).toBeTruthy();
    await user.click(within(screen.getByRole('group', { name: 'Equipment of Fay' })).getByRole('button', { name: /^\+5/ }));
    expect(onChange).toHaveBeenCalledWith('Mythic+', 5);
    expect(screen.getByRole('group', { name: 'Rank and equipment of Fay' })).toBeTruthy();
    await user.click(button());
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('moves the equipment into what a new rank allows', async () => {
    const user = userEvent.setup();
    const { onChange } = show('Supreme', 15);
    await user.click(button());
    await user.click(within(screen.getByRole('group', { name: 'Rank of Fay' })).getByRole('button', { name: 'Mythic+' }));
    expect(onChange).toHaveBeenCalledWith('Mythic+', 10);
    await user.click(within(screen.getByRole('group', { name: 'Rank of Fay' })).getByRole('button', { name: 'Epic' }));
    expect(onChange).toHaveBeenLastCalledWith('Epic', null);
  });

  it('writes the unknown rank, and offers it, only when it is given', async () => {
    const user = userEvent.setup();
    const { onChange } = show(null, null, 'Rank unknown');
    expect(button().getAttribute('aria-label')).toBe('Rank and equipment of Fay: not set');
    expect(button().textContent).toBe('Rank unknown');
    await user.click(button());
    expect(within(screen.getByRole('group', { name: 'Rank of Fay' })).getByRole('button', { name: 'Rank unknown' })).toBeTruthy();
    await user.click(within(screen.getByRole('group', { name: 'Rank of Fay' })).getByRole('button', { name: 'Epic' }));
    expect(onChange).toHaveBeenCalledWith('Epic', null);
    cleanup();
    show(null, null);
    expect(button().textContent).toBe('Not set');
    await user.click(button());
    expect(within(screen.getByRole('group', { name: 'Rank of Fay' })).queryByRole('button', { name: 'Rank unknown' })).toBeNull();
  });
});
