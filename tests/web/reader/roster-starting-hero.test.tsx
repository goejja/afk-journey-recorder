// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RosterPage } from '../../../web/reader/RosterPage.js';

const hero = (name: string, tier: string, owned: boolean, rank: string | null) => ({ name, tier, class: 'Mage', faction: 'Wilder', damageType: 'Magic', imagePath: null, owned, rank, equipmentLevel: null });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/reference') return Response.json({ ranks: ['Rare', 'Epic'], equipmentLevels: [0], caps: [] });
      if (url === '/api/profiles') return Response.json([{ id: 1, name: 'Me', playerId: null, isDefault: true, heroCount: 2 }]);
      if (url === '/api/heroes?profile=1') return Response.json([hero('Chippy', 'R', true, 'Rare'), hero('Sam', 'S', true, 'Epic')]);
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

describe('starting heroes on the Roster page', () => {
  it('shows a starting hero as owned but locked, with no editor, and leaves other heroes editable', async () => {
    render(<RosterPage />);
    const cards = await screen.findAllByRole('article');
    await waitFor(() => expect(cards).toHaveLength(2));
    const chippy = within(cards.find((c) => c.querySelector('.name')?.textContent === 'Chippy')!);
    const sam = within(cards.find((c) => c.querySelector('.name')?.textContent === 'Sam')!);
    expect((chippy.getByTitle('Starting hero: always on the roster') as HTMLButtonElement).disabled).toBe(true);
    expect(chippy.queryByRole('button', { name: /^Rank of/ })).toBeNull();
    expect(chippy.getByText('Rare')).toBeTruthy();
    expect(sam.getByRole('button', { name: /^Rank of/ })).toBeTruthy();
    expect(sam.getByTitle('Remove from roster')).toBeTruthy();
  });
});
