import { useEffect, useState } from 'react';
import { ArenaPage } from './arena/ArenaPage.js';
import { AdminPage } from './admin/AdminPage.js';
import { DreamHuntPage } from './dream-hunt/DreamHuntPage.js';
import { RosterPage } from './reader/RosterPage.js';
import { ScenariosPage } from './scenarios/ScenariosPage.js';
import { StatsPage } from './stats/StatsPage.js';
import { StagesPage } from './stages/StagesPage.js';

const PAGES = {
  roster: { label: 'Roster', component: RosterPage },
  stages: { label: 'Stages', component: StagesPage },
  dreamHunt: { label: 'Dream Hunt', component: DreamHuntPage },
  arena: { label: 'PvP', component: ArenaPage },
  scenarios: { label: 'Scenarios', component: ScenariosPage },
  stats: { label: 'Statistics', component: StatsPage },
  admin: { label: 'Admin', component: AdminPage },
};
type PageKey = keyof typeof PAGES;

const fromHash = (): PageKey => (Object.hasOwn(PAGES, window.location.hash.slice(1)) ? (window.location.hash.slice(1) as PageKey) : 'roster');

export function App() {
  const [page, setPage] = useState<PageKey>(fromHash());
  useEffect(() => {
    const onHash = () => setPage(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const Page = PAGES[page].component;

  useEffect(() => {
    document.title = `${PAGES[page].label} · AFK Journey Recorder`;
  }, [page]);

  return (
    <>
      <header className="app-header">
        <div className="brand">AFK Journey Recorder</div>
        <nav>
          {(Object.keys(PAGES) as PageKey[]).map((key) => (
            <a key={key} href={`#${key}`} className={key === page ? 'active' : undefined}>
              {PAGES[key].label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        <h1 className="sr-only">{PAGES[page].label}</h1>
        <Page />
      </main>
    </>
  );
}
