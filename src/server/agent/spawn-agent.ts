import { spawn } from 'node:child_process';
import type { AgentRunner } from './scenario-run.js';

const MAX_OUTPUT = 1024 * 1024;

/** The real runner: starts the agent as a child process in the repository directory and collects what it prints. */
export const spawnAgent: AgentRunner = (command, { timeoutMs, signal }) =>
  new Promise<string>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Cancelled'));
    const child = spawn(command.command, command.args, { cwd: process.cwd(), env: { ...process.env, ...command.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let stop: Error | null = null;
    const kill = (reason: Error) => {
      stop ??= reason;
      child.kill('SIGTERM');
    };
    const timer = setTimeout(() => kill(new Error(`Timed out after ${Math.round(timeoutMs / 60000)} minutes`)), timeoutMs);
    const onAbort = () => kill(new Error('Cancelled'));
    signal.addEventListener('abort', onAbort);

    // decode as UTF-8 across chunks: a character split between two chunks must not become U+FFFD
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.length > MAX_OUTPUT) kill(new Error('The agent printed too much'));
    });
    child.stderr.on('data', (chunk) => {
      err = (err + chunk).slice(-2000);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (stop) return reject(stop);
      if (code !== 0) return reject(new Error(err.trim() || `The agent exited with code ${code}`));
      resolve(out);
    });
  });
