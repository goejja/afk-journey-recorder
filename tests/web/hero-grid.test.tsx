// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Hero } from '../../web/backend.js';
import { groupByFaction, HeroGrid } from '../../web/HeroGrid.js';
import { initials } from '../../web/Portrait.js';

const hero = (name: string, faction: string | null, tier: Hero['tier'] = 'S'): Hero => ({
  name, tier, class: 'Mage', faction, damageType: 'Magic', imagePath: null, owned: true, rank: null, equipmentLevel: null,
});
afterEach(cleanup);

const heroes = [hero('Zed', 'Wilder'), hero('Ann', 'Mauler', 'A'), hero('Bea', 'Mauler'), hero('Cal', 'Lightbearer'), hero('Dov', null), hero('Eli', 'Dimensional')];

describe('groupByFaction', () => {
  it('orders factions like the Yaphalla builder, strongest tier first, and puts the unknown last', () => {
    expect(groupByFaction(heroes).map((g) => [g.faction, g.heroes.map((h) => h.name)])).toEqual([
      ['Lightbearer', ['Cal']],
      ['Mauler', ['Bea', 'Ann']], // S before A
      ['Wilder', ['Zed']],
      ['Dimensional', ['Eli']],
      ['Other', ['Dov']],
    ]);
  });
});

describe('HeroGrid', () => {
  it('shows faction headings and icons without names, which appear on hover', () => {
    render(<HeroGrid heroes={heroes} selected={null} onPick={() => {}} label="Heroes" />);
    const list = within(screen.getByRole('list', { name: 'Heroes' }));
    expect(list.getByText('Mauler')).toBeTruthy();
    const button = list.getByRole('button', { name: 'Bea' });
    expect(button.getAttribute('title')).toMatch(/^Bea/);
    expect(button.textContent).toBe(''); // no visible name beside the icon
  });

  it('keeps the search box and the faction and class filters in one row', () => {
    render(<HeroGrid heroes={heroes} selected={null} onPick={() => {}} label="Heroes" />);
    const search = screen.getByRole('textbox', { name: 'Search Heroes' });
    const row = search.parentElement!;
    expect(row.className).toContain('picker-controls');
    expect(row.className).toContain('filters');
    expect(within(row).getByRole('button', { name: 'Faction: All' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Class: All' })).toBeTruthy();
  });
});

describe('initials', () => {
  it('tells generic icons apart', () => {
    expect(initials('Crystal Beetle')).toBe('CB');
    expect(initials('Grunt')).toBe('GR');
    expect(initials('')).toBe('?');
  });
});
