// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EquipmentOptions, RankOptions } from '../../web/ui/HeroStateOptions.js';

const rules = {
  ranks: ['Rare', 'Elite', 'Epic', 'Mythic+', 'Supreme'],
  equipmentLevels: [0, 5, 10, 15],
  caps: [
    { rank: 'Mythic+', minLevel: null, maxLevel: 10 },
    { rank: 'Supreme', minLevel: null, maxLevel: 15 },
  ],
};
const names = () => screen.getAllByRole('button').map((b) => b.textContent);
afterEach(cleanup);

describe('RankOptions', () => {
  it('lists the ranks the tier allows, highest first', () => {
    render(<RankOptions tier="S" rank="Epic" rules={rules} onPick={() => {}} />);
    expect(names()).toEqual(['Supreme', 'Mythic+', 'Epic']);
    expect(screen.getByRole('button', { name: 'Epic' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a disabled "Not set" at the top for a hero with no rank, unless the unknown rank is an entry to pick', () => {
    const { unmount } = render(<RankOptions tier="S" rank={null} rules={rules} onPick={() => {}} />);
    expect(names()).toEqual(['Not set', 'Supreme', 'Mythic+', 'Epic']);
    expect((screen.getByRole('button', { name: 'Not set' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    render(<RankOptions tier="S" rank={null} rules={rules} unknown="Rank unknown" onPick={() => {}} />);
    expect(names()).toEqual(['Supreme', 'Mythic+', 'Epic', 'Rank unknown']);
    expect(screen.getByRole('button', { name: 'Rank unknown' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps a stored rank the tier would not offer, so an old record still shows it', () => {
    render(<RankOptions tier="S" rank="Elite" rules={rules} onPick={() => {}} />);
    expect(names()).toEqual(['Elite', 'Supreme', 'Mythic+', 'Epic']);
    expect(screen.getByRole('button', { name: 'Elite' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('offers only Rare to a starting hero', () => {
    render(<RankOptions tier="R" rank="Rare" rules={rules} onPick={() => {}} />);
    expect(names()).toEqual(['Rare']);
  });

  it('reports the rank picked, and null for the unknown rank', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<RankOptions tier="S" rank="Epic" rules={rules} unknown="Rank unknown" onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: 'Mythic+' }));
    await user.click(screen.getByRole('button', { name: 'Rank unknown' }));
    expect(onPick.mock.calls).toEqual([['Mythic+'], [null]]);
  });
});

describe('EquipmentOptions', () => {
  it('lists the levels the rank allows, highest first, then None', () => {
    render(<EquipmentOptions rank="Mythic+" level={5} rules={rules} onPick={() => {}} />);
    expect(names()).toEqual(['+10 ★★★', '+5 ★★', '+0 ★', 'None']);
    expect(screen.getByRole('button', { name: '+5 ★★' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('offers only None to a rank without equipment', () => {
    render(<EquipmentOptions rank="Epic" level={null} rules={rules} onPick={() => {}} />);
    expect(names()).toEqual(['None']);
    expect(screen.getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('reports the level picked, and null for None', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<EquipmentOptions rank="Supreme" level={null} rules={rules} onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: '+15 ★★★★' }));
    await user.click(screen.getByRole('button', { name: 'None' }));
    expect(onPick.mock.calls).toEqual([[15], [null]]);
  });
});
