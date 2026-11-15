// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MultiSelect } from '../../web/MultiSelect.js';

afterEach(cleanup);

function Harness({ start = [] as string[] }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <MultiSelect label="Mode" options={['Arena', 'Supreme Arena', 'Guild Duel']} value={value} onChange={setValue} />
      <p>Chosen: {value.join('|') || 'nothing'}</p>
    </>
  );
}

describe('MultiSelect', () => {
  it('says All with nothing chosen, names one or two choices, and counts more', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Mode: All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Guild Duel' }));
    expect(screen.getByRole('button', { name: 'Mode: Guild Duel' })).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Arena' }));
    expect(screen.getByText('Chosen: Arena|Guild Duel')).toBeTruthy(); // in the order of the options
    await user.click(screen.getByRole('checkbox', { name: 'Supreme Arena' }));
    expect(screen.getByRole('button', { name: 'Mode: 3 selected' })).toBeTruthy();
  });

  it('unchecks a choice, and Clear drops them all', async () => {
    const user = userEvent.setup();
    render(<Harness start={['Arena', 'Guild Duel']} />);
    await user.click(screen.getByRole('button', { name: 'Mode: Arena, Guild Duel' }));
    await user.click(screen.getByRole('checkbox', { name: 'Arena' }));
    expect(screen.getByText('Chosen: Guild Duel')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Chosen: nothing')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes on Escape and on a click elsewhere', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Mode: All' }));
    expect(screen.getByRole('group', { name: 'Mode' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Mode' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mode: All' }));
    await user.click(screen.getByText(/Chosen/));
    expect(screen.queryByRole('group', { name: 'Mode' })).toBeNull();
  });
});
