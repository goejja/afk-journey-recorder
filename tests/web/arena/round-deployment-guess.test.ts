import { describe, expect, it } from 'vitest';
import { guessOf, pruneGuess, withoutGuess } from '../../../web/arena/round-deployment.js';
import type { RoundTeam } from '../../../src/domain/round-deployment.js';

const team = (heroes: RoundTeam['heroes'], phantimal: RoundTeam['phantimal'] = null): RoundTeam => ({ heroes, artifact: null, phantimal });
const row = (hero: string, tile: number | null, part = '') => ({ tile, hero, part, rank: null, equipmentLevel: null });

describe('what the form guessed, by Unit (ADR 0021, ADR 0028)', () => {
  it('keeps the second part of a pair and a summon as guesses of their own', () => {
    const placed = [
      { tile: 38, hero: 'Elijah & Lailah', part: 'Elijah' },
      { tile: 39, hero: 'Elijah & Lailah', part: 'Lailah' },
      { tile: 40, hero: 'Zanie' },
      { tile: 41, hero: 'Zanie', part: 'Laser Turret' },
      { tile: 42, hero: 'Zanie', part: 'Laser Turret' },
    ];
    const guess = guessOf('Open', placed, null);
    expect(guess.heroes).toEqual({
      'Elijah & Lailah|Elijah': [38],
      'Elijah & Lailah|Lailah': [39],
      'Zanie|': [40],
      'Zanie|Laser Turret': [41, 42], // both turrets are guesses of their own
    });
    const stored = team(placed.map((p) => row(p.hero, p.tile, p.part)));
    // every Unit the form placed is cleared, none of them is taken for a placement
    expect(withoutGuess(stored, guess, 'Open').heroes.map((h) => h.tile)).toEqual([null, null, null, null, null]);
  });

  it('keeps a Unit the player moved, and clears the ones still where the form left them', () => {
    const guess = guessOf('Open', [{ tile: 38, hero: 'Zanie' }, { tile: 39, hero: 'Zanie', part: 'Laser Turret' }], null);
    const stored = team([row('Zanie', 40), row('Zanie', 41, 'Laser Turret')]);
    expect(withoutGuess(stored, guess, 'Open').heroes.map((h) => h.tile)).toEqual([40, 41]);
  });

  it('clears a known tile from the guess when the Deployment already knew it', () => {
    const guess = guessOf('Open', [{ tile: 38, hero: 'Elijah & Lailah', part: 'Elijah' }, { tile: 39, hero: 'Elijah & Lailah', part: 'Lailah' }], null);
    const known = team([row('Elijah & Lailah', 38, 'Elijah'), row('Elijah & Lailah', null, 'Lailah')]);
    const pruned = pruneGuess(guess, known);
    expect(pruned.heroes).toEqual({ 'Elijah & Lailah|Elijah': [], 'Elijah & Lailah|Lailah': [39] });
    expect(withoutGuess(known, pruned, 'Open').heroes.map((h) => h.tile)).toEqual([38, null]);
  });

  it('clears every tile when the map changed, the Phantimal included', () => {
    const guess = guessOf('Open', [{ tile: 38, hero: 'Alna' }], { tile: 40, partnerTile: 41 });
    const stored = team([row('Alna', 38)], { name: 'Wedge of Matter', tile: 40, partnerTile: 41 });
    const cleared = withoutGuess(stored, guess, 'Duel');
    expect(cleared.heroes[0]!.tile).toBeNull();
    expect(cleared.phantimal).toEqual({ name: 'Wedge of Matter', tile: null, partnerTile: null });
  });
});