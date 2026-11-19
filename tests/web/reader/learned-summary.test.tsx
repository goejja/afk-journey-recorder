// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { LearnedView } from '../../../src/shared/api.js';
import { LearnedSummary, summaryLine } from '../../../web/reader/LearnedSummary.js';

afterEach(cleanup);

const accuracy = [
  { source: 'battle-form', screen: 'report', field: 'rank', readings: 1000, agreed: 900, agreedPercent: 90 },
  { source: 'roster', screen: 'heroes', field: 'name', readings: 240, agreed: 240, agreedPercent: 100 },
];
const sources = [
  { source: 'offline' as const, count: 300 },
  { source: 'battle' as const, count: 80 },
];
const view = { ranks: [], units: [], accuracy, sources, choices: { heroes: [], ranks: [], artifacts: [], phantimals: [] } } as LearnedView;

describe('summaryLine', () => {
  it('weights the agreement by readings and counts the pictures and their sources', () => {
    expect(summaryLine({ accuracy, sources })).toBe('1,240 readings · 92% agreed · 380 pictures from 2 sources');
  });

  it('says so when nothing was read, and leaves out pictures that have no source', () => {
    expect(summaryLine({ accuracy: [], sources: [] })).toBe('No readings yet');
    expect(summaryLine({ accuracy, sources: [{ source: 'battle', count: 1 }] })).toBe('1,240 readings · 92% agreed · 1 pictures from 1 source');
  });
});

describe('LearnedSummary', () => {
  it('starts collapsed with its summary line and opens on a click', async () => {
    const user = userEvent.setup();
    render(<LearnedSummary view={view} onChanged={() => {}} />);
    const toggle = screen.getByRole('button', { name: /How the readings did/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('1,240 readings · 92% agreed · 380 pictures from 2 sources')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('table')).toBeTruthy();
    await user.click(toggle);
    expect(screen.queryByRole('table')).toBeNull();
  });
});
