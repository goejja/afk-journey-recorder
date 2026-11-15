import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const USER_AGENT = 'afk-journey-recorder/0.1 (personal local tool)';
const MIN_DELAY_MS = 1000;
/** A stalled connection ends the request instead of hanging a sync for ever. */
const TIMEOUT_MS = 60_000;

/** Writes a file whole or not at all: an interrupted write leaves a temporary file, never a truncated one that later runs would trust. */
async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, file);
  } catch (e) {
    await rm(temporary, { force: true });
    throw e;
  }
}

export interface Fetcher {
  text(url: string): Promise<string>;
  /** Saves a binary file to `destination` unless it already exists. */
  download(url: string, destination: string): Promise<void>;
}

/** Fetches URLs politely: one at a time, rate limited, and cached on disk so each URL is hit once. */
export function createCachedFetcher(cacheDir: string, refresh = false): Fetcher {
  let lastRequestAt = 0;

  async function get(url: string): Promise<Response> {
    const wait = lastRequestAt + MIN_DELAY_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
    return response;
  }

  return {
    async text(url) {
      const file = join(cacheDir, createHash('sha256').update(url).digest('hex') + '.txt');
      if (!refresh) {
        try {
          return await readFile(file, 'utf8');
        } catch {
          // not cached yet
        }
      }
      const body = await (await get(url)).text();
      await writeAtomic(file, body);
      return body;
    },

    async download(url, destination) {
      if (!refresh) {
        try {
          await stat(destination);
          return;
        } catch {
          // not downloaded yet
        }
      }
      const bytes = Buffer.from(await (await get(url)).arrayBuffer());
      await writeAtomic(destination, bytes);
    },
  };
}
