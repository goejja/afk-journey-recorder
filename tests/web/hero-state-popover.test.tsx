// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeroStatePopover, StateTag, stateText } from '../../web/HeroStatePopover.js';

const rules = {
  ranks: ['Rare', 'Elite', 'Epic', 'Mythic+', 'Supreme'],
  equipmentLevels: [0, 5, 10, 15],
  caps: [
    { rank: 'Mythic+', minLevel: null, maxLevel: 10 },
    { rank: 'Supreme', minLevel: null, maxLevel: 15 },
  ],
};
afterEach(cleanup);

function open(rank: string, equipment: string, onChange = vi.fn(), tier: string | null = 'S') {
  const anchor = document.body.appendChild(document.createElement('button'));
  render(<HeroStatePopover anchor={anchor} name="Evie" tier={tier} rank={rank} equipment={equipment} rules={rules} onChange={onChange} onClose={() => {}} />);
  return { onChange, rank: within(screen.getByRole('group', { name: 'Rank of Evie' })), equipment: within(screen.getByRole('group', { name: 'Equipment of Evie' })) };
}

describe('HeroStatePopover', () => {
  it('shows the rank and the equipment lists side by side, with the current values pressed', () => {
    const p = open('Mythic+', '5');
    expect(p.rank.getAllByRole('button').map((b) => b.textContent)).toEqual(['Supreme', 'Mythic+', 'Epic', 'Rank unknown']);
    expect(p.rank.getByRole('button', { name: 'Mythic+' }).getAttribute('aria-pressed')).toBe('true');
    expect(p.equipment.getByRole('button', { name: /^\+5/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('offers no unknown rank when it is asked for none, and names it as asked otherwise', () => {
    const anchor = document.body.appendChild(document.createElement('button'));
    render(<HeroStatePopover anchor={anchor} name="Evie" tier="S" rank="Mythic+" equipment="5" rules={rules} unknown={null} onChange={() => {}} onClose={() => {}} />);
    expect(within(screen.getByRole('group', { name: 'Rank of Evie' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Supreme', 'Mythic+', 'Epic']);
    cleanup();
    render(<HeroStatePopover anchor={anchor} name="Evie" tier="S" rank="Mythic+" equipment="5" rules={rules} unknown="No rank" onChange={() => {}} onClose={() => {}} />);
    expect(within(screen.getByRole('group', { name: 'Rank of Evie' })).getByRole('button', { name: 'No rank' })).toBeTruthy();
  });

  it('moves the equipment into what a new rank allows when a rank is picked', async () => {
    const p = open('Supreme', '15');
    await userEvent.setup().click(p.rank.getByRole('button', { name: 'Mythic+' }));
    expect(p.onChange).toHaveBeenCalledWith('Mythic+', '10');
  });

  it('clears the equipment when a rank without equipment is picked, and the rank when unknown is picked', async () => {
    const user = userEvent.setup();
    const p = open('Mythic+', '10');
    await user.click(p.rank.getByRole('button', { name: 'Epic' }));
    await user.click(p.rank.getByRole('button', { name: 'Rank unknown' }));
    expect(p.onChange.mock.calls).toEqual([['Epic', ''], ['', '']]);
  });

  it('keeps the rank and sets the level when an equipment level, or None, is picked', async () => {
    const user = userEvent.setup();
    const p = open('Mythic+', '5');
    await user.click(p.equipment.getByRole('button', { name: /^\+10/ }));
    await user.click(p.equipment.getByRole('button', { name: 'None' }));
    expect(p.onChange.mock.calls).toEqual([['Mythic+', '10'], ['Mythic+', '']]);
  });

  it('says so, instead of listing equipment, when the rank allows none', () => {
    const p = open('Epic', '');
    expect(p.equipment.queryAllByRole('button')).toHaveLength(0);
    expect(p.equipment.getByText('None at this rank')).toBeTruthy();
  });

  it('keeps a stored rank the tier would not offer, and offers a starting hero only Rare', () => {
    expect(open('Elite', '').rank.getByRole('button', { name: 'Elite' }).getAttribute('aria-pressed')).toBe('true');
    cleanup();
    expect(open('Rare', '', vi.fn(), 'R').rank.getAllByRole('button').map((b) => b.textContent)).toEqual(['Rare', 'Rank unknown']);
  });
});

describe('StateTag', () => {
  it('writes the short rank and the equipment, "?" for an unknown rank, and no equipment when there is none', () => {
    const { container, rerender } = render(<StateTag rank="Paragon 2" equipment={27} />);
    expect(container.textContent).toBe('P2★R2');
    rerender(<StateTag rank={null} equipment={null} />);
    expect(container.textContent).toBe('?');
    rerender(<StateTag rank="Epic" equipment={null} />);
    expect(container.textContent).toBe('Ep');
  });
});

describe('StateTag colours', () => {
  it('paints R1 to R4 in the colour of P1 to P4, and a plain level in none', () => {
    const colour = (level: number) => {
      const { container, unmount } = render(<StateTag rank="Paragon 4" equipment={level} />);
      const label = [...container.querySelectorAll('.rank-colour')].find((el) => /^[+R]\d+$/.test(el.textContent ?? ''));
      unmount();
      return label?.className ?? null;
    };
    expect([26, 27, 28, 29].map(colour)).toEqual(['rank-colour rank-colour-paragon-1', 'rank-colour rank-colour-paragon-2', 'rank-colour rank-colour-paragon-3', 'rank-colour rank-colour-paragon-4']);
    expect(colour(25)).toBeNull();
  });
});

describe('stateText', () => {
  it('joins the rank and the equipment for a tooltip', () => {
    expect(stateText('Mythic+', 10)).toBe('Mythic+ +10');
    expect(stateText('Paragon 1', '26')).toBe('Paragon 1 R1');
    expect(stateText('Epic', '')).toBe('Epic');
  });
});
