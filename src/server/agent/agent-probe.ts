import { execFile } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/** What the computer offers: where a program is, and what it prints for a harmless question. */
export interface AgentProbe {
  /** The full path of a program found on the PATH, or null. */
  find(binary: string): Promise<string | null>;
  /** Runs a program found by `find` with fixed arguments and returns what it printed. Rejects with the reason it failed. */
  run(path: string, args: string[]): Promise<string>;
}

const PROBE_TIMEOUT_MS = 20_000;

export const systemProbe: AgentProbe = {
  async find(binary) {
    for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
      if (!dir) continue;
      const path = join(dir, binary);
      try {
        if (!(await stat(path)).isFile()) continue;
        await access(path, constants.X_OK);
        return path;
      } catch {
        // not in this folder
      }
    }
    return null;
  },
  run: (path, args) =>
    new Promise<string>((resolve, reject) => {
      execFile(path, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr.trim().split('\n')[0] || error.message));
        resolve(stdout);
      });
    }),
};
