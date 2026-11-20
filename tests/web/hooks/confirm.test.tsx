// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAction } from '../../../web/hooks/action.js';
import { useConfirmActions } from '../../../web/hooks/confirm.js';

afterEach(cleanup);

function Page({ action, after }: { action: () => Promise<string>; after?: (text: string) => void }) {
  const { run, error, message } = useAction();
  const { confirmRun, dialog } = useConfirmActions(run);
  return (
    <>
      <button onClick={() => void confirmRun({ title: 'Delete the map?', message: 'It cannot be undone.', confirmLabel: 'Delete' }, action, after, 'Deleted.')}>Ask</button>
      <p role="status">{message}</p>
      <p role="alert">{error}</p>
      {dialog}
    </>
  );
}

describe('confirmRun', () => {
  it('does nothing until the question is answered, and nothing when it is cancelled', async () => {
    const user = userEvent.setup();
    const action = vi.fn(() => Promise.resolve('x'));
    render(<Page action={action} />);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByRole('dialog', { name: 'Delete the map?' })).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('runs the action as run does once it is confirmed, with the follow-up and the message', async () => {
    const user = userEvent.setup();
    const after = vi.fn();
    render(<Page action={() => Promise.resolve('gone')} after={after} />);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(after).toHaveBeenCalledWith('gone');
    expect((await screen.findByRole('status')).textContent).toBe('Deleted.');
  });

  it('shows the error of an action that fails', async () => {
    const user = userEvent.setup();
    render(<Page action={() => Promise.reject(new Error('A record uses it'))} />);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect((await screen.findByRole('alert')).textContent).toBe('A record uses it');
  });
});
