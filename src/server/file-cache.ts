import { readFileSync, statSync } from 'node:fs';

/**
 * Remembers what was computed from a file while the file is unchanged (same size and modification time). One entry is kept per
 * file, so a rewritten file replaces its old entry; an id given again after a delete to another picture is computed afresh.
 */
export function fileCache<T>(): (file: string, compute: (bytes: Buffer) => T) => T {
  const kept = new Map<string, { stamp: string; value: T }>();
  return (file, compute) => {
    const { size, mtimeMs } = statSync(file);
    const stamp = `${size}:${mtimeMs}`;
    const found = kept.get(file);
    if (found?.stamp === stamp) return found.value;
    const value = compute(readFileSync(file));
    kept.set(file, { stamp, value });
    return value;
  };
}
