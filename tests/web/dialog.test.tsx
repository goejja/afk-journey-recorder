// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, Dialog, NameDialog } from '../../web/ui/Dialog.js';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('names the object and starts a destructive answer on Cancel', () => {
    render(<ConfirmDialog title="Delete the map “Duel”?" message="This cannot be undone." danger confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Delete the map “Duel”?' });
    expect(within(dialog).getByText('This cannot be undone.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('starts a harmless answer on the confirm button', () => {
    render(<ConfirmDialog title="Ungroup this day?" confirmLabel="Ungroup" onConfirm={() => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ungroup' }));
  });

  it('cancels on Escape, but not on a click beside the box', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete the tag?" danger confirmLabel="Delete" onConfirm={() => {}} onCancel={onCancel} />);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    cleanup();
    render(<ConfirmDialog title="Delete the tag?" danger confirmLabel="Delete" onConfirm={() => {}} onCancel={onCancel} />);
    const overlay = document.querySelector('.overlay')!;
    await user.click(overlay);
    expect(onCancel).toHaveBeenCalledTimes(1); // the first call only: the backdrop does not dismiss
  });

  it('confirms with its button', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="Delete the rule?" danger confirmLabel="Delete" onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('lets a picker close on a click beside it', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <Dialog title="Side A artifact" closeOnBackdrop onCancel={onCancel}>
        <p>Artifacts</p>
      </Dialog>,
    );
    await user.click(document.querySelector('.overlay')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('NameDialog', () => {
  it('starts on the name, refuses a blank one, and submits on Enter', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<NameDialog title="Name of the scenario" initialValue="Counter Advisor · Arena" confirmLabel="Save" onConfirm={onConfirm} onCancel={() => {}} />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('Counter Advisor · Arena');
    expect(document.activeElement).toBe(input);

    await user.clear(input);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);

    await user.type(input, '  Fast team  ');
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Fast team');
  });

  it('gives a name back when Create is pressed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<NameDialog title="Name for the copy" initialValue="Duel copy" confirmLabel="Duplicate" onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(onConfirm).toHaveBeenCalledWith('Duel copy');
  });
});