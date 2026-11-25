// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SideProfileBar } from '../../../web/arena/FightTeamsEditor.js';

afterEach(cleanup);

const props = { profiles: [], sideProfiles: { A: null, B: null } as const, onSideProfile: vi.fn() };

describe('SideProfileBar', () => {
  it('offers Swap sides only when the form can swap', () => {
    const { rerender } = render(<SideProfileBar {...props} />);
    expect(screen.queryByRole('button', { name: 'Swap sides' })).toBeNull();
    const onSwapSides = vi.fn();
    rerender(<SideProfileBar {...props} onSwapSides={onSwapSides} />);
    fireEvent.click(screen.getByRole('button', { name: 'Swap sides' }));
    expect(onSwapSides).toHaveBeenCalledOnce();
  });
});
