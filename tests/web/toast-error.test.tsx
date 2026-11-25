// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOAST_FADE_MS, TOAST_MS, ToastProvider, useToast } from '../../web/ui/Toast.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Show({ message, options }: { message: string; options?: Parameters<ReturnType<typeof useToast>>[1] }) {
  const toast = useToast();
  return <button onClick={() => toast(message, options)}>show</button>;
}

describe('a toast for work that failed in the background', () => {
  it('is an alert that stays until it is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Show message="The Agent could not finish scenario 3: x" options={{ kind: 'error' }} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'show' }));
    expect(screen.getByRole('alert').textContent).toContain('The Agent could not finish scenario 3: x');
    await act(() => vi.advanceTimersByTimeAsync(TOAST_MS * 10));
    expect(screen.getByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close notification' }));
    await act(() => vi.advanceTimersByTimeAsync(TOAST_FADE_MS + 10));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has an Open link to where the result is, and an ordinary toast still fades by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <Show message="Done" options={{ href: '#arena' }} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'show' }));
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('#arena');
    expect(screen.queryByRole('alert')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(TOAST_MS));
    await act(() => vi.advanceTimersByTimeAsync(TOAST_FADE_MS));
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
  });
});
