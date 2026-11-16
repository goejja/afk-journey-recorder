import { readFileSync } from 'node:fs';

const css = readFileSync('web/styles.css', 'utf8');

/** How many columns the stylesheet gives the grid of a selector: a row with more cells than that wraps its last cells onto a second line. */
export function columnsOf(selector: string): number {
  const rule = css.split('\n').find((line) => line.startsWith(`${selector} {`) && line.includes('grid-template-columns'));
  if (!rule) throw new Error(`No grid-template-columns for ${selector}`);
  const template = /grid-template-columns:\s*([^;]+);/.exec(rule)![1]!;
  let depth = 0;
  let tokens = 0;
  let inToken = false;
  for (const ch of template) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) inToken = false;
    else if (!inToken) (tokens += 1, (inToken = true));
  }
  return tokens;
}
