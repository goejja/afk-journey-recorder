import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('web/styles.css', 'utf8');

describe('stylesheet', () => {
  it('has no list rule on the picker that would flatten the icon grids inside it', () => {
    // `.picker ul` outranks `.hero-grid` and turned the grids into a vertical list.
    expect(css).not.toMatch(/\.picker\s+ul\b/);
  });

  it('gives the map column a fixed width so text below the map cannot push the picker away', () => {
    expect(css).toMatch(/\.two-col\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\d+px\)/);
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
});
