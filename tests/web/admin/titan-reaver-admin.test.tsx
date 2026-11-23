// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TitanReaverAdmin } from '../../../web/admin/TitanReaverAdmin.js';
import { ToastProvider } from '../../../web/ui/Toast.js';

const EMPTY = [null, null, null, null, null, null];

let stored: { bosses: (string | null)[]; updatedAt: string | null };
let puts: any[];

const BOSSES = ['Aegis', 'Basilisk', 'Cerberus'];

beforeEach(() => {
  stored = { bosses: EMPTY, updatedAt: null };
  puts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/titan-reaver/setup') {
        if (method === 'PUT') {
          const body = JSON.parse(init!.body as string);
          puts.push(body);
          stored = { ...body, updatedAt: '2026-11-22 10:00:00' };
        }
        if (method === 'DELETE') stored = { bosses: EMPTY, updatedAt: null };
        return Response.json(stored);
      }
      if (url === '/api/bosses') return Response.json(BOSSES.map((name) => ({ name, class: null, damageType: null, attempts: 0 })));
      return new Response('not found', { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPanel = () =>
  render(
    <ToastProvider>
      <TitanReaverAdmin />
    </ToastProvider>,
  );
const slot = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;

describe('Admin > Weekly default > Titan Reaver', () => {
  it('shows six empty boss slots named by Titan Reaver Phase', async () => {
    renderPanel();
    await screen.findByText('Charge, boss 1');
    for (const label of ['Charge, boss 1', 'Charge, boss 2', 'Clash, boss 1', 'Clash, boss 2', 'Conquer, boss 1', 'Conquer, boss 2']) expect(slot(label).value).toBe('');
    expect(screen.getByText('Not set')).toBeTruthy();
  });

  it('saves the bosses, leaving a slot empty', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('Charge, boss 1');
    await user.selectOptions(slot('Charge, boss 1'), 'Aegis');
    await user.selectOptions(slot('Conquer, boss 2'), 'Cerberus');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ bosses: ['Aegis', null, null, null, null, 'Cerberus'] });
    expect(await screen.findByText(/Updated 2026-11-22/)).toBeTruthy();
  });

  it('shows the saved setup, and clears it', async () => {
    stored = { bosses: ['Basilisk', null, null, null, null, null], updatedAt: '2026-11-20 09:00:00' };
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('Charge, boss 1');
    expect(slot('Charge, boss 1').value).toBe('Basilisk');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(slot('Charge, boss 1').value).toBe(''));
    expect(screen.getByText('Not set')).toBeTruthy();
  });
});
