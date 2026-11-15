import { describe, expect, it } from 'vitest';
import { spawnAgent } from '../../../src/server/agent/spawn-agent.js';

describe('spawnAgent', () => {
  it('keeps a character that arrives split between two chunks', async () => {
    // "я" is two bytes (0xD1 0x8F): write them apart so that they reach the reader in separate chunks
    const script = "process.stdout.write(Buffer.from([0xd1])); setTimeout(() => process.stdout.write(Buffer.from([0x8f, 0x0a])), 50)";
    const out = await spawnAgent({ command: process.execPath, args: ['-e', script], env: {} } as never, { timeoutMs: 10000, signal: new AbortController().signal });
    expect(out.trim()).toBe('я');
  });
});
