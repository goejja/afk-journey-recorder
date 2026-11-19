// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parkedMessage, PARKED_TOAST_MS, useParkedToast, type FeedbackAnswer } from '../../../web/reader/parked-toast.js';
import { ToastProvider } from '../../../web/ui/Toast.js';

const answer = (parked: number, full: FeedbackAnswer['full'] = []): FeedbackAnswer => ({ logged: 1, looks: 0, heroExamples: 0, rankLooks: 0, parked, full });

describe('the message after a save', () => {
  it('names how many readings wait, in the singular for one', () => {
    expect(parkedMessage([answer(3)])).toBe('3 readings to confirm in Admin > Reader');
    expect(parkedMessage([answer(1)])).toBe('1 reading to confirm in Admin > Reader');
  });

  it('says which list is full and what to do', () => {
    expect(parkedMessage([answer(0, ['difference'])])).toBe('The To confirm list of differences is full: confirm or dismiss some in Admin > Reader');
    expect(parkedMessage([answer(0, ['unsure'])])).toBe('The To confirm list of unsure readings is full: confirm or dismiss some in Admin > Reader');
    expect(parkedMessage([answer(0, ['difference', 'unsure'])])).toBe('The To confirm lists of differences and unsure readings are full: confirm or dismiss some in Admin > Reader');
  });

  it('puts the readings that wait before the full list, in one message', () => {
    expect(parkedMessage([answer(2, ['unsure'])])).toBe('2 readings to confirm in Admin > Reader. The To confirm list of unsure readings is full: confirm or dismiss some in Admin > Reader');
  });

  it('adds up a batch: the readings of every answer and every kind that was full, once', () => {
    expect(parkedMessage([answer(2), answer(0), answer(3, ['difference']), answer(1, ['difference'])])).toBe(
      '6 readings to confirm in Admin > Reader. The To confirm list of differences is full: confirm or dismiss some in Admin > Reader',
    );
  });

  it('says nothing when nothing was parked and nothing is full, or when no answer came', () => {
    expect(parkedMessage([answer(0), answer(0)])).toBeNull();
    expect(parkedMessage([])).toBeNull();
    expect(parkedMessage([null, null])).toBeNull();
  });

  it('ignores the sends that failed and keeps the others', () => {
    expect(parkedMessage([null, answer(2), null])).toBe('2 readings to confirm in Admin > Reader');
  });
});

describe('the toast after a save', () => {
  afterEach(cleanup);

  function Saver({ sends }: { sends: Promise<FeedbackAnswer>[] }) {
    const report = useParkedToast();
    return <button onClick={() => report(sends)}>report</button>;
  }
  const open = (sends: Promise<FeedbackAnswer>[]) => {
    render(
      <ToastProvider>
        <Saver sends={sends} />
      </ToastProvider>,
    );
    act(() => screen.getByRole('button', { name: 'report' }).click());
  };

  it('shows one toast when the answers have arrived, and not before', async () => {
    let later!: (a: FeedbackAnswer) => void;
    open([Promise.resolve(answer(2)), new Promise<FeedbackAnswer>((resolve) => (later = resolve))]);
    await Promise.resolve();
    expect(screen.getByRole('status').textContent).toBe('');
    await act(async () => later(answer(1)));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('3 readings to confirm in Admin > Reader'));
  });

  it('shows nothing when a send failed and nothing else was parked', async () => {
    open([Promise.reject(new Error('Network down'))]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows what the other sends found when one failed', async () => {
    open([Promise.reject(new Error('Network down')), Promise.resolve(answer(1))]);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 reading to confirm in Admin > Reader'));
  });

  it('stays longer than a usual toast', () => {
    expect(PARKED_TOAST_MS).toBe(10_000);
  });
});
