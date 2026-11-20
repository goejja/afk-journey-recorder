import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The CSS after the `:root` block that declares the variables. */
const rules = (() => {
  const css = readFileSync('web/styles.css', 'utf8');
  const end = css.indexOf('\n}\n', css.indexOf(':root'));
  return css.slice(end + 3).split('\n');
})();

const SCALE = new Set(['4', '8', '12', '16', '24']);

describe('styles.css', () => {
  it('spaces with the --sp-* variables: no gap or padding outside :root is a px literal on the 4px scale', () => {
    const offenders = rules.flatMap((line, i) =>
      [...line.matchAll(/(?<![\w-])((?:row-|column-)?gap|padding[a-z-]*)\s*:\s*([^;}]*)/g)]
        .filter(([, , value]) => [...value!.matchAll(/(?<![\w#.-])(\d+(?:\.\d+)?)px\b/g)].some(([, n]) => SCALE.has(n!)))
        .map(([declaration]) => `line ${i + 1}: ${declaration}`),
    );
    expect(offenders).toEqual([]);
  });

  it('uses --gap-hair, not 2px, for the hairline gap between tiles', () => {
    const offenders = rules.flatMap((line, i) => [...line.matchAll(/(?<![\w-])(?:row-|column-)?gap\s*:\s*[^;}]*\b2px/g)].map(([d]) => `line ${i + 1}: ${d}`));
    expect(offenders).toEqual([]);
  });

  it('draws the columns of the record-list rows from the --col-* variables', () => {
    const grid = (selector: string) => rules.find((l) => l.startsWith(`${selector} {`)) ?? '';
    for (const selector of ['.day-info', '.fight-line', '.fight-line.in-battle', '.battle-info']) {
      expect(grid(selector), selector).toMatch(/var\(--col-/);
    }
  });
});
