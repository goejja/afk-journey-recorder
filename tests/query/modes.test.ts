import { describe, expect, it } from 'vitest';
import { ARENA_MODES } from '../../src/domain/arena.js';
import { modesFor, PVP_BY_DEFAULT } from '../../src/query/filters.js';

describe('modesFor', () => {
  it('reads the PvP modes only for a hero statistic given no mode', () => {
    expect(modesFor('hero-stats', undefined)).toEqual([...ARENA_MODES]);
    expect(modesFor('hero-stats', undefined)).not.toContain('Dream Hunt');
    expect(modesFor('formation-groups', undefined)).toEqual([...ARENA_MODES]);
  });

  it('keeps the modes the caller gave, Dream Hunt included', () => {
    expect(modesFor('hero-stats', ['Dream Hunt'])).toEqual(['Dream Hunt']);
  });

  it('leaves the other commands on every mode', () => {
    for (const command of ['summary', 'stage-stats', 'dream-hunt', 'player-stats', 'sql']) expect(modesFor(command, undefined)).toBeUndefined();
  });

  it('names no command the CLI does not have', () => {
    expect([...PVP_BY_DEFAULT].every((command) => /^[a-z]+(-[a-z]+)*$/.test(command))).toBe(true);
  });
});
