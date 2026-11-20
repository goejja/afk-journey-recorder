// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TabPanel, Tabs } from '../../web/ui/Tabs.js';

afterEach(cleanup);

const TABS = [
  { key: 'a', label: 'First' },
  { key: 'b', label: 'Second' },
  { key: 'c', label: 'Third' },
];

function Strip() {
  const [view, setView] = useState('a');
  return (
    <>
      <Tabs id="demo" label="Demo views" tabs={TABS} value={view} onChange={setView} />
      <TabPanel id="demo" value={view}>
        <p>View {view}</p>
      </TabPanel>
    </>
  );
}

describe('Tabs', () => {
  it('names the strip, marks the selected Tab and links each Tab to the panel it shows', () => {
    render(<Strip />);
    expect(screen.getByRole('tablist', { name: 'Demo views' })).toBeTruthy();
    const first = screen.getByRole('tab', { name: 'First' });
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected')).toBe('false');
    const panel = screen.getByRole('tabpanel');
    expect(first.getAttribute('aria-controls')).toBe(panel.id);
    expect(screen.getByRole('tab', { name: 'Third' }).getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(first.id);
  });

  it('puts only the selected Tab in the Tab order', () => {
    render(<Strip />);
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('selects a Tab when it is clicked and shows its view in the panel', async () => {
    const user = userEvent.setup();
    render(<Strip />);
    await user.click(screen.getByRole('tab', { name: 'Second' }));
    expect(screen.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('View b');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'Second' }).id);
  });

  it('moves the focus with the arrow keys, wrapping at both ends, without selecting', async () => {
    const user = userEvent.setup();
    render(<Strip />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'First' }));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Third' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'First' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Second' }));
    expect(screen.getByRole('tab', { name: 'First' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('View a');
  });

  it('goes to the first and the last Tab with Home and End, and selects the focused Tab with Enter or Space', async () => {
    const user = userEvent.setup();
    render(<Strip />);
    await user.tab();
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Third' }));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tabpanel').textContent).toBe('View c');
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'First' }));
    await user.keyboard(' ');
    expect(screen.getByRole('tabpanel').textContent).toBe('View a');
  });
});
