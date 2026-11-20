// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CleanupPage } from '../../../web/reader/CleanupPage.js';
import { ToastProvider } from '../../../web/ui/Toast.js';

let requests: { method: string; url: string; body?: any }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/tags') return Response.json([{ tag: 'Luna', count: 2 }]);
      if (url === '/api/cleanup/preview') return Response.json({ count: 3, oldest: '2026-01-01 10:00:00', newest: '2026-02-01 10:00:00' });
      if (url === '/api/cleanup/delete') return Response.json({ deleted: 3 });
      if (url === '/api/cleanup/optimize') return Response.json({ bytesBefore: 20480, bytesAfter: 8192 });
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

describe('Cleanup page', () => {
  it('previews the matching records and only deletes after the person confirms the count', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><CleanupPage /></ToastProvider>);
    await user.selectOptions(screen.getByLabelText('Mode'), 'Arena');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/match, entered between/)).toBeTruthy();
    expect(requests.find((r) => r.url === '/api/cleanup/preview')?.body).toEqual({ mode: 'Arena', olderThanDays: 90 });
    expect(requests.some((r) => r.url === '/api/cleanup/delete')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete 3 records' }));
    const dialog = await screen.findByRole('dialog');
    expect(requests.some((r) => r.url === '/api/cleanup/delete')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(requests.some((r) => r.url === '/api/cleanup/delete')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete 3 records' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(requests.find((r) => r.url === '/api/cleanup/delete')?.body).toEqual({ mode: 'Arena', olderThanDays: 90, expectedCount: 3 }));
    expect(await screen.findByText(/Deleted 3 records/)).toBeTruthy();
  });

  it('forgets a preview when the selection changes', async () => {
    const user = userEvent.setup();
    render(<CleanupPage />);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('button', { name: 'Delete 3 records' });
    await user.clear(screen.getByLabelText('Older than (days)'));
    await user.type(screen.getByLabelText('Older than (days)'), '30');
    expect(screen.queryByRole('button', { name: 'Delete 3 records' })).toBeNull();
  });

  it('compacts the database and reports the size', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><CleanupPage /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'Optimize database' }));
    expect(await screen.findByText(/20 KB → 8 KB/)).toBeTruthy();
  });
});
