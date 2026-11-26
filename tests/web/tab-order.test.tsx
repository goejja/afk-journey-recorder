// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advisorInstalled } from '../../web/advisor/index.js';
import { ArenaPage } from '../../web/arena/ArenaPage.js';
import { AdminPage } from '../../web/admin/AdminPage.js';
import { DreamHuntPage } from '../../web/dream-hunt/DreamHuntPage.js';
import { EventsPage } from '../../web/events/EventsPage.js';
import { StatsPage } from '../../web/stats/StatsPage.js';
import { ToastProvider } from '../../web/ui/Toast.js';

// Tabs with the same purpose come in the same order on every Page (docs/ui-conventions.md, "Pages and Tabs"): the entry view first, then
// Records, Advisor, Simulator, Best teams and Finder, then the Page's own views. A strip skips the views it does not have.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // a strip does not wait for the data of its views
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tabsOf = async (name: string) => (await screen.findByRole('tablist', { name })).querySelectorAll('[role="tab"]');
const namesOf = async (name: string) => Array.from(await tabsOf(name), (t) => t.textContent);

describe('the order of the tabs', () => {
  it('Dream Hunt', async () => {
    render(<ToastProvider><DreamHuntPage /></ToastProvider>);
    expect(await namesOf('Dream Hunt views')).toEqual(['This week', 'Records', 'Advisor', 'Simulator', 'Best teams', 'Finder']);
  });

  it('Titan Reaver', async () => {
    render(<ToastProvider><EventsPage /></ToastProvider>);
    expect(await namesOf('Titan Reaver views')).toEqual(advisorInstalled ? ['This event', 'Records', 'Advisor', 'Best teams'] : ['This event', 'Records', 'Best teams']);
  });

  it('PvP', async () => {
    render(<ToastProvider><ArenaPage /></ToastProvider>);
    expect(await namesOf('PvP views')).toEqual(advisorInstalled ? ['Records', 'Ideas', 'Advisor', 'Counter advisor', 'Planner'] : ['Records', 'Planner']);
  });

  it('Statistics', async () => {
    render(<ToastProvider><StatsPage /></ToastProvider>);
    expect(await namesOf('Statistics views')).toEqual(['Overview', 'Players', 'Heroes', 'Pairs and trios', 'Partners', 'Formations', 'Maps', 'Artifacts', 'Phantimal check', 'Placement check']);
  });

  it('Admin', async () => {
    render(<ToastProvider><AdminPage /></ToastProvider>);
    expect(await namesOf('Admin')).toEqual(['General', 'Weekly default', 'Rules', 'Units', 'Artifacts', 'Maps', 'Tags', 'Formation IDs', 'Images', 'Reader', 'Review', 'Agent', 'Sync', 'Database']);
  });
});
