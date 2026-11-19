// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_FADE_MS, TOAST_MS, ToastProvider, useToast } from '../../web/ui/Toast.js';

function Trigger({ message, duration }: { message: string; duration?: number }) {
  const toast = useToast();
  return <button onClick={() => toast(message, duration === undefined ? undefined : { duration })}>show {message}</button>;
}

const setup = (...triggers: { message: string; duration?: number }[]) =>
  render(
    <ToastProvider>
      {triggers.map((t) => (
        <Trigger key={t.message} {...t} />
      ))}
    </ToastProvider>,
  );

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('Toast', () => {
  it('shows a message and removes it after its time and the fade', () => {
    setup({ message: 'saved' });
    fireEvent.click(screen.getByRole('button', { name: 'show saved' }));
    expect(screen.getByText('saved')).toBeTruthy();
    wait(TOAST_MS - 1);
    expect(screen.getByText('saved').closest('.toast')!.classList.contains('leaving')).toBe(false);
    wait(1);
    expect(screen.getByText('saved').closest('.toast')!.classList.contains('leaving')).toBe(true); // fading
    wait(TOAST_FADE_MS);
    expect(screen.queryByText('saved')).toBeNull();
  });

  it('keeps a toast for the duration it was given', () => {
    setup({ message: 'quick', duration: 1000 });
    fireEvent.click(screen.getByRole('button', { name: 'show quick' }));
    wait(1000);
    wait(TOAST_FADE_MS);
    expect(screen.queryByText('quick')).toBeNull();
  });

  it('closes early with its button', () => {
    setup({ message: 'saved' });
    fireEvent.click(screen.getByRole('button', { name: 'show saved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
    wait(TOAST_FADE_MS);
    expect(screen.queryByText('saved')).toBeNull();
  });

  it('stacks several toasts, each going on its own time', () => {
    setup({ message: 'first', duration: 1000 }, { message: 'second', duration: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'show first' }));
    fireEvent.click(screen.getByRole('button', { name: 'show second' }));
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
    wait(1000);
    wait(TOAST_FADE_MS);
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByText('second')).toBeTruthy();
  });

  it('stays while the pointer is over it, and goes after it leaves', () => {
    setup({ message: 'saved', duration: 1000 });
    fireEvent.click(screen.getByRole('button', { name: 'show saved' }));
    const toast = screen.getByText('saved').closest('.toast')!;
    fireEvent.mouseEnter(toast);
    wait(5000);
    expect(screen.getByText('saved')).toBeTruthy();
    fireEvent.mouseLeave(toast);
    wait(1000);
    wait(TOAST_FADE_MS);
    expect(screen.queryByText('saved')).toBeNull();
  });

  it('is announced politely and takes no focus', () => {
    setup({ message: 'saved' });
    const before = document.activeElement;
    fireEvent.click(screen.getByRole('button', { name: 'show saved' }));
    expect(screen.getByRole('status').textContent).toContain('saved');
    expect(document.activeElement).toBe(before);
  });

  it('is dropped without a provider, so a component can be shown alone', () => {
    render(<Trigger message="alone" />);
    fireEvent.click(screen.getByRole('button', { name: 'show alone' }));
    expect(screen.queryByText('alone')).toBeNull();
  });
});
