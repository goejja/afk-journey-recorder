import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'dist' || name === 'node_modules') return [];
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.tsx') ? [path] : [];
  });

describe('error messages', () => {
  it('give every .error the role alert, as docs/ui-conventions.md says', () => {
    const missing = sources('web').flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/<(?:p|span|div)\b[^>]*className="error"[^>]*>/g)].filter((tag) => !tag[0].includes('role="alert"')).map((tag) => `${file}: ${tag[0].replace(/\s+/g, ' ').slice(0, 80)}`),
    );
    expect(missing).toEqual([]);
  });
});
