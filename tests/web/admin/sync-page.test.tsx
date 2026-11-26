// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncPage } from '../../../web/admin/SyncPage.js';
import { jobsStream } from '../support/jobs-stream.js';
import { jobsBody, renderWithJobs } from '../support/jobs.js';

let requests: { method: string; url: string; body?: any }[];
let state: any;

const run = (over: object) => ({ id: 1, source: 'reference', startedAt: '2026-11-25 20:00:00', finishedAt: '2026-11-25 20:01:00', status: 'ok', refresh: false, overwrite: false, lines: ['Imported 120 heroes and 30 bosses'], warnings: [], error: null, ...over });

beforeEach(() => {
  requests = [];
  state = {
    running: null,
    sources: [
      { id: 'reference', label: 'Reference data', description: 'Heroes and maps.', canOverwrite: true, last: run({}) },
      { id: 'artifact-images', label: 'Artifact images', description: 'Icons.', canOverwrite: false, last: null },
    ],
  };
  jobsStream.install();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/jobs/stream') return new Response(null);
      if (url === '/api/admin/sync') return Response.json(state, { status: method === 'POST' ? 202 : 200 });
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = async () => {
  renderWithJobs(<SyncPage />, 'admin');
  jobsStream.send(jobsBody());
  return screen.findByRole('heading', { name: 'Reference data' });
};
const card = (title: string) => screen.getByRole('heading', { name: title }).parentElement as HTMLElement;
const posts = () => requests.filter((r) => r.method === 'POST');

describe('Sync page', () => {
  it('shows each source with how its last run went', async () => {
    await open();
    expect(within(card('Reference data')).getByText(/Last run 2026-11-25 20:00:00 UTC: done/)).toBeTruthy();
    expect(within(card('Reference data')).getByText('Imported 120 heroes and 30 bosses')).toBeTruthy();
    expect(within(card('Artifact images')).getByText('Never run.')).toBeTruthy();
  });

  it('offers Overwrite only where it means something', async () => {
    await open();
    expect(within(card('Reference data')).getByLabelText('Overwrite my edits')).toBeTruthy();
    expect(within(card('Artifact images')).queryByLabelText('Overwrite my edits')).toBeNull();
  });

  it('starts one source with the re-download box as ticked', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(within(card('Artifact images')).getByLabelText('Re-download (ignore cache)'));
    await user.click(within(card('Artifact images')).getByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ url: '/api/admin/sync', body: { source: 'artifact-images', refresh: true, overwrite: false } });
  });

  it('asks before an overwrite and starts nothing when the question is declined', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(within(card('Reference data')).getByLabelText('Overwrite my edits'));
    await user.click(within(card('Reference data')).getByRole('button', { name: 'Sync' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/copied to data\/backups first/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(posts()).toHaveLength(0);
    await user.click(within(card('Reference data')).getByRole('button', { name: 'Sync' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sync and overwrite' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ source: 'reference', refresh: false, overwrite: true });
  });

  it('starts every source with Sync all, and disables the buttons while one runs', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Sync all' }));
    await waitFor(() => expect(posts()[0]?.body).toEqual({ source: 'all', refresh: false, overwrite: false }));
  });

  it('disables every button while a sync runs and says which one', async () => {
    state.running = 'reference';
    await open();
    expect((screen.getByRole('button', { name: 'Sync all' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Syncing Reference data…')).toBeTruthy();
  });
});
