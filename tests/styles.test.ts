import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RECORD_MAP_WIDTH } from '../web/map-size.js';

const css = readFileSync('web/styles.css', 'utf8');

describe('stylesheet', () => {
  it('has no list rule on the picker that would flatten the icon grids inside it', () => {
    // `.picker ul` outranks `.hero-grid` and turned the grids into a vertical list.
    expect(css).not.toMatch(/\.picker\s+ul\b/);
  });

  it('never raises a hovered map tile above the rank tags of the units beside it', () => {
    // a `z-index` on `.hex-cell:hover` painted the tile over the tag that hangs from the tile above; the tooltip has its own z-index
    expect(css).not.toMatch(/\.hex-cell[^{]*\{[^}]*z-index/);
    expect(css).toMatch(/\.tile-tip\s*\{[^}]*z-index:\s*var\(--z-popover\)/);
  });

  it('gives the map column a fixed width so text below the map cannot push the picker away', () => {
    expect(css).toMatch(/\.two-col\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\d+px\)/);
  });

  it('makes the map column as wide as the record map, with no room to spare on its right', () => {
    expect(css.match(/\.two-col\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*(\d+)px\)/)?.[1]).toBe(String(RECORD_MAP_WIDTH));
    expect(css).not.toMatch(/\.side-banner\s*\{[^}]*\bwidth:/); // the banner takes the width of the map column
  });

  it('keeps the top banner and a page-level Tab strip in view, above the sticky controls and below a Popover', () => {
    const z = (name: string) => Number(css.match(new RegExp(`--z-${name}:\\s*(\\d+)`))?.[1]);
    expect(css).toMatch(/\.app-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*var\(--z-header\)/);
    expect(css).toMatch(/\.tabs\.sticky\s*\{[^}]*position:\s*sticky;[^}]*top:\s*var\(--header-h\)/);
    expect(z('header')).toBeGreaterThan(z('tag'));
    expect(z('header')).toBeLessThan(z('popover'));
  });

  it('gives the map column of a recording screen the map plus the room of its scrollbar, so the map does not scroll sideways', () => {
    // the column scrolls up and down and keeps `--scroll-room` of padding inside its box (border-box), so it must be that much wider than the map
    expect(css).toMatch(/\.workspace-body \.two-col > div\s*\{[^}]*padding-right:\s*var\(--scroll-room\)/);
    expect(css.match(/\.workspace-body \.two-col\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*calc\((\d+)px \+ var\(--scroll-room\)\)\)/)?.[1]).toBe(String(RECORD_MAP_WIDTH));
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

  it('sizes a master/detail pane from the banner, the Tabs and the page room, not from a fixed guess', () => {
    // a literal such as `100vh - 100px` let the foot of the list fall below the screen under the sticky Tabs (#381)
    const height = css.match(/(?:^|\n)\.master-detail\s*\{[^}]*[\s;{]height:\s*([^;]+);/)?.[1];
    expect(height).toContain('var(--sticky-top)');
    expect(height).not.toMatch(/\d+px/);
    // under sticky Tabs the pane also leaves the margin below them
    // a second, non-sticky strip of Tabs above the pane (Admin > Units) also takes its height and margin
    expect(css).toMatch(/main:has\(\.tabs\.sticky\) \.tabs:not\(\.sticky\) \+ \[role=tabpanel\] \.master-detail\s*\{[^}]*height:\s*calc\(100vh - var\(--sticky-top\) - 4 \* var\(--sp-4\) - var\(--control-h\)\)/);
    // and on a narrow screen the pane is as tall as its content, whichever rule would size it
    expect(css).toMatch(/@media \(max-width: 800px\) \{[^@]*\.master-detail, main:has\(\.tabs\.sticky\) \.master-detail, main:has\(\.tabs\.sticky\) \.tabs:not\(\.sticky\) \+ \[role=tabpanel\] \.master-detail \{ height: auto/);
    expect(css).toMatch(/main:has\(\.tabs\.sticky\) \.master-detail\s*\{[^}]*height:\s*calc\(100vh - var\(--sticky-top\) - 3 \* var\(--sp-4\)\)/);
  });
});
