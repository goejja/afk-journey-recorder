// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Enemy } from '../../../web/backend.js';
import { EnemyPicker } from '../../../web/arena/EnemyPicker.js';

const enemy = (name: string, category: Enemy['category'], uses = 0): Enemy => ({ name, category, class: null, damageType: null, imagePath: null, uses });
afterEach(cleanup);

const enemies = [enemy('Grunt', 'Common', 2), enemy('Beetle', 'Common'), enemy('Captain', 'Elite', 5), enemy('Croaker', 'Boss')];

describe('EnemyPicker', () => {
  it('groups enemies as Boss, Elite and Common and lists the most used first', () => {
    render(<EnemyPicker enemies={enemies} selected={null} onPick={() => {}} />);
    const used = within(screen.getByRole('list', { name: 'Most used enemies' }));
    expect(used.getAllByRole('button').map((b) => b.textContent)).toEqual(['Captain', 'Grunt']);
    expect(within(screen.getByRole('list', { name: 'Boss enemies' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Croaker']);
    expect(within(screen.getByRole('list', { name: 'Common enemies' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Beetle', 'Grunt']);
    expect(used.getByRole('button', { name: 'Captain' }).getAttribute('title')).toMatch(/Elite · on 5 stages/);
  });

  it('shows no most-used row when no enemy has been placed yet', () => {
    render(<EnemyPicker enemies={enemies.map((e) => ({ ...e, uses: 0 }))} selected={null} onPick={() => {}} />);
    expect(screen.queryByRole('list', { name: 'Most used enemies' })).toBeNull();
  });

  it('narrows both lists by name and reports the pick', async () => {
    const onPick = vi.fn();
    render(<EnemyPicker enemies={enemies} selected={null} onPick={onPick} />);
    await userEvent.type(screen.getByLabelText('Search Enemies'), 'gru');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Grunt', 'Grunt']);
    await userEvent.click(within(screen.getByRole('list', { name: 'Common enemies' })).getByRole('button', { name: 'Grunt' }));
    expect(onPick).toHaveBeenCalledWith('Grunt');
  });
});
