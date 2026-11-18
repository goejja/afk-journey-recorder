import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RECORD_MAP_WIDTH } from '../web/map-size.js';

const css = readFileSync('web/styles.css', 'utf8');

describe('stylesheet', () => {
  it('has no list rule on the picker that would flatten the icon grids inside it', () => {
    // `.picker ul` outranks `.hero-grid` and turned the grids into a vertical list.
    expect(css).not.toMatch(/\.picker\s+ul\b/);
  });

  it('gives the map column a fixed width so text below the map cannot push the picker away', () => {
    expect(css).toMatch(/\.two-col\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\d+px\)/);
  });

  it('makes the map column as wide as the record map, with no room to spare on its right', () => {
    expect(css.match(/\.two-col\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*(\d+)px\)/)?.[1]).toBe(String(RECORD_MAP_WIDTH));
    expect(css).not.toMatch(/\.side-banner\s*\{[^}]*\bwidth:/); // the banner takes the width of the map column
  });

  it('draws a Popover above a Dialog and below a toast, so it can open from inside one', () => {
    const z = (name: string) => Number(css.match(new RegExp(`--z-${name}:\\s*(\\d+)`))?.[1]);
    expect(z('overlay-popover')).toBeGreaterThan(z('overlay'));
    expect(z('overlay-popover')).toBeLessThan(z('toast'));
    expect(css).toMatch(/\.popover\s*\{[^}]*z-index:\s*var\(--z-overlay-popover\)/);
  });

  it('draws the rank tag of a tile above the artifact slots and below a Popover, at the smallest type size', () => {
    const z = (name: string) => Number(css.match(new RegExp(`--z-${name}:\\s*(\\d+)`))?.[1]);
    expect(z('tag')).toBeGreaterThan(z('control')); // the artifact slots are controls
    expect(z('tag')).toBeLessThan(z('popover'));
    expect(css).toMatch(/\.tile-tag\s*\{[^}]*z-index:\s*var\(--z-tag\)[^}]*font-size:\s*var\(--font-2xs\)/);
  });

  it('does not restyle the Stages list’s .unit with the map rings', () => {
    expect(css.match(/^\.unit\s*\{/gm)).toHaveLength(1);
  });

  it('keeps the tag chips and the enemy chips on different class names', () => {
    expect(css).toMatch(/\.enemy-chip\b/);
    // Redefining .chip / .chips later in the file would restyle the Phantimals tab's season tags.
    expect(css.match(/^\.chips\s*\{/gm)).toHaveLength(1);
    expect(css.match(/^\.chip\s*\{/gm)).toHaveLength(1);
  });

  it('keeps room at the right edge of every box that scrolls, so a scrollbar never covers what is inside', () => {
    // An overlay scrollbar (the macOS default) floats over the content and `scrollbar-gutter` alone reserves nothing for it.
    const missing: string[] = [];
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/overflow(-y)?:\s*(auto|scroll)\b/.test(body!)) continue;
      if (!/scrollbar-gutter:\s*stable/.test(body!) || !/padding-right:\s*var\(--scroll-room\)/.test(body!)) missing.push(selector!.trim().replace(/\s+/g, ' '));
    }
    expect(missing).toEqual([]);
  });
});
