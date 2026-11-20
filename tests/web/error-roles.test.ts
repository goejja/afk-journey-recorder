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
  it('are drawn by Notice, which gives every error the role alert, as docs/ui-conventions.md says', () => {
    const raw = sources('web')
      .filter((file) => !file.endsWith('Notice.tsx'))
      .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/<(?:p|span|div)\b[^>]*className="error"[^>]*>/g)].map((tag) => `${file}: ${tag[0]}`));
    expect(raw).toEqual([]);
  });
});
